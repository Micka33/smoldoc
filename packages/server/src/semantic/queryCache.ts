import type { Pool } from "pg";
import {
  type EvidenceItem,
  type SmoldocActionableResult,
  smoldocActionableResultSchema,
} from "../types/actionableResult.js";

export async function getSemanticCachedAnswer(options: {
  pool: Pool;
  fingerprint: string;
  docSetHash: string;
  model: string;
  analyzerPromptHash: string;
}): Promise<SmoldocActionableResult | null> {
  const r = await options.pool.query<{
    result_json: unknown;
  }>(
    `SELECT result_json FROM semantic_query_cache
     WHERE fingerprint = $1 AND doc_set_hash = $2 AND model = $3 AND analyzer_prompt_hash = $4
     LIMIT 1`,
    [
      options.fingerprint,
      options.docSetHash,
      options.model,
      options.analyzerPromptHash,
    ],
  );
  if (!r.rows[0]) return null;
  return smoldocActionableResultSchema.parse(r.rows[0].result_json);
}

export async function putSemanticCachedAnswer(options: {
  pool: Pool;
  fingerprint: string;
  docSetHash: string;
  model: string;
  analyzerPromptHash: string;
  result: SmoldocActionableResult;
  evidence: EvidenceItem[];
  sourcesUsed: string[];
}): Promise<void> {
  await options.pool.query(
    `INSERT INTO semantic_query_cache (
       fingerprint, doc_set_hash, model, analyzer_prompt_hash,
       result_json, evidence_json, sources_used, confidence, needs_human_review
     ) VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7::jsonb, $8, $9)
     ON CONFLICT (fingerprint, doc_set_hash, model, analyzer_prompt_hash) DO UPDATE SET
       result_json = EXCLUDED.result_json,
       evidence_json = EXCLUDED.evidence_json,
       sources_used = EXCLUDED.sources_used,
       confidence = EXCLUDED.confidence,
       needs_human_review = EXCLUDED.needs_human_review,
       created_at = now()`,
    [
      options.fingerprint,
      options.docSetHash,
      options.model,
      options.analyzerPromptHash,
      JSON.stringify(options.result),
      JSON.stringify(options.evidence),
      JSON.stringify(options.sourcesUsed),
      options.result.confidence,
      options.result.needs_human_review,
    ],
  );
}
