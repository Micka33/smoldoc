/**
 * End-to-end smoke: real HTTP fetch-doc, resolve-version CLI, optional full stack
 * (Postgres + Redis + BullMQ + Pi) when services and OPENAI_API_KEY exist.
 *
 * From repo root: pnpm test:e2e
 */
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { Queue, QueueEvents, Worker } from "bullmq";
import { Redis } from "ioredis";
import type { Request } from "@modelcontextprotocol/server";
import { runMigrations } from "./db/migrate.js";
import { createPool } from "./db/pool.js";
import {
  DOC_RESEARCH_QUEUE,
  parseRedisUrl,
  type DocResearchJobData,
} from "./queue/docResearchQueue.js";
import { RedisTaskStore } from "./mcp/redisTaskStore.js";
import { loadWorkerEnv } from "./env.js";
import {
  createDocResearchProcessorDeps,
  processDocResearchJob,
} from "./worker/processDocResearchJob.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const serverRoot = join(__dirname, "..");
const scriptsDir = join(serverRoot, "dist", "scripts");

function runNodeScript(script: string, args: string[]): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [join(scriptsDir, script), ...args], {
      cwd: serverRoot,
      env: {
        ...process.env,
        DATABASE_URL: process.env.DATABASE_URL ?? "",
        OPENAI_API_KEY: process.env.OPENAI_API_KEY ?? process.env.OPENAPI_API_KEY ?? "",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (d: Buffer) => {
      stdout += d.toString("utf8");
    });
    child.stderr?.on("data", (d: Buffer) => {
      stderr += d.toString("utf8");
    });
    child.on("close", (code) => {
      resolve({ stdout, stderr, code: code ?? 1 });
    });
  });
}

async function tcpOpen(host: string, port: number, ms = 2000): Promise<boolean> {
  const net = await import("node:net");
  return new Promise((resolve) => {
    const s = net.createConnection({ host, port }, () => {
      s.end();
      resolve(true);
    });
    s.on("error", () => resolve(false));
    s.setTimeout(ms, () => {
      s.destroy();
      resolve(false);
    });
  });
}

async function phaseScripts(): Promise<void> {
  const dbUrl = process.env.DATABASE_URL?.trim();
  if (dbUrl) {
    console.log("\n=== Phase 0: DB migrations (for fetch-doc PG upsert) ===\n");
    const pool = createPool(dbUrl);
    try {
      await runMigrations(pool);
      console.log("Migrations OK");
    } finally {
      await pool.end();
    }
  }

  console.log("\n=== Phase 1: fetch-doc (real HTTP) ===\n");
  const docVersion = "e2e-" + Date.now();
  const r = await runNodeScript("fetch-doc.js", [
    "--url",
    "https://example.com/",
    "--doc-version",
    docVersion,
  ]);
  if (r.code !== 0) {
    throw new Error(`fetch-doc failed (${r.code}): ${r.stderr || r.stdout}`);
  }
  const lines = r.stdout.trim().split("\n").filter(Boolean);
  const meta = JSON.parse(lines[lines.length - 1] ?? "{}") as {
    url?: string;
    status?: number;
  };
  if (!meta.url?.includes("example.com")) throw new Error("fetch-doc bad url in output");
  if (meta.status !== 200 && meta.status !== 304) {
    throw new Error(`fetch-doc unexpected status: ${meta.status}`);
  }
  console.log("fetch-doc OK:", meta.url, "status", meta.status);

  console.log("\n=== Phase 2: resolve-version (semver) ===\n");
  const r2 = await runNodeScript("resolve-version.js", [
    "--range",
    ">=2.0.0 <3.0.0",
    "--candidates-json",
    JSON.stringify(["2.0.1", "2.9.0", "3.0.0"]),
  ]);
  if (r2.code !== 0) throw new Error(`resolve-version failed: ${r2.stderr}`);
  const resolved = JSON.parse(r2.stdout.trim()) as { resolved_version?: string };
  if (resolved.resolved_version !== "2.9.0") {
    throw new Error(`resolve-version expected 2.9.0 got ${resolved.resolved_version}`);
  }
  console.log("resolve-version OK:", resolved.resolved_version);
}

async function phaseFullStack(): Promise<void> {
  const dbUrl =
    process.env.DATABASE_URL ?? "postgresql://smoldoc:smoldoc@127.0.0.1:5432/smoldoc";
  const redisUrl = process.env.REDIS_URL ?? "redis://127.0.0.1:6379";

  const pgHost = new URL(dbUrl).hostname;
  const pgPort = Number(new URL(dbUrl).port || 5432);
  const redisHost = new URL(redisUrl).hostname;
  const redisPort = Number(new URL(redisUrl).port || 6379);

  if (!(await tcpOpen(pgHost, pgPort)) || !(await tcpOpen(redisHost, redisPort))) {
    console.log(
      "\n=== Phase 3–4: integration SKIPPED (Postgres or Redis not reachable) ===\n",
    );
    console.log("Start: docker compose up -d postgres redis (pgvector image)");
    return;
  }

  process.env.DATABASE_URL = dbUrl;
  process.env.REDIS_URL = redisUrl;
  process.env.SMOLDOC_PI_CWD ??= serverRoot;
  process.env.SMOLDOC_SCRIPTS_DIR ??= scriptsDir;

  const probe = new pg.Pool({ connectionString: dbUrl, max: 1 });
  try {
    console.log("\n=== Phase 3: Postgres (migrations / pgvector) ===\n");
    await runMigrations(probe);
    console.log("Migrations OK");
  } catch (e) {
    console.log(
      "\n=== Phase 3: SKIPPED —",
      e instanceof Error ? e.message : e,
      "\n(use image pgvector/pgvector:pg16)\n",
    );
    await probe.end();
    return;
  }
  await probe.end();

  const apiKey = process.env.OPENAI_API_KEY ?? process.env.OPENAPI_API_KEY;
  if (!apiKey?.trim()) {
    console.log("\n=== Phase 4: SKIPPED (set OPENAI_API_KEY for Pi + embeddings) ===\n");
    return;
  }

  console.log("\n=== Phase 4: BullMQ job + Pi (real API, up to ~4 min) ===\n");

  const env = loadWorkerEnv();
  const redisConnection = parseRedisUrl(env.redisUrl);
  const taskRedis = new Redis(redisConnection);
  let deps;
  try {
    deps = await createDocResearchProcessorDeps(env, taskRedis);
  } catch (e) {
    console.log("createDocResearchProcessorDeps failed:", e instanceof Error ? e.message : e);
    await taskRedis.quit();
    return;
  }

  const queueEvents = new QueueEvents(DOC_RESEARCH_QUEUE, { connection: redisConnection });
  await queueEvents.waitUntilReady();
  const queue = new Queue<DocResearchJobData>(DOC_RESEARCH_QUEUE, { connection: redisConnection });

  const worker = new Worker<DocResearchJobData>(
    DOC_RESEARCH_QUEUE,
    async (job) => {
      await processDocResearchJob(deps, job.data);
    },
    { connection: redisConnection, concurrency: 1 },
  );
  await worker.waitUntilReady();

  const task = await deps.taskStore.createTask(
    { ttl: 20 * 60 * 1000, pollInterval: 5000 },
    0,
    { method: "tools/call", params: { name: "doc_research" } } as Request,
  );
  const taskId = task.taskId;

  const jobData: DocResearchJobData = {
    taskId,
    goal: "What is the visible title or main heading of the example.com page?",
    context: "E2E smoke test",
    docVersion: "latest",
    versionPolicy: "latest",
    urls: ["https://example.com/"],
  };

  const job = await queue.add("e2e", jobData, { jobId: taskId });

  try {
    await job.waitUntilFinished(queueEvents, 240_000);
  } finally {
    await worker.close();
    await queue.close();
    await queueEvents.close();
    await taskRedis.quit();
    await deps.pool.end();
  }

  const resultRedis = new Redis(redisConnection);
  const store = new RedisTaskStore(resultRedis);
  const finalResult = await store.getTaskResult(taskId);
  await resultRedis.quit();

  const sc = (finalResult as { structuredContent?: unknown }).structuredContent as {
    result?: { recommended_action?: string; confidence?: number };
    from_answer_cache?: boolean;
  };
  if (!sc?.result?.recommended_action) {
    throw new Error("E2E: missing structuredContent.result");
  }
  console.log("Job completed. from_answer_cache:", sc.from_answer_cache);
  console.log("recommended_action (preview):", sc.result.recommended_action.slice(0, 200));
  console.log("confidence:", sc.result.confidence);
}

async function main(): Promise<void> {
  await phaseScripts();
  await phaseFullStack();
  console.log("\n=== E2E smoke PASSED ===\n");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
