---
name: fetch-doc
description: Fetch a documentation URL with Layer A cache (conditional HTTP) and optional headless Chromium. Writes raw HTML under .data/smoldoc-raw-cache and updates Postgres doc_page_cache when DATABASE_URL is set.
---

# fetch-doc

## When to use

Use for every HTTP(S) documentation URL before analysis. Prefer cache hits (304) to save bandwidth.

## How

From repo / `SMOLDOC_PI_CWD`, run (adjust `SMOLDOC_SCRIPTS_DIR` if needed — default `packages/server/dist/scripts` after build):

```bash
SMOLDOC_SCRIPTS_DIR="${SMOLDOC_SCRIPTS_DIR:-packages/server/dist/scripts}"
node "$SMOLDOC_SCRIPTS_DIR/fetch-doc.js" \
  --url "https://example.com/docs" \
  --doc-version "{{DOC_VERSION_LABEL}}" \
  --source "{{SOURCE}}" \
  --product "{{PRODUCT}}" \
  ${USE_BROWSER:+--browser}
```

- Set `USE_BROWSER=1` and ensure `chromium` (or `CHROMIUM_PATH`) exists for JS-heavy sites.
- Output is one line of JSON with `bodyPath`, `contentHash`, `fromCache`.

## Next step

Pipe output to `parse-doc` skill using `bodyPath`.
