import { Queue } from "bullmq";
import type { RedisOptions } from "ioredis";

export const DOC_RESEARCH_QUEUE = "smoldoc-doc-research";

export type DocResearchJobData = {
  taskId: string;
  goal: string;
  context?: string;
  docVersion: string;
  urls: string[];
};

export function parseRedisUrl(redisUrl: string): RedisOptions {
  const u = new URL(redisUrl);
  return {
    host: u.hostname,
    port: u.port ? Number(u.port) : 6379,
    username: u.username || undefined,
    password: u.password || undefined,
    db: u.pathname && u.pathname !== "/" ? Number(u.pathname.slice(1)) : undefined,
    tls: u.protocol === "rediss:" ? {} : undefined,
  };
}

export function createDocResearchQueue(redisUrl: string): Queue<DocResearchJobData> {
  const connection = parseRedisUrl(redisUrl);
  return new Queue<DocResearchJobData>(DOC_RESEARCH_QUEUE, {
    connection,
    defaultJobOptions: {
      attempts: 2,
      backoff: { type: "exponential", delay: 5000 },
      removeOnComplete: 500,
      removeOnFail: 200,
    },
  });
}
