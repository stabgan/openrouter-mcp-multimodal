FROM node:20-alpine AS builder
WORKDIR /app

RUN apk add --no-cache g++ make python3 vips-dev

COPY package*.json ./
RUN node -e "const p=require('./package.json');delete p.scripts.prepare;require('fs').writeFileSync('./package.json',JSON.stringify(p,null,2));"
RUN npm ci

COPY tsconfig.json ./
COPY src/ ./src/
RUN npx tsc
RUN npm prune --omit=dev

FROM node:20-alpine
WORKDIR /app

RUN apk add --no-cache vips

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY package.json ./

ENV NODE_ENV=production
CMD ["node", "dist/index.js"]
