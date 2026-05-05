FROM node:22-bookworm-slim

RUN corepack enable && corepack prepare pnpm@9.15.5 --activate

# Pi coding agent (CLI is `pi`); smoldoc uses `pi run` via entrypoint shim
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates \
  && rm -rf /var/lib/apt/lists/* \
  && npm install -g @mariozechner/pi-coding-agent

WORKDIR /app

COPY docker/pi-entrypoint.sh /opt/pi-wrapped/pi-entrypoint.sh
RUN chmod +x /opt/pi-wrapped/pi-entrypoint.sh \
  && mkdir -p /opt/pi-wrapped \
  && REAL_PI="$(command -v pi)" \
  && mv "$REAL_PI" /opt/pi-wrapped/pi-real \
  && ln -sf /opt/pi-wrapped/pi-entrypoint.sh /usr/local/bin/pi

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY packages/server/package.json packages/server/

RUN pnpm install --frozen-lockfile

COPY packages/server packages/server

RUN pnpm --filter @smoldoc/server build

WORKDIR /app/packages/server

# Default: MCP stdio (override in compose for worker)
CMD ["node", "dist/mcp.js"]
