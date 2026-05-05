import * as z from "zod";

/** Evidence snippet tied to a URL (for audit + cache invalidation). */
export const evidenceItemSchema = z.object({
  url: z.string(),
  excerpt: z.string(),
  title: z.string().optional(),
});

export type EvidenceItem = z.infer<typeof evidenceItemSchema>;

/** Strict structured answer for the principal agent (MCP `structuredContent`). */
export const smoldocActionableResultSchema = z.object({
  recommended_action: z.string(),
  command: z.string().optional(),
  example: z.string().optional(),
  assumptions: z.array(z.string()).default([]),
  version_target: z.string(),
  sources: z.array(z.string().url()),
  confidence: z.number().min(0).max(1),
  needs_human_review: z.boolean(),
  evidence: z.array(evidenceItemSchema).default([]),
  /** Human-readable summary (optional duplicate for logs). */
  answer_summary: z.string().optional(),
  pages_fetched: z.number().int().nonnegative().default(0),
  parallel_branches: z.number().int().nonnegative().default(0),
});

export type SmoldocActionableResult = z.infer<typeof smoldocActionableResultSchema>;

/** Parse coordinator final line `SMOLDOC_RESULT_JSON:{...}` */
export function parseSmoldocResultJson(fullText: string): {
  markdownBody: string;
  result: SmoldocActionableResult | null;
  parseError?: string;
} {
  const lines = fullText.split("\n");
  let jsonLineIdx = -1;
  let jsonStr = "";
  for (let i = lines.length - 1; i >= 0; i--) {
    const t = lines[i].trim();
    if (!t.startsWith("SMOLDOC_RESULT_JSON:")) continue;
    jsonLineIdx = i;
    jsonStr = t.slice("SMOLDOC_RESULT_JSON:".length).trim();
    break;
  }
  const markdownBody =
    jsonLineIdx === -1 ? fullText.trim() : lines.slice(0, jsonLineIdx).join("\n").trimEnd();

  if (!jsonStr) {
    return { markdownBody, result: null, parseError: "missing SMOLDOC_RESULT_JSON" };
  }
  try {
    const raw = JSON.parse(jsonStr) as unknown;
    const parsed = smoldocActionableResultSchema.safeParse(raw);
    if (!parsed.success) {
      return {
        markdownBody,
        result: null,
        parseError: parsed.error.message,
      };
    }
    return { markdownBody, result: parsed.data };
  } catch (e) {
    return {
      markdownBody,
      result: null,
      parseError: e instanceof Error ? e.message : String(e),
    };
  }
}
