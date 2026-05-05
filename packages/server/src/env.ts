import { tmpdir } from "node:os";
import { join } from "node:path";

function firstNonEmpty(...values: Array<string | undefined>): string | undefined {
  for (const v of values) {
    if (v && v.trim().length > 0) return v.trim();
  }
  return undefined;
}

export type SmoldocCoreEnv = {
  databaseUrl: string;
  redisUrl: string;
  pageCacheDir: string;
  allowedHosts: string[] | null;
};

export type SmoldocWorkerEnv = SmoldocCoreEnv & {
  openaiApiKey: string;
  /** Pi SDK session cwd (must contain `.pi/skills` — use packages/server or repo with copied skills). */
  piCwd: string;
  /** Pi config dir (auth.json); default OS temp smoldoc subdir. */
  piAgentDir: string;
  /** Model id for getModel(), e.g. gpt-5.5 */
  piOpenaiModelId: string;
  /** Pi thinking level */
  piThinkingLevel: "off" | "minimal" | "low" | "medium" | "high" | "xhigh";
  /** Directory containing compiled `*.js` scripts (fetch-doc, …). Default: dist/scripts next to worker. */
  smoldocScriptsDir: string;
};

export function loadCoreEnv(): SmoldocCoreEnv {
  const databaseUrl = firstNonEmpty(process.env.DATABASE_URL);
  if (!databaseUrl) {
    throw new Error("Missing DATABASE_URL.");
  }
  const redisUrl = firstNonEmpty(process.env.REDIS_URL);
  if (!redisUrl) {
    throw new Error("Missing REDIS_URL.");
  }
  const allowedRaw = firstNonEmpty(process.env.SMOLDOC_ALLOWED_HOSTS);
  const allowedHosts = allowedRaw
    ? allowedRaw
        .split(",")
        .map((h) => h.trim().toLowerCase())
        .filter(Boolean)
    : null;

  return {
    databaseUrl,
    redisUrl,
    pageCacheDir: firstNonEmpty(process.env.SMOLDOC_PAGE_CACHE_DIR) ?? ".data/pages",
    allowedHosts,
  };
}

function parseThinking(
  raw: string | undefined,
): "off" | "minimal" | "low" | "medium" | "high" | "xhigh" {
  const v = (raw ?? "high").toLowerCase();
  if (
    v === "off" ||
    v === "minimal" ||
    v === "low" ||
    v === "medium" ||
    v === "high" ||
    v === "xhigh"
  ) {
    return v;
  }
  return "high";
}

export function loadWorkerEnv(): SmoldocWorkerEnv {
  const core = loadCoreEnv();
  const openaiApiKey = firstNonEmpty(
    process.env.OPENAI_API_KEY,
    process.env.OPENAPI_API_KEY,
  );
  if (!openaiApiKey) {
    throw new Error(
      "Worker requires OPENAI_API_KEY (or OPENAPI_API_KEY) for the Pi SDK OpenAI provider.",
    );
  }
  const modelSpec =
    firstNonEmpty(process.env.SMOLDOC_PI_MODEL, process.env.SMOLDOC_OPENAI_MODEL) ??
    "gpt-5.5";
  let piOpenaiModelId = modelSpec;
  if (modelSpec.includes("/")) {
    const [p, ...rest] = modelSpec.split("/");
    if (p !== "openai") {
      throw new Error(
        `SMOLDOC_PI_MODEL must be an OpenAI model id or openai/<id>; got: ${modelSpec}`,
      );
    }
    piOpenaiModelId = rest.join("/");
  }
  const piThinkingLevel = parseThinking(
    firstNonEmpty(process.env.SMOLDOC_PI_THINKING, process.env.SMOLDOC_REASONING_EFFORT),
  );

  const defaultScripts = join(process.cwd(), "dist", "scripts");
  const smoldocScriptsDir = firstNonEmpty(process.env.SMOLDOC_SCRIPTS_DIR) ?? defaultScripts;

  return {
    ...core,
    openaiApiKey,
    piCwd: firstNonEmpty(process.env.SMOLDOC_PI_CWD) ?? process.cwd(),
    piAgentDir:
      firstNonEmpty(process.env.SMOLDOC_PI_AGENT_DIR) ?? join(tmpdir(), "smoldoc-pi-agent"),
    piOpenaiModelId,
    piThinkingLevel,
    smoldocScriptsDir,
  };
}

/** MCP process: DB + Redis only. */
export function loadEnv(): SmoldocCoreEnv {
  return loadCoreEnv();
}
