---
name: retrieve-evidence
description: Layer B retrieval — semantic search over doc_chunks for the user goal / question.
---

# retrieve-evidence

```bash
SMOLDOC_SCRIPTS_DIR="${SMOLDOC_SCRIPTS_DIR:-packages/server/dist/scripts}"
node "$SMOLDOC_SCRIPTS_DIR/retrieve-evidence.js" \
  --query "$GOAL_OR_SUBQUESTION" \
  --doc-version "$RESOLVED_VERSION" \
  --k 10
```

Returns JSON `{ evidence: [{ url, excerpt, distance }] }`. Use excerpts to ground the final answer.
