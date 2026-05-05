/**
 * Minimal semver 2 (major.minor.patch + optional prerelease) for version range resolution.
 * Covers common doc cases: v1.2.3, 1.2.3, 1.2.3-beta.1
 */

export type ParsedSemver = {
  raw: string;
  major: number;
  minor: number;
  patch: number;
  prerelease: string | null;
};

function stripV(s: string): string {
  return s.trim().replace(/^v/i, "");
}

export function parseSemver(input: string): ParsedSemver | null {
  const s = stripV(input);
  const m = s.match(/^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?/);
  if (!m) return null;
  return {
    raw: input.trim(),
    major: Number(m[1]),
    minor: Number(m[2]),
    patch: Number(m[3]),
    prerelease: m[4] ?? null,
  };
}

function prereleaseCompare(a: string | null, b: string | null): number {
  if (a === b) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  const pa = a.split(".");
  const pb = b.split(".");
  const n = Math.max(pa.length, pb.length);
  for (let i = 0; i < n; i++) {
    const x = pa[i];
    const y = pb[i];
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    const nx = /^\d+$/.test(x) ? Number(x) : NaN;
    const ny = /^\d+$/.test(y) ? Number(y) : NaN;
    if (!Number.isNaN(nx) && !Number.isNaN(ny)) {
      if (nx !== ny) return nx < ny ? -1 : 1;
    } else if (x !== y) {
      return x < y ? -1 : x > y ? 1 : 0;
    }
  }
  return 0;
}

export function compareSemver(a: ParsedSemver, b: ParsedSemver): number {
  if (a.major !== b.major) return a.major < b.major ? -1 : 1;
  if (a.minor !== b.minor) return a.minor < b.minor ? -1 : 1;
  if (a.patch !== b.patch) return a.patch < b.patch ? -1 : 1;
  return prereleaseCompare(a.prerelease, b.prerelease);
}

export type RangeConstraint =
  | { kind: "gte"; v: ParsedSemver }
  | { kind: "gt"; v: ParsedSemver }
  | { kind: "lte"; v: ParsedSemver }
  | { kind: "lt"; v: ParsedSemver }
  | { kind: "caret"; v: ParsedSemver }
  | { kind: "tilde"; v: ParsedSemver }
  | { kind: "eq"; v: ParsedSemver };

function parseConstraintToken(token: string): RangeConstraint | null {
  const t = token.trim();
  if (!t) return null;
  if (t.startsWith(">=")) {
    const v = parseSemver(t.slice(2));
    return v ? { kind: "gte", v } : null;
  }
  if (t.startsWith("<=")) {
    const v = parseSemver(t.slice(2));
    return v ? { kind: "lte", v } : null;
  }
  if (t.startsWith(">")) {
    const v = parseSemver(t.slice(1));
    return v ? { kind: "gt", v } : null;
  }
  if (t.startsWith("<")) {
    const v = parseSemver(t.slice(1));
    return v ? { kind: "lt", v } : null;
  }
  if (t.startsWith("^")) {
    const v = parseSemver(t.slice(1));
    return v ? { kind: "caret", v } : null;
  }
  if (t.startsWith("~")) {
    const v = parseSemver(t.slice(1));
    return v ? { kind: "tilde", v } : null;
  }
  const v = parseSemver(t);
  return v ? { kind: "eq", v } : null;
}

function satisfiesConstraint(x: ParsedSemver, c: RangeConstraint): boolean {
  switch (c.kind) {
    case "eq":
      return compareSemver(x, c.v) === 0;
    case "gte":
      return compareSemver(x, c.v) >= 0;
    case "gt":
      return compareSemver(x, c.v) > 0;
    case "lte":
      return compareSemver(x, c.v) <= 0;
    case "lt":
      return compareSemver(x, c.v) < 0;
    case "caret": {
      const base = c.v;
      const upper: ParsedSemver = {
        raw: "",
        major: base.major + 1,
        minor: 0,
        patch: 0,
        prerelease: null,
      };
      return compareSemver(x, base) >= 0 && compareSemver(x, upper) < 0;
    }
    case "tilde": {
      const base = c.v;
      const upper: ParsedSemver = {
        raw: "",
        major: base.major,
        minor: base.minor + 1,
        patch: 0,
        prerelease: null,
      };
      return compareSemver(x, base) >= 0 && compareSemver(x, upper) < 0;
    }
    default: {
      const _e: never = c;
      return _e;
    }
  }
}

export function parseCompositeRange(rangeStr: string): RangeConstraint[] {
  const parts = rangeStr.trim().split(/\s+/).filter(Boolean);
  const out: RangeConstraint[] = [];
  for (const p of parts) {
    const c = parseConstraintToken(p);
    if (c) out.push(c);
  }
  return out;
}

export function versionSatisfiesRange(versionLabel: string, rangeStr: string): boolean {
  const x = parseSemver(versionLabel);
  if (!x) return false;
  const constraints = parseCompositeRange(rangeStr);
  if (constraints.length === 0) return false;
  return constraints.every((c) => satisfiesConstraint(x, c));
}

export function pickHighestSatisfying(
  candidates: string[],
  rangeStr: string,
): string | null {
  const parsed: ParsedSemver[] = [];
  for (const c of candidates) {
    const p = parseSemver(c);
    if (p) parsed.push({ ...p, raw: c.trim() });
  }
  if (parsed.length === 0) return null;
  const ok = parsed.filter((p) => versionSatisfiesRange(p.raw, rangeStr));
  if (ok.length === 0) return null;
  ok.sort((a, b) => compareSemver(b, a));
  return ok[0].raw;
}
