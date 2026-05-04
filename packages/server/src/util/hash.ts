import { createHash } from "node:crypto";

export function sha256Hex(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}

export function normalizeUrl(url: string): string {
  const u = new URL(url);
  u.hash = "";
  return u.toString();
}

export function answerCacheKey(parts: {
  goal: string;
  docVersion: string;
  model: string;
  urls: string[];
}): string {
  const sorted = [...parts.urls].map(normalizeUrl).sort();
  const payload = JSON.stringify({
    g: parts.goal,
    v: parts.docVersion,
    m: parts.model,
    u: sorted,
  });
  return sha256Hex(payload);
}
