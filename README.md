# smoldoc

Documentation research **MCP server** (stdio): fetches public doc URLs, caches pages in **PostgreSQL** + on-disk markdown, deduplicates synthesized answers by `(goal, urls, docVersion, model)`, and returns a **short actionable answer** via **MCP tasks** so the host does not block on HTTP for minutes.

## Architecture

- **MCP process** (`packages/server`): registers `doc_research` as an **experimental task tool** (`taskSupport: required`). Task state lives in **Redis** (`RedisTaskStore`).
- **Worker process** (`packages/server`): **BullMQ** consumer that performs fetch + OpenAI synthesis, then writes the final `CallToolResult` into the task store.

Both processes need `DATABASE_URL`, `REDIS_URL`, and an OpenAI key (`OPENAI_API_KEY`, or `OPENAPI_API_KEY` as an alias).

## Prerequisites

- Node 20+ (repo targets 22)
- `pnpm` 9
- Docker (for Postgres + Redis)

## Quick start (local MCP + Docker infra)

```bash
cp .env.example .env
# edit .env: OPENAI_API_KEY, DATABASE_URL, REDIS_URL

docker compose up -d postgres redis

cd packages/server
pnpm install
pnpm run build

# terminal 1
pnpm run start:worker

# terminal 2 (stdio MCP — used by Cursor / Claude Desktop)
pnpm run start:mcp
```

### Cursor / Claude Desktop

Point the MCP config at:

```json
{
  "mcpServers": {
    "smoldoc": {
      "command": "node",
      "args": ["/absolute/path/to/repo/packages/server/dist/mcp.js"],
      "env": {
        "DATABASE_URL": "postgresql://smoldoc:smoldoc@127.0.0.1:5432/smoldoc",
        "REDIS_URL": "redis://127.0.0.1:6379",
        "OPENAI_API_KEY": "sk-..."
      }
    }
  }
}
```

**Important:** the client must support **MCP tasks** (tools/call with task augmentation, `tasks/get`, `tasks/result`). The tool advertises `pollInterval` of **30s**—poll status at that interval, not on every token tick.

## Tool: `doc_research`

Parameters:

- `goal` — precise question for the docs
- `context` — optional short caller context
- `docVersion` — version label for cache invalidation (e.g. `v1.2.3`)
- `urls` — 1–32 HTTP(S) documentation URLs

Flow:

1. `tools/call` with task params → receive `taskId` and `pollInterval`
2. `tasks/get` until `status` is `completed` or `failed` (respect `pollInterval`)
3. `tasks/result` → `CallToolResult` with markdown in `content` and metadata in `structuredContent`

## Docker Compose (optional all-in-one)

Infra only (default):

```bash
docker compose up -d postgres redis
```

Full stack (MCP + worker in containers; stdio MCP is awkward from Compose—prefer local `start:mcp` for IDE integration):

```bash
export OPENAI_API_KEY=sk-...
docker compose --profile app up -d --build
```

## Environment

See `.env.example`. Optional `SMOLDOC_ALLOWED_HOSTS` (comma-separated) restricts outbound fetches.

## Stack

- TypeScript, `@modelcontextprotocol/server` (v2 alpha), Zod 4, BullMQ, ioredis, pg, OpenAI Node SDK, undici
