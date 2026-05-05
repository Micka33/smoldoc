import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

const MAX_CAPTURE_BYTES = 2 * 1024 * 1024;

function splitCommand(command: string): string[] {
  return command
    .trim()
    .split(/\s+/)
    .filter((s) => s.length > 0);
}

function splitExtraArgs(raw: string | undefined): string[] {
  if (!raw?.trim()) return [];
  return splitCommand(raw);
}

function fillCoordinatorTemplate(input: {
  goal: string;
  context: string;
  docVersion: string;
  urls: string[];
}): string {
  const context = input.context.trim() || "(none)";
  const urls = input.urls.map((u) => `- ${u}`).join("\n");
  // Sync replacement at runtime; template is shipped next to this file in dist.
  return coordinatorTemplateText
    .replaceAll("{{GOAL}}", input.goal)
    .replaceAll("{{CONTEXT}}", context)
    .replaceAll("{{DOC_VERSION}}", input.docVersion)
    .replaceAll("{{URLS}}", urls);
}

/** Loaded once from dist (or src under tsx). */
let coordinatorTemplateText = "";

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

export type PiRunEnv = {
  /** Full argv0 + subcommand, e.g. `pi run` or `/usr/bin/pi`. */
  piCommand: string;
  cwd: string;
  extraArgs: string[];
  provider?: string;
  model?: string;
  thinking?: string;
};

export type PiDocResearchResult = {
  answerMarkdown: string;
  pagesFetched: number;
  parallelChildRuns: number;
  rawTail: string;
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

export async function runPiDocResearch(options: {
  env: PiRunEnv;
  goal: string;
  context?: string;
  docVersion: string;
  urls: string[];
}): Promise<PiDocResearchResult> {
  if (!coordinatorTemplateText) {
    await loadCoordinatorPromptTemplate();
  }
  const stdinText = fillCoordinatorTemplate({
    goal: options.goal,
    context: options.context ?? "",
    docVersion: options.docVersion,
    urls: options.urls,
  });

  const parts = splitCommand(options.env.piCommand);
  if (parts.length === 0) {
    throw new Error("SMOLDOC_PI_COMMAND is empty");
  }
  const bin = parts[0];
  const lead = parts.slice(1);

  const args: string[] = [
    ...lead,
    "-p",
    "--no-session",
    ...options.env.extraArgs,
  ];
  if (options.env.provider) {
    args.push("--provider", options.env.provider);
  }
  if (options.env.model) {
    args.push("--model", options.env.model);
  }
  if (options.env.thinking) {
    args.push("--thinking", options.env.thinking);
  }

  const child = spawn(bin, args, {
    cwd: options.env.cwd,
    env: { ...process.env },
    stdio: ["pipe", "pipe", "pipe"],
  });

  const cap = (chunk: string, acc: { s: string }) => {
    acc.s += chunk;
    if (acc.s.length > MAX_CAPTURE_BYTES) {
      acc.s = `${acc.s.slice(0, MAX_CAPTURE_BYTES)}…[truncated]`;
    }
  };
  const outAcc = { s: "" };
  const errAcc = { s: "" };

  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (d: string) => cap(d, outAcc));
  child.stderr.on("data", (d: string) => cap(d, errAcc));

  child.stdin.write(stdinText, "utf8");
  child.stdin.end();

  const code: number = await new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("close", resolve);
  });

  const stdout = outAcc.s;
  const stderr = errAcc.s;

  if (code !== 0) {
    throw new Error(
      `pi run exited with code ${code}. stderr:\n${stderr || "(empty)"}\nstdout:\n${stdout.slice(0, 4000)}`,
    );
  }

  const combined = stdout.trim().length > 0 ? stdout : stderr;
  const { body, pagesFetched, parallelChildRuns } = parseMetaLine(combined);

  return {
    answerMarkdown: body.trim().length > 0 ? body.trim() : combined.trim(),
    pagesFetched,
    parallelChildRuns,
    rawTail: combined.slice(-400),
  };
}
