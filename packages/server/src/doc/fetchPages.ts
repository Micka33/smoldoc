import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fetch as undiciFetch } from "undici";
import type { Pool } from "pg";
import { htmlToPlainText } from "../util/html.js";
import { normalizeUrl, sha256Hex } from "../util/hash.js";

export type FetchPageResult = {
  url: string;
  markdown: string;
  etag: string | null;
  lastModified: string | null;
  status: number;
  revalidated304: boolean;
};

function hostAllowed(hostname: string, allowed: string[] | null): boolean {
  if (!allowed || allowed.length === 0) return true;
  return allowed.includes(hostname.toLowerCase());
}

export async function fetchDocumentationPages(options: {
  urls: string[];
  docVersion: string;
  pool: Pool;
  pageCacheDir: string;
  allowedHosts: string[] | null;
  maxCharsPerPage: number;
}): Promise<FetchPageResult[]> {
  const results: FetchPageResult[] = [];
  for (const raw of options.urls) {
    const url = normalizeUrl(raw);
    const host = new URL(url).hostname;
    if (!hostAllowed(host, options.allowedHosts)) {
      throw new Error(`Host not allowed by SMOLDOC_ALLOWED_HOSTS: ${host}`);
    }
    const urlHash = sha256Hex(url);

    const cached = await options.pool.query<{
      etag: string | null;
      last_modified: string | null;
      body_markdown: string;
    }>(
      `SELECT etag, last_modified, body_markdown FROM doc_page_cache WHERE url_hash = $1 AND doc_version = $2`,
      [urlHash, options.docVersion],
    );

    const headers: Record<string, string> = {
      "user-agent": "smoldoc/0.1 (+https://github.com/modelcontextprotocol)",
      accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8",
    };
    const row = cached.rows[0];
    if (row?.etag) headers["if-none-match"] = row.etag;
    if (row?.last_modified) headers["if-modified-since"] = row.last_modified;

    const res = await undiciFetch(url, {
      method: "GET",
      headers,
      redirect: "follow",
    });

    if (res.status === 304 && row) {
      results.push({
        url,
        markdown: row.body_markdown,
        etag: row.etag,
        lastModified: row.last_modified,
        status: 304,
        revalidated304: true,
      });
      continue;
    }

    if (!res.ok) {
      throw new Error(`Fetch failed ${res.status} for ${url}`);
    }

    const html = await res.text();
    const markdown = htmlToPlainText(html, options.maxCharsPerPage);
    const etag = res.headers.get("etag");
    const lastModified = res.headers.get("last-modified");
    const contentHash = sha256Hex(markdown);

    await options.pool.query(
      `INSERT INTO doc_page_cache (url_normalized, url_hash, doc_version, etag, last_modified, content_hash, body_markdown)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (url_hash, doc_version) DO UPDATE SET
         etag = EXCLUDED.etag,
         last_modified = EXCLUDED.last_modified,
         content_hash = EXCLUDED.content_hash,
         body_markdown = EXCLUDED.body_markdown,
         fetched_at = now()`,
      [url, urlHash, options.docVersion, etag, lastModified, contentHash, markdown],
    );

    const diskPath = join(
      options.pageCacheDir,
      options.docVersion,
      `${urlHash}.md`,
    );
    await mkdir(dirname(diskPath), { recursive: true });
    await writeFile(diskPath, `# ${url}\n\n${markdown}\n`, "utf8");

    results.push({
      url,
      markdown,
      etag,
      lastModified,
      status: res.status,
      revalidated304: false,
    });
  }
  return results;
}
