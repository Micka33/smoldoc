import { McpServer, StdioServerTransport } from "@modelcontextprotocol/server";
import { Redis } from "ioredis";
import { loadEnv } from "./env.js";
import { createPool } from "./db/pool.js";
import { runMigrations } from "./db/migrate.js";
import { createDocResearchQueue, parseRedisUrl } from "./queue/docResearchQueue.js";
import { RedisTaskStore } from "./mcp/redisTaskStore.js";
import { registerDocResearchTool } from "./mcp/createServer.js";

async function main(): Promise<void> {
  const env = loadEnv();
  const pool = createPool(env.databaseUrl);
  await runMigrations(pool);

  const redisOpts = parseRedisUrl(env.redisUrl);
  const taskRedis = new Redis(redisOpts);
  const taskStore = new RedisTaskStore(taskRedis);
  const queue = createDocResearchQueue(env.redisUrl);

  const server = new McpServer(
    { name: "smoldoc", version: "0.1.0" },
    {
      instructions:
        "smoldoc answers documentation questions without stuffing the main agent context. " +
        "Use doc_research with MCP task mode: after tools/call returns a task, use tasks/get until status is completed or failed, then tasks/result. " +
        "Respect pollInterval (seconds between status checks). " +
        "Run the worker (`pnpm start:worker` in packages/server) alongside this server.",
      capabilities: {
        tasks: {
          list: {},
          cancel: {},
          requests: { tools: { call: {} } },
          taskStore,
          defaultTaskPollInterval: 30_000,
        },
      },
    },
  );

  registerDocResearchTool({ server, queue, taskStore });

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
