#!/usr/bin/env node
/**
 * Retrieve top-k evidence chunks by embedding similarity.
 * Usage: node retrieve-evidence.mjs --query "..." --doc-version v1 [--k 8]
 */
import OpenAI from "openai";
import pg from "pg";

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
  const query = args.query;
  const docVersion = args.doc_version || "latest";
  const k = Math.min(24, Math.max(1, parseInt(args.k || "8", 10) || 8));
  const key = process.env.OPENAI_API_KEY || process.env.OPENAPI_API_KEY;
  const dbUrl = process.env.DATABASE_URL;
  if (!query || !key || !dbUrl) {
    console.error("retrieve-evidence: --query and OPENAI_API_KEY and DATABASE_URL required");
    process.exit(2);
  }
  const openai = new OpenAI({ apiKey: key });
  const emb = await openai.embeddings.create({
    model: "text-embedding-3-small",
    input: query.slice(0, 8000),
  });
  const vec = emb.data[0]?.embedding;
  if (!vec) throw new Error("no embedding");
  const vecLiteral = `[${vec.join(",")}]`;
  const pool = new pg.Pool({ connectionString: dbUrl, max: 3 });
  try {
    const r = await pool.query<{
      url_normalized: string;
      body: string;
      chunk_index: number;
      dist: number;
    }>(
      `SELECT url_normalized, body, chunk_index,
              (embedding <=> $1::vector) AS dist
       FROM doc_chunks
       WHERE doc_version_label = $2 AND embedding IS NOT NULL
       ORDER BY embedding <=> $1::vector
       LIMIT $3`,
      [vecLiteral, docVersion, k],
    );
    const evidence = r.rows.map((row) => ({
      url: row.url_normalized,
      excerpt: row.body.slice(0, 1200),
      chunk_index: row.chunk_index,
      distance: row.dist,
    }));
    console.log(JSON.stringify({ evidence }));
  } finally {
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
