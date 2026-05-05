import { createHash } from "node:crypto";

function norm(s: string): string {
  return s.trim().replace(/\s+/g, " ").slice(0, 8000);
}

export function normalizeUrl(url: string): string {
  const u = new URL(url);
  u.hash = "";
  return u.toString();
}

export function fingerprintDocResearch(input: {
  goal: string;
  context?: string;
  versionPolicy: string;
  explicitVersion?: string;
  asOfDate?: string;
  versionRange?: string;
  product?: string;
  source?: string;
  scope?: string;
  urls: string[];
}): string {
  const sortedUrls = [...input.urls].map(normalizeUrl).sort();
  const payload = {
    goal: norm(input.goal),
    context: input.context ? norm(input.context) : "",
    versionPolicy: input.versionPolicy,
    explicitVersion: input.explicitVersion ?? "",
    asOfDate: input.asOfDate ?? "",
    versionRange: input.versionRange ?? "",
    product: input.product ?? "",
    source: input.source ?? "",
    scope: input.scope ?? "",
    urls: sortedUrls,
  };
  return createHash("sha256").update(JSON.stringify(payload), "utf8").digest("hex");
}

export function docSetHash(urls: string[], docVersionLabel: string): string {
  const sorted = [...urls].map(normalizeUrl).sort();
  return createHash("sha256")
    .update(JSON.stringify({ u: sorted, v: docVersionLabel }), "utf8")
    .digest("hex");
}

export function analyzerPromptHash(coordinatorPrompt: string): string {
  return createHash("sha256").update(coordinatorPrompt, "utf8").digest("hex").slice(0, 32);
}
