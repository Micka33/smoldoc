---
name: chunk-embed-index
description: Layer B — chunk markdown, embed with OpenAI text-embedding-3-small, store vectors in Postgres doc_chunks.
---

# chunk-embed-index

Requires `OPENAI_API_KEY` and `DATABASE_URL` (pgvector).

```bash
SMOLDOC_SCRIPTS_DIR="${SMOLDOC_SCRIPTS_DIR:-packages/server/dist/scripts}"
node "$SMOLDOC_SCRIPTS_DIR/chunk-embed-index.js" \
  --url "$CANONICAL_URL" \
  --doc-version "$RESOLVED_VERSION" \
  --file "$PARSED_MD" \
  --source "$SOURCE" \
  --product "$PRODUCT"
```

Run after `parse-doc` when content changed (`content_hash` new or fetch was not 304).
