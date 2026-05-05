# smoldoc

Documentation research **MCP server** (stdio): the heavy work runs in a **worker** that shells out to **[pi](https://github.com/badlogic/pi-mono)** (`pi run -p` by default). The coordinator prompt (`packages/server/prompts/coordinator.md`) instructs pi to **plan**, optionally **spawn parallel `pi run` children**, use pi’s **tool harness** (`bash`, `read`, `grep`, …), then return a **short actionable answer**. Results are delivered via **MCP tasks** (Redis-backed) so the host does not block for minutes.

PostgreSQL still holds the **schema** from earlier iterations (page/answer cache tables); the current pi path does not populate them yet—treat that as reserved for future smoldoc-native tools or a pi extension.

## Architecture

- **MCP process** (`packages/server`): registers `doc_research` as an **experimental task tool** (`taskSupport: required`). Task state lives in **Redis** (`RedisTaskStore`).
- **Worker process** (`packages/server`): **BullMQ** consumer that runs **`pi run -p`** with the coordinator prompt, then writes the final `CallToolResult` into the task store.

Processes need **`DATABASE_URL`**, **`REDIS_URL`**, and a machine where **`pi`** is installed and authenticated (API keys for the provider pi uses, e.g. `OPENAI_API_KEY`).

## Prerequisites

- Node 20+ (repo targets 22)
- `pnpm` 9
- Docker (for Postgres + Redis)
- **Pi coding agent**: `npm install -g @mariozechner/pi-coding-agent` (upstream CLI is `pi`; smoldoc defaults to **`pi run`**—see below)

### `pi run` vs upstream `pi`

Upstream documents non-interactive use as **`pi -p "…"`**. smoldoc standardizes on **`pi run …`** so coordinator prompts can tell the model to spawn **`pi run -p "…"`** children consistently.

- **On the host:** add a small wrapper named `pi` that handles `run`, or set `SMOLDOC_PI_COMMAND=pi` to call `pi` directly (children in the prompt should then use the same).
- **In Docker:** the image installs `@mariozechner/pi-coding-agent` and replaces the `pi` binary with a **shim** so **`pi run`** forwards to **`pi-real`** (the original CLI).

## Quick start (local MCP + Docker infra)

```bash
cp .env.example .env
# edit .env: DATABASE_URL, REDIS_URL, SMOLDOC_PI_CWD (repo root), provider keys for pi

docker compose up -d postgres redis

cd packages/server
pnpm install
pnpm run build

# terminal 1 — needs `pi` on PATH and provider auth
pnpm run start:worker

# terminal 2 (stdio MCP — Cursor / Claude Desktop)
pnpm run start:mcp
```

### Cursor / Claude Desktop

Point the MCP config at `packages/server/dist/mcp.js` and pass **`DATABASE_URL`** + **`REDIS_URL`**. The **worker** machine (often the same host) must run `start:worker` with **`pi`** available.

**Important:** the client must support **MCP tasks** (`tasks/get`, `tasks/result`). Respect **`pollInterval`** (30s)—do not poll every second.

## Tool: `doc_research`

Parameters: `goal`, optional `context`, `docVersion`, `urls` (1–32).

Structured result includes `parallelChildRuns` (from the coordinator’s trailing `SMOLDOC_META_JSON:` line when present).

## Docker Compose

- **Default:** `postgres` + `redis` only.
- **Profile `app`:** builds an image with Node + **pi** + shim; runs `smoldoc-mcp` and `smoldoc-worker`. Pass provider keys (e.g. `OPENAI_API_KEY`) for pi.

## Environment

See `.env.example` for **`SMOLDOC_PI_*`** variables (`SMOLDOC_PI_COMMAND`, `SMOLDOC_PI_CWD`, `SMOLDOC_PI_EXTRA_ARGS`, optional `--model` / `--provider` / `--thinking`).

## Stack

TypeScript, `@modelcontextprotocol/server` (v2 alpha), Zod 4, BullMQ, ioredis, pg; **pi** (`@mariozechner/pi-coding-agent`) for doc research execution.
