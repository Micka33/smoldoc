function firstNonEmpty(...values: Array<string | undefined>): string | undefined {
  for (const v of values) {
    if (v && v.trim().length > 0) return v.trim();
  }
  return undefined;
}

export function loadEnv(): {
  openaiApiKey: string;
  databaseUrl: string;
  redisUrl: string;
  openaiModel: string;
  reasoningEffort: "low" | "medium" | "high";
  pageCacheDir: string;
  allowedHosts: string[] | null;
} {
  const openaiApiKey = firstNonEmpty(
    process.env.OPENAI_API_KEY,
    process.env.OPENAPI_API_KEY,
  );
  if (!openaiApiKey) {
    throw new Error(
      "Missing API key: set OPENAI_API_KEY (or OPENAPI_API_KEY for compatibility).",
    );
  }
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

  const reasoningRaw = (firstNonEmpty(process.env.SMOLDOC_REASONING_EFFORT) ?? "high").toLowerCase();
  const reasoningEffort =
    reasoningRaw === "low" || reasoningRaw === "medium" || reasoningRaw === "high"
      ? reasoningRaw
      : "high";

  return {
    openaiApiKey,
    databaseUrl,
    redisUrl,
    openaiModel: firstNonEmpty(process.env.SMOLDOC_OPENAI_MODEL) ?? "gpt-5.5",
    reasoningEffort,
    pageCacheDir: firstNonEmpty(process.env.SMOLDOC_PAGE_CACHE_DIR) ?? ".data/pages",
    allowedHosts,
  };
}
