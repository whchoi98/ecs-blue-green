FROM --platform=linux/arm64 node:20-alpine AS deps
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund

FROM --platform=linux/arm64 node:20-alpine AS runtime
RUN addgroup -g 1001 nodejs && adduser -D -G nodejs -u 1001 nodejs
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY server.js package.json ./
USER nodejs
EXPOSE 3000
CMD ["node", "server.js"]
