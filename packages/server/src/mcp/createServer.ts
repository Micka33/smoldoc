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
import { smoldocActionableResultSchema } from "../types/actionableResult.js";
import { resolveRangeToDocVersionLabel } from "./resolveRangeVersion.js";

const versionPolicySchema = z.enum(["explicit", "latest", "latest_stable", "range"]);

const docResearchInputSchema = z.object({
  goal: z.string().min(1).describe("Precise documentation question / intent."),
  context: z.string().optional().describe("Short background from the principal agent."),
  version_policy: versionPolicySchema.describe(
    "explicit = use explicit_version; latest = newest; latest_stable = stable channel; range = semver range in version_range",
  ),
  explicit_version: z.string().optional().describe("Required when version_policy is explicit (e.g. v2.3.1)."),
  as_of_date: z
    .string()
    .optional()
    .describe("ISO date for latest-as-of semantics (optional)."),
  version_range: z
    .string()
    .optional()
    .describe("When version_policy is range, e.g. >=2.0.0 <3.0.0 or ^1.2.0"),
  version_candidates: z
    .array(z.string())
    .optional()
    .describe(
      'Required when version_policy is "range": semver labels to pick from (e.g. release tags). Highest matching version becomes doc_version.',
    ),
  source: z.string().optional().describe("Logical source id (e.g. github.com/org/repo)."),
  product: z.string().optional().describe("Product name for cache keys."),
  scope: z.string().optional().describe("Doc scope label (e.g. api-reference)."),
  urls: z.array(z.string().url()).min(1).max(32).describe("Seed documentation URLs."),
});

const docResearchOutputSchema = z.object({
  taskId: z.string(),
  from_answer_cache: z.boolean(),
  fingerprint: z.string(),
  doc_set_hash: z.string(),
  result: smoldocActionableResultSchema,
  answer_markdown: z.string(),
});

function resolveDocVersionLabel(input: z.infer<typeof docResearchInputSchema>): string {
  switch (input.version_policy) {
    case "explicit":
      if (!input.explicit_version?.trim()) {
        throw new Error("explicit_version is required when version_policy is explicit");
      }
      return input.explicit_version.trim();
    case "latest":
      return input.as_of_date?.trim()
        ? `latest@${input.as_of_date.trim()}`
        : "latest";
    case "latest_stable":
      return input.as_of_date?.trim()
        ? `latest-stable@${input.as_of_date.trim()}`
        : "latest-stable";
    case "range": {
      const r = input.version_range?.trim();
      if (!r) throw new Error("version_range is required when version_policy is range");
      const resolved = resolveRangeToDocVersionLabel(r, input.version_candidates);
      return resolved;
    }
    default: {
      const _exhaustive: never = input.version_policy;
      return _exhaustive;
    }
  }
}

export function registerDocResearchTool(options: {
  server: McpServer;
  queue: Queue<DocResearchJobData>;
  taskStore: RedisTaskStore;
}): void {
  const { server, queue, taskStore } = options;

  server.experimental.tasks.registerToolTask(
    "doc_research",
    {
      title: "Documentation coprocessor (async)",
      description:
        "Doc reasoning coprocessor: Pi skills implement Layer A (fetch/cache/Chromium) + Layer B (chunk/embed/retrieve); worker caches semantic fingerprints in Postgres. " +
        "Returns structured JSON (`result`) + markdown summary. MCP tasks: poll `tasks/get` then `tasks/result`. Requires worker + `OPENAI_API_KEY` on worker + pgvector DB.",
      inputSchema: docResearchInputSchema,
      outputSchema: docResearchOutputSchema,
      execution: { taskSupport: "required" },
    },
    {
      createTask: async (args, ctx: CreateTaskServerContext) => {
        const docVersion = resolveDocVersionLabel(args);
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
            docVersion,
            versionPolicy: args.version_policy,
            explicitVersion: args.explicit_version,
            asOfDate: args.as_of_date,
            versionRange: args.version_range,
            versionCandidates: args.version_candidates,
            source: args.source,
            product: args.product,
            scope: args.scope,
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
