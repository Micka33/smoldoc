import { Worker } from "bullmq";
import { loadWorkerEnv } from "./env.js";
import {
  DOC_RESEARCH_QUEUE,
  parseRedisUrl,
  type DocResearchJobData,
} from "./queue/docResearchQueue.js";
import { Redis } from "ioredis";
import {
  createDocResearchProcessorDeps,
  processDocResearchJob,
} from "./worker/processDocResearchJob.js";

async function main(): Promise<void> {
  const env = loadWorkerEnv();
  const redisConnection = parseRedisUrl(env.redisUrl);
  const taskRedis = new Redis(redisConnection);
  const deps = await createDocResearchProcessorDeps(env, taskRedis);

  const worker = new Worker<DocResearchJobData>(
    DOC_RESEARCH_QUEUE,
    async (job) => {
      await processDocResearchJob(deps, job.data);
    },
    { connection: redisConnection, concurrency: 1 },
  );

  worker.on("failed", (jb, err) => {
    console.error("[worker] job failed", jb?.id, err);
  });

  console.error(
    `[worker] ${DOC_RESEARCH_QUEUE} (Pi SDK, scripts=${env.smoldocScriptsDir})`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
