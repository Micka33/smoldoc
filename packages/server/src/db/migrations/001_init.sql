CREATE TABLE IF NOT EXISTS doc_page_cache (
  id BIGSERIAL PRIMARY KEY,
  url_normalized TEXT NOT NULL,
  url_hash TEXT NOT NULL,
  doc_version TEXT NOT NULL,
  etag TEXT,
  last_modified TEXT,
  content_hash TEXT NOT NULL,
  body_markdown TEXT NOT NULL,
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (url_hash, doc_version)
);

CREATE INDEX IF NOT EXISTS idx_doc_page_cache_lookup
  ON doc_page_cache (url_hash, doc_version);

CREATE TABLE IF NOT EXISTS answer_cache (
  id BIGSERIAL PRIMARY KEY,
  cache_key TEXT NOT NULL UNIQUE,
  doc_version TEXT NOT NULL,
  model TEXT NOT NULL,
  answer_markdown TEXT NOT NULL,
  sources_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_answer_cache_created
  ON answer_cache (created_at DESC);
