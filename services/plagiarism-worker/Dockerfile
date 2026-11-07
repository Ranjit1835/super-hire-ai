# Cloud Run image for the plagiarism worker. tree-sitter parsers are native modules, built here on Linux.
FROM node:22-bookworm-slim AS build
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev || npm install --omit=dev
COPY src ./src
COPY test ./test
# Fail the build if Dolos can't actually compare code (native parsers missing or broken).
RUN DOLOS_REQUIRED=1 node --test "test/*.test.mjs"

FROM node:22-bookworm-slim
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./
COPY --from=build /app/src ./src
USER node
EXPOSE 8080
CMD ["node", "src/server.mjs"]
