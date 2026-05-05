RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates chromium \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY packages/server/package.json packages/server/

RUN pnpm install --frozen-lockfile

COPY packages/server packages/server

RUN pnpm --filter @smoldoc/server build

WORKDIR /app/packages/server

# Default: MCP stdio (override in compose for worker)
CMD ["node", "dist/mcp.js"]
