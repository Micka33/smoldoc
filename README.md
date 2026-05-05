# smoldoc

Documentation research **MCP server** (stdio): long jobs are **async MCP tasks** (Redis). A **worker** processes each job with the **[Pi coding agent SDK](https://pi.dev/docs/latest/sdk)** (`createAgentSession` from `@mariozechner/pi-coding-agent`).

The coordinator instructions live in `packages/server/prompts/coordinator.md`: the model **designs and implements its own research harness** (using Pi’s default tools: `read`, `bash`, `write`, `edit`, `grep`, `find`, `ls`), may **parallelize** (e.g. multiple `bash` calls), then returns a **short actionable** answer. The worker passes **`OPENAI_API_KEY`** into Pi via `AuthStorage.setRuntimeApiKey("openai", …)` as in the SDK docs.

PostgreSQL migrations still create cache tables from earlier iterations; the Pi SDK path does not populate them yet.

## Architecture

- **MCP** (`packages/server/dist/mcp.js`): `doc_research` tool with **experimental tasks**; task state in **Redis**.
- **Worker** (`packages/server/dist/worker.js`): **BullMQ** → `createAgentSession` → `session.prompt(...)` → final markdown + optional `SMOLDOC_META_JSON:` line.

## Prerequisites

- Node 22+, pnpm 9
- Docker for Postgres + Redis
- **`OPENAI_API_KEY`** (or `OPENAPI_API_KEY`) on the **worker** process for Pi’s OpenAI provider

## Quick start

```bash
cp .env.example .env
# Set OPENAI_API_KEY, DATABASE_URL, REDIS_URL, SMOLDOC_PI_CWD (repo root)

docker compose up -d postgres redis

pnpm install
pnpm run build

# Terminal 1 — worker (needs OpenAI key in env)
pnpm --filter @smoldoc/server start:worker

# Terminal 2 — MCP stdio
pnpm --filter @smoldoc/server start:mcp
```

### Cursor

Configure `node …/packages/server/dist/mcp.js` with `DATABASE_URL` and `REDIS_URL`. Run the worker on a host that has **`OPENAI_API_KEY`** and set `SMOLDOC_PI_CWD` to your project root if you want the agent to read local files.

Clients must support **MCP tasks** and respect **`pollInterval`** (~30s).

## Environment

| Variable | Where | Purpose |
|----------|--------|---------|
| `DATABASE_URL`, `REDIS_URL` | MCP + worker | Infra |
| `OPENAI_API_KEY` or `OPENAPI_API_KEY` | **Worker only** | Pi OpenAI auth (`setRuntimeApiKey`) |
| `SMOLDOC_PI_CWD` | Worker | Pi session cwd (skills, files) |
| `SMOLDOC_PI_AGENT_DIR` | Worker | Pi `auth.json` / `models.json` dir (default: temp) |
| `SMOLDOC_PI_MODEL` | Worker | OpenAI model id for Pi (default `gpt-5.5`) |
| `SMOLDOC_PI_THINKING` | Worker | Pi thinking level (default `high`) |

## Docker Compose

`docker compose up -d postgres redis` for infra. Profile **`app`** runs MCP + worker images; mount your repo at `/workspace` and set `OPENAI_API_KEY`.

## Stack

TypeScript, `@modelcontextprotocol/server` (v2 alpha), Zod 4, BullMQ, ioredis, pg, **`@mariozechner/pi-coding-agent`** (Pi SDK).
