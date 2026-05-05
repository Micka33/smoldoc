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

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Loaded once: coordinator role + harness instructions (placeholders filled per job). */
let coordinatorTemplateText = "";

function fillCoordinatorTemplate(input: {
  goal: string;
  context: string;
  docVersion: string;
  urls: string[];
}): string {
  const context = input.context.trim() || "(none)";
  const urls = input.urls.map((u) => `- ${u}`).join("\n");
  return coordinatorTemplateText
    .replaceAll("{{GOAL}}", input.goal)
    .replaceAll("{{CONTEXT}}", context)
    .replaceAll("{{DOC_VERSION}}", input.docVersion)
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

export type PiDocResearchResult = {
  answerMarkdown: string;
  pagesFetched: number;
  parallelChildRuns: number;
};

function parseMetaLine(full: string): {
  body: string;
  pagesFetched: number;
  parallelChildRuns: number;
} {
  const lines = full.split("\n");
  let pagesFetched = 0;
  let parallelChildRuns = 0;
  let cut = lines.length;
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim();
    if (!line.startsWith("SMOLDOC_META_JSON:")) continue;
    const jsonPart = line.slice("SMOLDOC_META_JSON:".length).trim();
    try {
      const o = JSON.parse(jsonPart) as { pagesFetched?: number; parallelChildRuns?: number };
      if (typeof o.pagesFetched === "number") pagesFetched = o.pagesFetched;
      if (typeof o.parallelChildRuns === "number") parallelChildRuns = o.parallelChildRuns;
    } catch {
      /* ignore */
    }
    cut = i;
    break;
  }
  const body = lines.slice(0, cut).join("\n").trimEnd();
  return { body, pagesFetched, parallelChildRuns };
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
 * OpenAI key is passed via AuthStorage.setRuntimeApiKey (same as SDK docs).
 */
export async function runPiDocResearchWithSdk(
  env: SmoldocWorkerEnv,
  input: {
    goal: string;
    context?: string;
    docVersion: string;
    urls: string[];
  },
): Promise<PiDocResearchResult> {
  if (!coordinatorTemplateText) {
    await loadCoordinatorPromptTemplate();
  }

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
    const userPrompt = fillCoordinatorTemplate({
      goal: input.goal,
      context: input.context ?? "",
      docVersion: input.docVersion,
      urls: input.urls,
    });

    await session.prompt(userPrompt);

    const combined = lastAssistantText(session.messages);
    const { body, pagesFetched, parallelChildRuns } = parseMetaLine(combined);

    return {
      answerMarkdown: body.trim().length > 0 ? body.trim() : combined.trim(),
      pagesFetched,
      parallelChildRuns,
    };
  } finally {
    session.dispose();
  }
}
