#!/usr/bin/env node
/**
 * Heuristic version detection from markdown/text.
 * Usage: node detect-version.mjs --file path/to/file.md
 */
import { readFile } from "node:fs/promises";

function parseArgs(): Record<string, string> {
  const out: Record<string, string> = {};
  const a = process.argv.slice(2);
  for (let i = 0; i < a.length; i++) {
    if (a[i].startsWith("--")) {
      const key = a[i].slice(2).replaceAll("-", "_");
      out[key] = a[i + 1] ?? "";
      i++;
    }
  }
  return out;
}

async function main(): Promise<void> {
  const args = parseArgs();
  const file = args.file;
  if (!file) {
    console.error("detect-version: --file required");
    process.exit(2);
  }
  const text = await readFile(file, "utf8");
  const patterns = [
    /version\s*[:=]\s*([\d.]+)/i,
    /v(\d+\.\d+\.\d+)/,
    /(\d+\.\d+\.\d+)\s*release/i,
  ];
  let detected = "";
  for (const p of patterns) {
    const m = text.match(p);
    if (m?.[1]) {
      detected = m[1];
      break;
    }
  }
  console.log(JSON.stringify({ file, detected_version: detected || null }));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
