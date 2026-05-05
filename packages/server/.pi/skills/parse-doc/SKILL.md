---
name: parse-doc
description: Convert cached HTML from fetch-doc into canonical markdown text for chunking.
---

# parse-doc

```bash
SMOLDOC_SCRIPTS_DIR="${SMOLDOC_SCRIPTS_DIR:-packages/server/dist/scripts}"
node "$SMOLDOC_SCRIPTS_DIR/parse-doc.js" --input "$BODY_PATH" --out "$OUT_MD"
```

Use `OUT_MD` as input to `chunk-embed-index`.
