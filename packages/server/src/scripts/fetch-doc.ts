#!/usr/bin/env node
/**
 * Layer A: fetch URL with conditional request, file cache + optional PG row (doc_page_cache).
 * Usage: node fetch-doc.mjs --url <url> --doc-version <label> [--source s] [--product p] [--browser]
 */
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { fetch } from "undici";
import pg from "pg";

const __dirname = dirname(fileURLToPath(import.meta.url));

function sha256(s: string): string {
  return createHash("sha256").update(s, "utf8").digest("hex");
}

function normalizeUrl(u: string): string {
  const x = new URL(u);
  x.hash = "";
  return x.toString();
}

function parseArgs(): Record<string, string | boolean> {
  const out: Record<string, string | boolean> = {};
  const a = process.argv.slice(2);
  for (let i = 0; i < a.length; i++) {
    const k = a[i];
    if (k === "--browser") {
      out.browser = true;
      continue;
    }
    if (k.startsWith("--")) {
      const key = k.slice(2).replaceAll("-", "_");
      out[key] = a[i + 1] ?? "";
      i++;
    }
  }
  return out;
}

async function fetchWithBrowser(url: string): Promise<{ body: string; status: number }> {
  const { spawn } = await import("node:child_process");
  const bin =
    process.env.CHROMIUM_PATH ||
    process.env.CHROME_PATH ||
    "chromium";
  const args = [
    "--headless=new",
    "--no-sandbox",
    "--disable-gpu",
    "--disable-dev-shm-usage",
    "--dump-dom",
    url,
  ];
  return new Promise((resolve, reject) => {
    const p = spawn(bin, args, { stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    let err = "";
    p.stdout.on("data", (d: Buffer) => {
      out += d.toString("utf8");
    });
    p.stderr.on("data", (d: Buffer) => {
      err += d.toString("utf8");
    });
    p.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`chromium exit ${code}: ${err.slice(0, 500)}`));
        return;
      }
      resolve({ body: out, status: 200 });
    });
    p.on("error", reject);
  });
}

async function main(): Promise<void> {
  const args = parseArgs();
  const url = String(args.url ?? "");
  const docVersion = String(args.doc_version ?? "latest");
  const source = String(args.source ?? "");
  const product = String(args.product ?? "");
  if (!url) {
    console.error("fetch-doc: --url required");
    process.exit(2);
  }
  const nu = normalizeUrl(url);
  const urlHash = sha256(nu);
  const cacheRoot =
    process.env.SMOLDOC_RAW_CACHE_DIR ?? join(process.cwd(), ".data", "smoldoc-raw-cache");
  const dir = join(cacheRoot, urlHash.slice(0, 2), urlHash);
  await mkdir(dir, { recursive: true });
  const metaPath = join(dir, "meta.json");
  const bodyPath = join(dir, "body.html");

  let etag = "";
  let lastModified = "";
  try {
    const meta = JSON.parse(await readFile(metaPath, "utf8")) as {
      etag?: string;
      lastModified?: string;
    };
    etag = meta.etag ?? "";
    lastModified = meta.lastModified ?? "";
  } catch {
    /* no cache */
  }

  const headers: Record<string, string> = {
    "user-agent": "smoldoc-fetch-doc/1.0",
    accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8",
  };
  if (etag) headers["if-none-match"] = etag;
  if (lastModified) headers["if-modified-since"] = lastModified;

  let body: string;
  let status: number;
  if (args.browser) {
    const r = await fetchWithBrowser(nu);
    body = r.body;
    status = r.status;
    etag = "";
    lastModified = "";
  } else {
    const res = await fetch(nu, { method: "GET", headers, redirect: "follow" });
    status = res.status;
    if (status === 304) {
      body = await readFile(bodyPath, "utf8");
      const out = {
        url: nu,
        urlHash,
        status: 304,
        fromCache: true,
        docVersion,
        bodyPath,
        metaPath,
      };
      console.log(JSON.stringify(out));
      return;
    }
    if (!res.ok) {
      throw new Error(`HTTP ${status} for ${nu}`);
    }
    body = await res.text();
    etag = res.headers.get("etag") ?? "";
    lastModified = res.headers.get("last-modified") ?? "";
  }

  const contentHash = sha256(body);
  await writeFile(bodyPath, body, "utf8");
  await writeFile(
    metaPath,
    JSON.stringify(
      {
        url: nu,
        etag,
        lastModified,
        contentHash,
        fetchedAt: new Date().toISOString(),
        docVersion,
        source,
        product,
      },
      null,
      2,
    ),
    "utf8",
  );

  const dbUrl = process.env.DATABASE_URL;
  if (dbUrl) {
    const pool = new pg.Pool({ connectionString: dbUrl, max: 2 });
    try {
      const pagePath = new URL(nu).pathname;
      await pool.query(
        `INSERT INTO doc_page_cache (
           url_normalized, url_hash, doc_version, etag, last_modified, content_hash, body_markdown,
           source, product, page_path
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         ON CONFLICT (url_hash, doc_version) DO UPDATE SET
           etag = EXCLUDED.etag,
           last_modified = EXCLUDED.last_modified,
           content_hash = EXCLUDED.content_hash,
           body_markdown = EXCLUDED.body_markdown,
           source = EXCLUDED.source,
           product = EXCLUDED.product,
           page_path = EXCLUDED.page_path,
           fetched_at = now()`,
        [
          nu,
          urlHash,
          docVersion,
          etag || null,
          lastModified || null,
          contentHash,
          body.slice(0, 500_000),
          source,
          product,
          pagePath,
        ],
      );
    } finally {
      await pool.end();
    }
  }

  console.log(
    JSON.stringify({
      url: nu,
      urlHash,
      status,
      fromCache: false,
      docVersion,
      contentHash,
      bodyPath,
      metaPath,
    }),
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
