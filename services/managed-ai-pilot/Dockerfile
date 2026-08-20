FROM node:22-bookworm-slim AS build

WORKDIR /workspace
COPY package.json package-lock.json tsconfig.base.json ./
COPY apps/mobile/package.json apps/mobile/package.json
COPY apps/mobile/modules/sherpa-vad/package.json apps/mobile/modules/sherpa-vad/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/contracts/src packages/contracts/src
COPY packages/ai-parse-prompt/package.json packages/ai-parse-prompt/package.json
COPY packages/ai-parse-prompt/src packages/ai-parse-prompt/src
COPY services/managed-ai-pilot/package.json services/managed-ai-pilot/package.json
COPY services/managed-ai-pilot/tsconfig.json services/managed-ai-pilot/tsconfig.json
COPY services/managed-ai-pilot/tsconfig.build.json services/managed-ai-pilot/tsconfig.build.json
COPY services/managed-ai-pilot/src services/managed-ai-pilot/src
RUN npm ci --legacy-peer-deps
RUN npm run build -w @bookkeeping/managed-ai-pilot

FROM node:22-bookworm-slim AS runtime

ENV NODE_ENV=production
WORKDIR /app
RUN apt-get update \
  && apt-get install -y --no-install-recommends dumb-init ca-certificates \
  && rm -rf /var/lib/apt/lists/* \
  && groupadd --system --gid 1001 app \
  && useradd --system --uid 1001 --gid app app
COPY services/managed-ai-pilot/package.runtime.json ./package.json
RUN npm install --omit=dev --ignore-scripts=false --no-audit --no-fund --legacy-peer-deps \
  && npm cache clean --force
COPY --from=build /workspace/services/managed-ai-pilot/dist ./dist
RUN mkdir -p /app/data && chown -R app:app /app
USER app
EXPOSE 18084
ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "dist/server.js"]
