# smoldoc — Doc reasoning coprocessor (MCP)

**Principal agent** = orchestration / décision finale. **Smoldoc** = spécialiste doc (RAG + analyse + réponse **JSON** actionnable), via **MCP tasks** + worker **Pi SDK**.

Référence Pi : [SDK](https://pi.dev/docs/latest/sdk).

## Architecture

| Couche | Où | Rôle |
|--------|-----|------|
| **Layer A** (raw HTTP + cache fichier + PG `doc_page_cache`) | **Skills Pi** + scripts `dist/scripts/*.js` | `fetch-doc` (curl + ETag + option `--browser` / Chromium), `parse-doc`, `detect-version` |
| **Layer B** (chunks + embeddings pgvector `doc_chunks`) | Même scripts + Postgres | `chunk-embed-index`, `retrieve-evidence` |
| **Semantic cache** | Worker Node + table `semantic_query_cache` | Fingerprint (intent + version policy + scope + URLs) + `doc_set_hash` + modèle + hash du prompt coordinateur |
| **Sortie** | Dernière ligne `SMOLDOC_RESULT_JSON:{...}` | Schéma `SmoldocActionableResult` (Zod) — MCP `structuredContent` |

Les skills vivent sous **`packages/server/.pi/skills/`** (copiés dans `dist/.pi` au build). **`SMOLDOC_PI_CWD`** doit pointer vers **`packages/server`** (ou une copie contenant `.pi/`).

## Prérequis

- Node 22+, pnpm 9
- **Postgres avec pgvector** (image `pgvector/pgvector:pg16` dans `docker-compose.yml`)
- Redis
- **`OPENAI_API_KEY`** sur le **worker** (embeddings + Pi)

## Variables d’environnement

| Variable | Où | Description |
|----------|-----|-------------|
| `DATABASE_URL`, `REDIS_URL` | MCP + worker | Infra |
| `OPENAI_API_KEY` / `OPENAPI_API_KEY` | **Worker** | Pi + embeddings |
| `SMOLDOC_PI_CWD` | Worker | Répertoire Pi (défaut `cwd` → utiliser chemin absolu vers `packages/server`) |
| `SMOLDOC_SCRIPTS_DIR` | Worker + scripts | Défaut `packages/server/dist/scripts` |
| `SMOLDOC_PI_AGENT_DIR` | Worker | Cache auth Pi (`auth.json`) |
| `SMOLDOC_PI_MODEL` | Worker | Modèle OpenAI Pi (ex. `gpt-5.5`) |
| `SMOLDOC_PI_THINKING` | Worker | `high`, etc. |

## Build & run

```bash
docker compose up -d postgres redis   # utilise pgvector

cp .env.example .env
# Renseigner OPENAI_API_KEY, DATABASE_URL, REDIS_URL
# SMOLDOC_PI_CWD=/abs/path/to/repo/packages/server

pnpm install
pnpm run build

pnpm --filter @smoldoc/server start:worker
pnpm --filter @smoldoc/server start:mcp
```

## Outil MCP `doc_research`

Entrée (snake_case) :

- `goal`, `context?`
- `version_policy`: `explicit` | `latest` | `latest_stable` | `range`
- `explicit_version?`, `as_of_date?`, `version_range?`
- `source?`, `product?`, `scope?`
- `urls[]`

Sortie `structuredContent` : `result` (objet typé), `from_answer_cache`, `fingerprint`, `doc_set_hash`, `answer_markdown`, `taskId`.

## Docker profile `app`

`docker compose --profile app up -d --build` — monte le repo sous `/workspace` ; worker avec `SMOLDOC_PI_CWD=/workspace/packages/server`.

## Scripts (Layer A / B)

Après `pnpm run build` :

- `node packages/server/dist/scripts/fetch-doc.js --url … --doc-version … [--browser]`
- `parse-doc.js`, `detect-version.js`, `chunk-embed-index.js`, `retrieve-evidence.js`, `self-check.js`

`CHROMIUM_PATH` peut pointer vers un binaire Chromium custom.
