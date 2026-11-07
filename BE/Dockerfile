# syntax=docker/dockerfile:1
# Backend (NestJS + Prisma). Build context: repository root.
#   docker build -f BE/Dockerfile -t bckl-backend .
FROM node:24-alpine AS build
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY BE/package.json BE/prisma.config.ts BE/
COPY BE/prisma BE/prisma
# postinstall runs `prisma generate`; DATABASE_URL is only read, never contacted, here.
RUN DATABASE_URL=postgresql://build:build@localhost:5432/build pnpm install --frozen-lockfile --filter be...
COPY BE BE
RUN DATABASE_URL=postgresql://build:build@localhost:5432/build pnpm --filter be run build

FROM node:24-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    BACKEND_PORT=3001 \
    UPLOAD_ROOT=/app/uploads
RUN corepack enable && mkdir -p /app/uploads && chown node:node /app/uploads
# Keep the workspace node_modules (Prisma client + CLI for `migrate deploy`).
COPY --from=build --chown=node:node /app/package.json /app/pnpm-workspace.yaml ./
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/BE/package.json /app/BE/prisma.config.ts ./BE/
COPY --from=build --chown=node:node /app/BE/node_modules ./BE/node_modules
COPY --from=build --chown=node:node /app/BE/prisma ./BE/prisma
COPY --from=build --chown=node:node /app/BE/dist ./BE/dist
COPY --chown=node:node BE/docker-entrypoint.sh ./BE/docker-entrypoint.sh
USER node
WORKDIR /app/BE
EXPOSE 3001
VOLUME ["/app/uploads"]
ENTRYPOINT ["sh", "./docker-entrypoint.sh"]
