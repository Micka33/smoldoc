import { Worker } from "bullmq";
import OpenAI from "openai";
import { loadEnv } from "./env.js";
import { createPool } from "./db/pool.js";
import { runMigrations } from "./db/migrate.js";
import { fetchDocumentationPages } from "./doc/fetchPages.js";
import { synthesizeDocumentationAnswer } from "./doc/synthesize.js";
import {
  DOC_RESEARCH_QUEUE,
  parseRedisUrl,
  type DocResearchJobData,
} from "./queue/docResearchQueue.js";
import { RedisTaskStore, toolResultFromAnswer, toolResultFromError } from "./mcp/redisTaskStore.js";
import { Redis } from "ioredis";

async function main(): Promise<void> {
  const env = loadEnv();
  const pool = createPool(env.databaseUrl);
  await runMigrations(pool);

  const redisConnection = parseRedisUrl(env.redisUrl);
  const taskRedis = new Redis(redisConnection);
  const taskStore = new RedisTaskStore(taskRedis);

  const openai = new OpenAI({ apiKey: env.openaiApiKey });

  const worker = new Worker<DocResearchJobData>(
    DOC_RESEARCH_QUEUE,
    async (job) => {
      const { taskId, goal, context, docVersion, urls } = job.data;
      try {
        await taskStore.updateTaskStatus(taskId, "working", "Fetching documentation pages…");
        const pages = await fetchDocumentationPages({
          urls,
          docVersion,
          pool,
          pageCacheDir: env.pageCacheDir,
          allowedHosts: env.allowedHosts,
          maxCharsPerPage: 48_000,
        });
        await taskStore.updateTaskStatus(taskId, "working", "Synthesizing answer with LLM…");
        const synth = await synthesizeDocumentationAnswer({
          pool,
          openai,
          model: env.openaiModel,
          reasoningEffort: env.reasoningEffort,
          goal,
          context,
          docVersion,
          pages,
        });
        const result = toolResultFromAnswer({
          answerMarkdown: synth.answerMarkdown,
          sources: synth.sources,
          fromAnswerCache: synth.fromAnswerCache,
          pagesFetched: pages.length,
          taskId,
        });
        await taskStore.storeTaskResult(taskId, "completed", result);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        await taskStore.storeTaskResult(
          taskId,
          "failed",
          toolResultFromError(message, taskId),
        );
      }
    },
    { connection: redisConnection, concurrency: 4 },
  );

  worker.on("failed", (job, err) => {
    console.error("[worker] job failed", job?.id, err);
  });

  console.error(
    `[worker] listening on queue "${DOC_RESEARCH_QUEUE}" (concurrency=4)`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
