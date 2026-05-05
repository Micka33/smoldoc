---
name: self-check
description: Optional sanity check that command tokens appear in evidence text.
---

# self-check

```bash
SMOLDOC_SCRIPTS_DIR="${SMOLDOC_SCRIPTS_DIR:-packages/server/dist/scripts}"
node "$SMOLDOC_SCRIPTS_DIR/self-check.js" \
  --command "$PROPOSED_COMMAND" \
  --evidence-json "$EVIDENCE_JSON_STRING"
```

If `{ "ok": false }`, set `needs_human_review: true` and lower `confidence`.
