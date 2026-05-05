#!/usr/bin/env node
/**
 * Chunk text, embed with OpenAI text-embedding-3-small, upsert doc_chunks (Layer B).
 * Usage: node chunk-embed-index.mjs --url <canonical> --doc-version <label> --file path.md [--source s] [--product p]
 */
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
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

function sha256(s: string): string {
  return createHash("sha256").update(s, "utf8").digest("hex");
}

function normalizeUrl(u: string): string {
  const x = new URL(u);
  x.hash = "";
  return x.toString();
}

function chunks(text: string, size: number, overlap: number): string[] {
  const out: string[] = [];
  let i = 0;
  while (i < text.length) {
    out.push(text.slice(i, i + size));
    i += size - overlap;
  }
  return out.filter((c) => c.trim().length > 0);
}

async function main(): Promise<void> {
  const args = parseArgs();
  const url = args.url;
  const docVersion = args.doc_version || "latest";
  const file = args.file;
  const source = args.source || "";
  const product = args.product || "";
  const key = process.env.OPENAI_API_KEY || process.env.OPENAPI_API_KEY;
  const dbUrl = process.env.DATABASE_URL;
  if (!url || !file || !key || !dbUrl) {
    console.error("chunk-embed-index: need --url --file and OPENAI_API_KEY and DATABASE_URL");
    process.exit(2);
  }
  const nu = normalizeUrl(url);
  const urlHash = sha256(nu);
  const pagePath = new URL(nu).pathname;
  const text = await readFile(file, "utf8");
  const contentHash = sha256(text);
  const parts = chunks(text, 1200, 200);
  const openai = new OpenAI({ apiKey: key });
  const pool = new pg.Pool({ connectionString: dbUrl, max: 3 });
  try {
    await pool.query("DELETE FROM doc_chunks WHERE url_hash = $1 AND doc_version_label = $2 AND content_hash = $3", [
      urlHash,
      docVersion,
      contentHash,
    ]);
    let idx = 0;
    for (const body of parts) {
      const emb = await openai.embeddings.create({
        model: "text-embedding-3-small",
        input: body.slice(0, 8000),
      });
      const vec = emb.data[0]?.embedding;
      if (!vec || vec.length !== 1536) throw new Error("bad embedding dim");
      const vecLiteral = `[${vec.join(",")}]`;
      await pool.query(
        `INSERT INTO doc_chunks (
           url_hash, url_normalized, page_path, source, product, doc_version_label,
           content_hash, chunk_index, body, metadata, embedding
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11::vector)`,
        [
          urlHash,
          nu,
          pagePath,
          source,
          product,
          docVersion,
          contentHash,
          idx,
          body,
          JSON.stringify({}),
          vecLiteral,
        ],
      );
      idx++;
    }
    console.log(JSON.stringify({ url: nu, chunks: parts.length, docVersion, contentHash }));
  } finally {
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
