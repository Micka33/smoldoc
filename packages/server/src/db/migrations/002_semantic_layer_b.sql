-- Layer B: chunked content + embeddings for retrieval (skills populate via scripts)
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS doc_chunks (
  id BIGSERIAL PRIMARY KEY,
  url_hash TEXT NOT NULL,
  url_normalized TEXT NOT NULL,
  page_path TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL DEFAULT '',
  product TEXT NOT NULL DEFAULT '',
  doc_version_label TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  chunk_index INT NOT NULL,
  body TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  embedding vector(1536),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (url_hash, doc_version_label, content_hash, chunk_index)
);

CREATE INDEX IF NOT EXISTS idx_doc_chunks_lookup
  ON doc_chunks (url_hash, doc_version_label);

-- Semantic query cache (worker): fingerprint + doc set + model
CREATE TABLE IF NOT EXISTS semantic_query_cache (
  id BIGSERIAL PRIMARY KEY,
  fingerprint TEXT NOT NULL,
  doc_set_hash TEXT NOT NULL,
  model TEXT NOT NULL,
  analyzer_prompt_hash TEXT NOT NULL DEFAULT '',
  result_json JSONB NOT NULL,
  evidence_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  sources_used JSONB NOT NULL DEFAULT '[]'::jsonb,
  confidence REAL,
  needs_human_review BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (fingerprint, doc_set_hash, model, analyzer_prompt_hash)
);

CREATE INDEX IF NOT EXISTS idx_semantic_cache_fingerprint
  ON semantic_query_cache (fingerprint);

-- Extend raw snapshot table from v001 (Layer B linkage / worker metrics optional)
ALTER TABLE doc_page_cache
  ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS product TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS page_path TEXT NOT NULL DEFAULT '';
