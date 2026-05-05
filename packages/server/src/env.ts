function firstNonEmpty(...values: Array<string | undefined>): string | undefined {
  for (const v of values) {
    if (v && v.trim().length > 0) return v.trim();
  }
  return undefined;
}

export type SmoldocEnv = {
  databaseUrl: string;
  redisUrl: string;
  pageCacheDir: string;
  allowedHosts: string[] | null;
  /** argv0 for doc research subprocess (default `pi run`). */
  piCommand: string;
  /** Working directory for pi (repo root recommended). */
  piCwd: string;
  /** Extra CLI tokens after `pi run` (e.g. `--extension ./x.ts`). */
  piExtraArgs: string[];
  piProvider?: string;
  piModel?: string;
  piThinking?: string;
};

export function loadEnv(): SmoldocEnv {
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

  const piCommand = firstNonEmpty(process.env.SMOLDOC_PI_COMMAND) ?? "pi run";
  const piCwd = firstNonEmpty(process.env.SMOLDOC_PI_CWD) ?? process.cwd();
  const piExtraRaw = firstNonEmpty(process.env.SMOLDOC_PI_EXTRA_ARGS);
  const piExtraArgs = piExtraRaw
    ? piExtraRaw
        .split(/\s+/)
        .map((s) => s.trim())
        .filter(Boolean)
    : [];

  return {
    databaseUrl,
    redisUrl,
    pageCacheDir: firstNonEmpty(process.env.SMOLDOC_PAGE_CACHE_DIR) ?? ".data/pages",
    allowedHosts,
    piCommand,
    piCwd,
    piExtraArgs,
    piProvider: firstNonEmpty(process.env.SMOLDOC_PI_PROVIDER),
    piModel: firstNonEmpty(process.env.SMOLDOC_PI_MODEL),
    piThinking: firstNonEmpty(process.env.SMOLDOC_PI_THINKING),
  };
}
