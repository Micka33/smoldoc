#!/usr/bin/env node
/**
 * Resolve semver range against a candidate list (JSON array or newline file).
 * Usage:
 *   node resolve-version.js --range ">=2.0.0 <3.0.0" --candidates-json '["2.0.1","2.9.0","3.0.0"]'
 *   node resolve-version.js --range "^1.2.0" --candidates-file versions.txt
 */
import { readFile } from "node:fs/promises";
import { pickHighestSatisfying } from "../semver/semverRange.js";

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
  const range = (args.range || "").trim();
  if (!range) {
    console.error("resolve-version: --range required");
    process.exit(2);
  }
  let candidates: string[] = [];
  if (args.candidates_json) {
    candidates = JSON.parse(args.candidates_json) as string[];
  } else if (args.candidates_file) {
    const text = await readFile(args.candidates_file, "utf8");
    candidates = text
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);
  } else {
    console.error("resolve-version: --candidates-json or --candidates-file required");
    process.exit(2);
  }
  const resolved = pickHighestSatisfying(candidates, range);
  console.log(
    JSON.stringify({
      range,
      candidates,
      resolved_version: resolved,
      ok: resolved !== null,
    }),
  );
  if (!resolved) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
