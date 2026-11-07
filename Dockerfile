# syntax=docker/dockerfile:1

# ---------------------------------------------------------------- build
FROM node:24-slim AS build
WORKDIR /app

COPY package.json package-lock.json ./
COPY apps/server/package.json apps/server/
COPY apps/miniapp/package.json apps/miniapp/
COPY apps/admin/package.json apps/admin/
COPY packages/shared/package.json packages/shared/
COPY packages/web/package.json packages/web/
RUN npm ci --no-audit --no-fund

COPY . .
RUN npm run build

# ---------------------------------------------------------------- runtime
FROM node:24-slim AS runtime
ENV NODE_ENV=production \
    UPLOAD_DIR=/data/uploads
WORKDIR /app

COPY package.json package-lock.json ./
COPY apps/server/package.json apps/server/
COPY apps/miniapp/package.json apps/miniapp/
COPY apps/admin/package.json apps/admin/
COPY packages/shared/package.json packages/shared/
COPY packages/web/package.json packages/web/
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force

COPY --from=build /app/apps/server/dist apps/server/dist
COPY --from=build /app/apps/server/drizzle apps/server/drizzle
COPY --from=build /app/apps/miniapp/dist apps/miniapp/dist
COPY --from=build /app/apps/admin/dist apps/admin/dist

RUN mkdir -p /data/uploads && chown -R node:node /data
USER node
VOLUME ["/data/uploads"]
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# Миграции применяются при каждом старте (идемпотентно), затем запускается сервер.
CMD ["sh", "-c", "node apps/server/dist/migrate.js && exec node apps/server/dist/index.js"]
