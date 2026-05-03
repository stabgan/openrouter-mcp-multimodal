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
      org.opencontainers.image.licenses="MIT" \
      org.opencontainers.image.title="openrouter-mcp-multimodal"

RUN apk add --no-cache vips

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY package.json ./

ENV NODE_ENV=production
CMD ["node", "dist/index.js"]
