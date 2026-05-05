---
name: detect-version
description: Heuristic semver / version string detection from parsed doc text.
---

# detect-version

```bash
SMOLDOC_SCRIPTS_DIR="${SMOLDOC_SCRIPTS_DIR:-packages/server/dist/scripts}"
node "$SMOLDOC_SCRIPTS_DIR/detect-version.js" --file "$PARSED_MD"
```

Merge with caller `version_target` policy (explicit > detected > `latest`).
