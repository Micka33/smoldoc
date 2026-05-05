import { pickHighestSatisfying } from "../semver/semverRange.js";

/**
 * Resolves `version_range` against a semver candidate list (tags, releases).
 * Returns the chosen label (highest satisfying). Throws if none match.
 */
export function resolveRangeToDocVersionLabel(
  versionRange: string,
  candidates: string[] | undefined,
): string {
  const r = versionRange.trim();
  if (!r) {
    throw new Error("version_range is empty");
  }
  if (!candidates?.length) {
    throw new Error(
      'version_candidates (non-empty string[]) is required when version_policy is "range"',
    );
  }
  const resolved = pickHighestSatisfying(candidates, r);
  if (!resolved) {
    throw new Error(
      `No semver in version_candidates satisfies range "${r}". Candidates: ${JSON.stringify(candidates)}`,
    );
  }
  return resolved;
}
