# Both FROM lines must pin the same digest; Dependabot cannot update an ARG-defined base image.
FROM node:24-alpine@sha256:e67514e5d0f6c46656005e1b693b2ec9d52e80b641307de684d4a015ba7a4eaf AS builder
WORKDIR /app

RUN apk add --no-cache g++ make python3 vips-dev

COPY package*.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src/ ./src/
RUN npx tsc
RUN npm prune --omit=dev

FROM node:24-alpine@sha256:e67514e5d0f6c46656005e1b693b2ec9d52e80b641307de684d4a015ba7a4eaf
WORKDIR /app

ARG IMAGE_VERSION=dev

# io.modelcontextprotocol.server.name MUST match server.json `name` for MCP Registry verification.
LABEL io.modelcontextprotocol.server.name="io.github.stabgan/openrouter-multimodal" \
      org.opencontainers.image.source="https://github.com/stabgan/openrouter-mcp-multimodal" \
      org.opencontainers.image.description="Chat with 300+ LLMs via OpenRouter. Analyze and generate images, audio, and video from MCP." \
      org.opencontainers.image.licenses="Apache-2.0" \
      org.opencontainers.image.title="openrouter-mcp-multimodal" \
      org.opencontainers.image.version="${IMAGE_VERSION}"

RUN apk add --no-cache vips

RUN addgroup -S app && adduser -S -G app -h /app app

COPY --from=builder --chown=app:app /app/node_modules ./node_modules
COPY --from=builder --chown=app:app /app/dist ./dist
COPY --chown=app:app package.json ./

USER app

ENV NODE_ENV=production
# Exec form: no shell wrapper; stdout stays clean for MCP stdio JSON-RPC.
CMD ["node", "dist/index.js"]
