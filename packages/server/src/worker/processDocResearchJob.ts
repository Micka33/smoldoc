import type { Pool } from "pg";
import { createPool } from "../db/pool.js";
import { runMigrations } from "../db/migrate.js";
import type { SmoldocWorkerEnv } from "../env.js";
import type { DocResearchJobData } from "../queue/docResearchQueue.js";
import { RedisTaskStore, toolResultFromAnswer, toolResultFromError } from "../mcp/redisTaskStore.js";
import type { Redis as RedisClient } from "ioredis";
import {
  loadCoordinatorPromptTemplate,
  runPiDocResearchWithSdk,
  getLoadedCoordinatorText,
} from "../pi/runPiDocResearch.js";
import { analyzerPromptHash, docSetHash, fingerprintDocResearch } from "../semantic/fingerprint.js";
import { getSemanticCachedAnswer, putSemanticCachedAnswer } from "../semantic/queryCache.js";
import { smoldocActionableResultSchema } from "../types/actionableResult.js";

export type DocResearchProcessorDeps = {
  env: SmoldocWorkerEnv;
  pool: Pool;
  taskStore: RedisTaskStore;
  apHash: string;
};

export async function createDocResearchProcessorDeps(
  env: SmoldocWorkerEnv,
  taskRedis: RedisClient,
): Promise<DocResearchProcessorDeps> {
  const pool = createPool(env.databaseUrl);
  await runMigrations(pool);
  await loadCoordinatorPromptTemplate();
  const taskStore = new RedisTaskStore(taskRedis);
  const apHash = analyzerPromptHash(getLoadedCoordinatorText());
  return { env, pool, taskStore, apHash };
}

/**
 * Same logic as BullMQ worker job handler (for tests / e2e in-process).
 */
export async function processDocResearchJob(
  deps: DocResearchProcessorDeps,
  j: DocResearchJobData,
): Promise<void> {
  const { env, pool, taskStore, apHash } = deps;
  const { taskId, goal, context, docVersion, urls } = j;
  const fp = fingerprintDocResearch({
    goal,
    context,
    versionPolicy: j.versionPolicy,
    explicitVersion: j.explicitVersion,
    asOfDate: j.asOfDate,
    versionRange: j.versionRange,
    versionCandidates: j.versionCandidates,
    product: j.product,
    source: j.source,
    scope: j.scope,
    urls,
  });
  const dsh = docSetHash(urls, docVersion);

  try {
    await taskStore.updateTaskStatus(taskId, "working", "Checking semantic cache…");
    const cached = await getSemanticCachedAnswer({
      pool,
      fingerprint: fp,
      docSetHash: dsh,
      model: env.piOpenaiModelId,
      analyzerPromptHash: apHash,
    });

    if (cached) {
      const result = toolResultFromAnswer({
        taskId,
        fromAnswerCache: true,
        fingerprint: fp,
        docSetHash: dsh,
        result: smoldocActionableResultSchema.parse(cached),
        answerMarkdown:
          cached.answer_summary ??
          `${cached.recommended_action}\n\n\`${cached.command ?? ""}\``,
      });
      await taskStore.storeTaskResult(taskId, "completed", result);
      return;
    }

    await taskStore.updateTaskStatus(taskId, "working", "Pi SDK + skills…");
    const piOut = await runPiDocResearchWithSdk(env, j);

    let resultObj = piOut.structured;
    if (!resultObj) {
      resultObj = smoldocActionableResultSchema.parse({
        recommended_action:
          piOut.answerMarkdown.slice(0, 500) || "No structured output from model.",
        version_target: docVersion,
        sources: urls,
        confidence: 0.2,
        needs_human_review: true,
        assumptions: [
          piOut.parseError
            ? `Model did not emit SMOLDOC_RESULT_JSON: ${piOut.parseError}`
            : "Model did not emit SMOLDOC_RESULT_JSON.",
        ],
        evidence: urls.map((url: string) => ({ url, excerpt: "(unstructured run)" })),
        answer_summary: piOut.answerMarkdown.slice(0, 2000),
        pages_fetched: 0,
        parallel_branches: 0,
      });
    } else {
      resultObj = smoldocActionableResultSchema.parse(resultObj);
    }

    await putSemanticCachedAnswer({
      pool,
      fingerprint: fp,
      docSetHash: dsh,
      model: env.piOpenaiModelId,
      analyzerPromptHash: apHash,
      result: resultObj,
      evidence: resultObj.evidence,
      sourcesUsed: resultObj.sources,
    });

    const mcp = toolResultFromAnswer({
      taskId,
      fromAnswerCache: false,
      fingerprint: fp,
      docSetHash: dsh,
      result: resultObj,
      answerMarkdown: resultObj.answer_summary ?? piOut.answerMarkdown,
    });
    await taskStore.storeTaskResult(taskId, "completed", mcp);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await taskStore.storeTaskResult(
      taskId,
      "failed",
      toolResultFromError(message, taskId),
    );
  }
}
