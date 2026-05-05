import {
  McpServer,
  type CallToolResult,
  type GetTaskResult,
  type TaskServerContext,
  type CreateTaskServerContext,
} from "@modelcontextprotocol/server";
import * as z from "zod";
import type { Queue } from "bullmq";
import type { DocResearchJobData } from "../queue/docResearchQueue.js";
import type { RedisTaskStore } from "./redisTaskStore.js";

const docResearchInputSchema = z.object({
  goal: z.string().min(1).describe("What the caller needs from the documentation (precise question)."),
  context: z
    .string()
    .optional()
    .describe("Optional background the main agent already has (keep short)."),
  docVersion: z
    .string()
    .min(1)
    .describe("Documentation version label (e.g. v1.2.3); included in cache keys."),
  urls: z
    .array(z.string().url())
    .min(1)
    .max(32)
    .describe("HTTP(S) documentation URLs to fetch and analyze."),
});

const docResearchOutputSchema = z.object({
  taskId: z.string(),
  answerMarkdown: z.string(),
  sources: z.array(z.object({ url: z.string(), note: z.string().optional() })),
  fromAnswerCache: z.boolean(),
  pagesFetched: z.number(),
  parallelChildRuns: z.number(),
});

export function registerDocResearchTool(options: {
  server: McpServer;
  queue: Queue<DocResearchJobData>;
  taskStore: RedisTaskStore;
}): void {
  const { server, queue, taskStore } = options;

  server.experimental.tasks.registerToolTask(
    "doc_research",
    {
      title: "Documentation research (async)",
      description:
        "Runs a **pi** coding agent (`pi run -p`) as coordinator: it plans doc research, may spawn parallel `pi run` children, uses pi's tool harness (bash, curl/wget, etc.), then returns a concise actionable answer. " +
        "Uses MCP tasks: call with task augmentation; poll tasks/get using pollInterval (default 30s) until completed, then tasks/result. " +
        "Requires a running smoldoc **worker** with `pi` on PATH (or set SMOLDOC_PI_COMMAND).",
      inputSchema: docResearchInputSchema,
      outputSchema: docResearchOutputSchema,
      execution: { taskSupport: "required" },
    },
    {
      createTask: async (args, ctx: CreateTaskServerContext) => {
        const task = await ctx.task.store.createTask({
          ttl: 30 * 60 * 1000,
          pollInterval: 30_000,
        });
        await queue.add(
          "doc-research",
          {
            taskId: task.taskId,
            goal: args.goal,
            context: args.context,
            docVersion: args.docVersion,
            urls: args.urls,
          },
          { jobId: task.taskId },
        );
        return { task };
      },
      getTask: async (_args, ctx: TaskServerContext): Promise<GetTaskResult> => {
        const task = await ctx.task.store.getTask(ctx.task.id);
        return {
          taskId: task.taskId,
          status: task.status,
          ttl: task.ttl,
          createdAt: task.createdAt,
          lastUpdatedAt: task.lastUpdatedAt,
          pollInterval: task.pollInterval,
          statusMessage: task.statusMessage,
        };
      },
      getTaskResult: async (_args, ctx: TaskServerContext): Promise<CallToolResult> => {
        return (await ctx.task.store.getTaskResult(ctx.task.id)) as CallToolResult;
      },
    },
  );
}
