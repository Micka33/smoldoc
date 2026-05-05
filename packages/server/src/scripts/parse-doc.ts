#!/usr/bin/env node
/**
 * Parse HTML to canonical markdown-ish text (Layer A post-process).
 * Usage: node parse-doc.mjs --input path/to/body.html [--out path.md]
 */
import { readFile, writeFile } from "node:fs/promises";

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

function htmlToText(html: string, max = 200_000): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

async function main(): Promise<void> {
  const args = parseArgs();
  const input = args.input;
  if (!input) {
    console.error("parse-doc: --input required");
    process.exit(2);
  }
  const html = await readFile(input, "utf8");
  const text = htmlToText(html);
  const outPath = args.out || input.replace(/\.html?$/i, ".md");
  await writeFile(outPath, `# parsed\n\n${text}\n`, "utf8");
  console.log(JSON.stringify({ input, outPath, chars: text.length }));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
