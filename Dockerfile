FROM node:22-bookworm-slim

RUN corepack enable && corepack prepare pnpm@9.15.5 --activate

WORKDIR /app

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY packages/server/package.json packages/server/

RUN pnpm install --frozen-lockfile

COPY packages/server packages/server

RUN pnpm --filter @smoldoc/server build

WORKDIR /app/packages/server

# Default: MCP stdio (override in compose for worker)
CMD ["node", "dist/mcp.js"]
