#!/usr/bin/env node
/**
 * Lightweight sanity: if command is set, check it appears in joined evidence text.
 * Usage: node self-check.mjs --command "foo" --evidence-json '[{"excerpt":"..."}]'
 */
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
  const command = (args.command || "").trim();
  const evJson = args.evidence_json || "[]";
  const evidence = JSON.parse(evJson) as { excerpt?: string }[];
  const blob = evidence.map((e) => e.excerpt ?? "").join("\n").toLowerCase();
  let ok = true;
  let reason = "ok";
  if (command) {
    const first = command.split(/\s+/)[0]?.toLowerCase() ?? "";
    if (first && !blob.includes(first)) {
      ok = false;
      reason = `command token "${first}" not found in evidence excerpts`;
    }
  }
  console.log(JSON.stringify({ ok, reason }));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
