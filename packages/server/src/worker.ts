import { Worker } from "bullmq";
import { loadWorkerEnv } from "./env.js";
import {
  DOC_RESEARCH_QUEUE,
  parseRedisUrl,
  type DocResearchJobData,
} from "./queue/docResearchQueue.js";
import { RedisTaskStore, toolResultFromAnswer, toolResultFromError } from "./mcp/redisTaskStore.js";
import { Redis } from "ioredis";
import { loadCoordinatorPromptTemplate, runPiDocResearchWithSdk } from "./pi/runPiDocResearch.js";

async function main(): Promise<void> {
  const env = loadWorkerEnv();
  await loadCoordinatorPromptTemplate();

  const redisConnection = parseRedisUrl(env.redisUrl);
  const taskRedis = new Redis(redisConnection);
  const taskStore = new RedisTaskStore(taskRedis);

  const worker = new Worker<DocResearchJobData>(
    DOC_RESEARCH_QUEUE,
    async (job) => {
      const { taskId, goal, context, docVersion, urls } = job.data;
      try {
        await taskStore.updateTaskStatus(
          taskId,
          "working",
          "Pi SDK: documentation research…",
        );
        const piResult = await runPiDocResearchWithSdk(env, {
          goal,
          context,
          docVersion,
          urls,
        });
        const sources = urls.map((u) => ({ url: u }));
        const result = toolResultFromAnswer({
          answerMarkdown: piResult.answerMarkdown,
          sources,
          fromAnswerCache: false,
          pagesFetched: piResult.pagesFetched,
          parallelChildRuns: piResult.parallelChildRuns,
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
    { connection: redisConnection, concurrency: 1 },
  );

  worker.on("failed", (job, err) => {
    console.error("[worker] job failed", job?.id, err);
  });

  console.error(
    `[worker] queue "${DOC_RESEARCH_QUEUE}" (concurrency=1, Pi SDK, model=openai/${env.piOpenaiModelId})`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
