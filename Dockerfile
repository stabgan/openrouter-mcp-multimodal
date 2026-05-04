FROM node:20-alpine AS builder
WORKDIR /app

RUN apk add --no-cache g++ make python3 vips-dev

COPY package*.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src/ ./src/
RUN npx tsc
RUN npm prune --omit=dev

FROM node:20-alpine
WORKDIR /app

# Required by the official MCP Registry (registry.modelcontextprotocol.io)
# to verify OCI-package ownership: the label value MUST match the `name`
# field in server.json for the registry's verification step to accept us.
# Also provides standard OCI image metadata used by `docker pull` and
# Docker Hub for the listing surface.
LABEL io.modelcontextprotocol.server.name="io.github.stabgan/openrouter-multimodal" \
      org.opencontainers.image.source="https://github.com/stabgan/openrouter-mcp-multimodal" \
      org.opencontainers.image.description="Chat with 300+ LLMs via OpenRouter. Analyze and generate images, audio, and video from MCP." \
      org.opencontainers.image.licenses="Apache-2.0" \
      org.opencontainers.image.title="openrouter-mcp-multimodal"

RUN apk add --no-cache vips

# Drop root. The runtime only needs to read dist/ and node_modules/ and
# write to OPENROUTER_OUTPUT_DIR (provided as a volume by the caller).
RUN addgroup -S app && adduser -S -G app -h /app app

COPY --from=builder --chown=app:app /app/node_modules ./node_modules
COPY --from=builder --chown=app:app /app/dist ./dist
COPY --chown=app:app package.json ./

USER app

ENV NODE_ENV=production
CMD ["node", "dist/index.js"]
