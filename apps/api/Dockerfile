# Build context is the repository root.
FROM oven/bun:1.4.3-slim
WORKDIR /app

COPY package.json bun.lock bunfig.toml ./
COPY apps/api/package.json apps/api/
COPY apps/corpus/package.json apps/corpus/
COPY apps/mobile/package.json apps/mobile/
COPY packages/api-client/package.json packages/api-client/
COPY packages/db/package.json packages/db/
COPY packages/llm/package.json packages/llm/
COPY packages/recognition/package.json packages/recognition/
COPY packages/schema/package.json packages/schema/
RUN bun install --frozen-lockfile --production --filter @snapcook/api

COPY packages/db packages/db
COPY packages/llm packages/llm
COPY packages/recognition packages/recognition
COPY packages/schema packages/schema
COPY apps/api apps/api

# The data directories belong to the user the API runs as, and a new volume takes that over.
RUN mkdir -p /data/snaps /data/images && chown -R bun:bun /data

USER bun
ENV NODE_ENV=production PORT=3000
EXPOSE 3000
CMD ["bun", "apps/api/src/index.ts"]
