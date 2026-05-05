---
name: resolve-version
description: Resolve a semver range against an explicit candidate list (tags/releases). Uses the same logic as the MCP server when version_policy is range.
---

# resolve-version

When the principal agent passes `version_policy: range`, the **MCP server** already picks the highest matching version into `docVersion`. Use this skill to **re-check** or resolve locally from a refreshed tag list:

```bash
SMOLDOC_SCRIPTS_DIR="${SMOLDOC_SCRIPTS_DIR:-packages/server/dist/scripts}"
node "$SMOLDOC_SCRIPTS_DIR/resolve-version.js" \
  --range ">=2.0.0 <3.0.0" \
  --candidates-json '["2.0.0","2.5.1","3.0.0"]'
```

Exit code `0` only if a match exists; stdout is JSON with `resolved_version`.

Supported operators in one string (space-separated): `>=` `<=` `>` `<` `^` `~` and bare `1.2.3` (equality).
