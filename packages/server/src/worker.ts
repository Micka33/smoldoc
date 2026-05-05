import { Worker } from "bullmq";
import { loadEnv } from "./env.js";
import { createPool } from "./db/pool.js";
import { runMigrations } from "./db/migrate.js";
import {
  DOC_RESEARCH_QUEUE,
  parseRedisUrl,
  type DocResearchJobData,
} from "./queue/docResearchQueue.js";
import { RedisTaskStore, toolResultFromAnswer, toolResultFromError } from "./mcp/redisTaskStore.js";
import { Redis } from "ioredis";
import { loadCoordinatorPromptTemplate, runPiDocResearch } from "./pi/runPiDocResearch.js";

async function main(): Promise<void> {
  const env = loadEnv();
  const pool = createPool(env.databaseUrl);
  await runMigrations(pool);
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
          "Running pi coordinator (pi run -p)…",
        );
        const piResult = await runPiDocResearch({
          env: {
            piCommand: env.piCommand,
            cwd: env.piCwd,
            extraArgs: env.piExtraArgs,
            provider: env.piProvider,
            model: env.piModel,
            thinking: env.piThinking,
          },
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
    { connection: redisConnection, concurrency: 2 },
  );

  worker.on("failed", (job, err) => {
    console.error("[worker] job failed", job?.id, err);
  });

  console.error(
    `[worker] listening on queue "${DOC_RESEARCH_QUEUE}" (concurrency=2, pi=${env.piCommand})`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
