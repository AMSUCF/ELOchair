# syntax=docker/dockerfile:1
# Build from the repository root:  docker compose -f deploy/docker-compose.yml build
# Behind a TLS-intercepting proxy (common on university networks), pass its CA certificate:
#   docker build --secret id=extra_ca,src=/path/to/proxy-ca.crt -f deploy/Dockerfile .

FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/schema/package.json packages/schema/
COPY packages/policy/package.json packages/policy/
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
RUN --mount=type=secret,id=extra_ca,required=false \
    if [ -f /run/secrets/extra_ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/extra_ca; fi; \
    npm ci --ignore-scripts
COPY . .
RUN npm run build -w @elochair/web && npm run build -w @elochair/server

FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/schema/package.json packages/schema/
COPY packages/policy/package.json packages/policy/
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
RUN --mount=type=secret,id=extra_ca,required=false \
    if [ -f /run/secrets/extra_ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/extra_ca; fi; \
    npm ci --omit=dev --ignore-scripts -w @elochair/server && npm cache clean --force
COPY --from=build /app/apps/server/dist apps/server/dist
COPY --from=build /app/apps/server/drizzle apps/server/drizzle
COPY --from=build /app/apps/web/dist apps/web/dist
ENV WEB_DIST=/app/apps/web/dist \
    MIGRATIONS_DIR=/app/apps/server/drizzle \
    PUBLIC_HOST=0.0.0.0 \
    PUBLIC_PORT=8080 \
    INTERNAL_HOST=0.0.0.0 \
    INTERNAL_PORT=8081
USER node
EXPOSE 8080 8081
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:8080/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "apps/server/dist/main.js"]
