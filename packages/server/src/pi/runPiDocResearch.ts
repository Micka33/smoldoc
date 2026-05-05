import { mkdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { AssistantMessage, TextContent } from "@mariozechner/pi-ai";
import {
  AuthStorage,
  createAgentSession,
  DefaultResourceLoader,
  ModelRegistry,
  SessionManager,
  SettingsManager,
} from "@mariozechner/pi-coding-agent";
import type { SmoldocWorkerEnv } from "../env.js";
import type { DocResearchJobData } from "../queue/docResearchQueue.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

let coordinatorTemplateText = "";

function fillCoordinatorTemplate(input: {
  goal: string;
  context: string;
  docVersion: string;
  versionPolicy: string;
  explicitVersion: string;
  asOfDate: string;
  versionRange: string;
  source: string;
  product: string;
  scope: string;
  urls: string[];
}): string {
  const context = input.context.trim() || "(none)";
  const urls = input.urls.map((u) => `- ${u}`).join("\n");
  return coordinatorTemplateText
    .replaceAll("{{GOAL}}", input.goal)
    .replaceAll("{{CONTEXT}}", context)
    .replaceAll("{{DOC_VERSION_LABEL}}", input.docVersion)
    .replaceAll("{{VERSION_POLICY}}", input.versionPolicy)
    .replaceAll("{{EXPLICIT_VERSION}}", input.explicitVersion)
    .replaceAll("{{AS_OF_DATE}}", input.asOfDate)
    .replaceAll("{{VERSION_RANGE}}", input.versionRange)
    .replaceAll("{{SOURCE}}", input.source || "(none)")
    .replaceAll("{{PRODUCT}}", input.product || "(none)")
    .replaceAll("{{SCOPE}}", input.scope || "(none)")
    .replaceAll("{{URLS}}", urls);
}

export async function loadCoordinatorPromptTemplate(): Promise<void> {
  const candidates = [
    join(__dirname, "../prompts/coordinator.md"),
    join(__dirname, "prompts/coordinator.md"),
  ];
  for (const p of candidates) {
    try {
      coordinatorTemplateText = await readFile(p, "utf8");
      return;
    } catch {
      /* try next */
    }
  }
  throw new Error(
    `smoldoc: could not load coordinator.md (tried ${candidates.join(", ")})`,
  );
}

export function getLoadedCoordinatorText(): string {
  if (!coordinatorTemplateText) {
    throw new Error("Coordinator prompt not loaded");
  }
  return coordinatorTemplateText;
}

export type PiDocResearchResult = {
  answerMarkdown: string;
  /** Parsed structured result; null if model omitted SMOLDOC_RESULT_JSON */
  structured: import("../types/actionableResult.js").SmoldocActionableResult | null;
  parseError?: string;
};

function parseMetaLine(full: string): {
  body: string;
} {
  const lines = full.split("\n");
  let cut = lines.length;
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim();
    if (!line.startsWith("SMOLDOC_RESULT_JSON:")) continue;
    cut = i;
    break;
  }
  const body = lines.slice(0, cut).join("\n").trimEnd();
  return { body };
}

function isAssistantMessage(m: unknown): m is AssistantMessage {
  return (
    typeof m === "object" &&
    m !== null &&
    "role" in m &&
    (m as { role: string }).role === "assistant"
  );
}

function assistantPlainText(m: AssistantMessage): string {
  const parts: string[] = [];
  for (const block of m.content) {
    if (block.type === "text") {
      parts.push((block as TextContent).text);
    }
  }
  return parts.join("\n").trim();
}

function lastAssistantText(messages: unknown[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (!isAssistantMessage(m)) continue;
    const t = assistantPlainText(m);
    if (t.length > 0) return t;
  }
  return "";
}

/**
 * Pi Coding Agent SDK: https://pi.dev/docs/latest/sdk
 */
export async function runPiDocResearchWithSdk(
  env: SmoldocWorkerEnv,
  job: DocResearchJobData,
): Promise<PiDocResearchResult> {
  if (!coordinatorTemplateText) {
    await loadCoordinatorPromptTemplate();
  }

  process.env.DATABASE_URL = env.databaseUrl;
  process.env.OPENAI_API_KEY = env.openaiApiKey;
  process.env.SMOLDOC_SCRIPTS_DIR = env.smoldocScriptsDir;

  await mkdir(env.piAgentDir, { recursive: true });
  const authStorage = AuthStorage.create(join(env.piAgentDir, "auth.json"));
  authStorage.setRuntimeApiKey("openai", env.openaiApiKey);

  const modelRegistry = ModelRegistry.create(
    authStorage,
    join(env.piAgentDir, "models.json"),
  );
  const model = modelRegistry.find("openai", env.piOpenaiModelId);
  if (!model) {
    throw new Error(
      `Unknown OpenAI model for Pi registry: openai/${env.piOpenaiModelId}`,
    );
  }

  const settingsManager = SettingsManager.inMemory({
    compaction: { enabled: false },
  });

  const loader = new DefaultResourceLoader({
    cwd: env.piCwd,
    agentDir: env.piAgentDir,
    settingsManager,
    appendSystemPrompt: [coordinatorTemplateText],
  });
  await loader.reload();

  const { session } = await createAgentSession({
    cwd: env.piCwd,
    agentDir: env.piAgentDir,
    model,
    thinkingLevel: env.piThinkingLevel,
    authStorage,
    modelRegistry,
    sessionManager: SessionManager.inMemory(),
    settingsManager,
    resourceLoader: loader,
  });

  try {
    const systemFilled = fillCoordinatorTemplate({
      goal: job.goal,
      context: job.context ?? "",
      docVersion: job.docVersion,
      versionPolicy: job.versionPolicy,
      explicitVersion: job.explicitVersion ?? "",
      asOfDate: job.asOfDate ?? "",
      versionRange: job.versionRange ?? "",
      source: job.source ?? "",
      product: job.product ?? "",
      scope: job.scope ?? "",
      urls: job.urls,
    });

    const jobJson = JSON.stringify(
      {
        goal: job.goal,
        context: job.context,
        docVersion: job.docVersion,
        versionPolicy: job.versionPolicy,
        explicitVersion: job.explicitVersion,
        asOfDate: job.asOfDate,
        versionRange: job.versionRange,
        versionCandidates: job.versionCandidates,
        source: job.source,
        product: job.product,
        scope: job.scope,
        urls: job.urls,
        scriptsDir: env.smoldocScriptsDir,
      },
      null,
      2,
    );

    const userPrompt = `${systemFilled}\n\n---\n\n## Job payload (machine)\n\n\`\`\`json\n${jobJson}\n\`\`\`\n\nExecute the pipeline using the skills. Output markdown + final SMOLDOC_RESULT_JSON line.`;

    await session.prompt(userPrompt);

    const combined = lastAssistantText(session.messages);
    const { body } = parseMetaLine(combined);
    const { parseSmoldocResultJson } = await import("../types/actionableResult.js");
    const parsed = parseSmoldocResultJson(combined);

    return {
      answerMarkdown: body.trim().length > 0 ? body.trim() : combined.trim(),
      structured: parsed.result,
      parseError: parsed.parseError,
    };
  } finally {
    session.dispose();
  }
}
