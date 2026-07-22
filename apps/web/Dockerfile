# Imagem de produção do web — SPA estática atrás de nginx (SPEC-027).
#
# Contexto de build = RAIZ do monorepo (ver Dockerfile da api).
#
# syntax=docker/dockerfile:1

# ---------- build ----------
FROM node:20-slim AS build

RUN corepack enable
WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json apps/web/
COPY apps/api/package.json apps/api/
RUN pnpm install --frozen-lockfile --filter @proplan/web...

COPY apps/web apps/web

# VITE_API_URL é resolvida em BUILD, não em runtime — trocar a URL da API exige
# rebuild deste serviço (DEPLOY.md §3.2). Por isso entra como build arg.
ARG VITE_API_URL
ENV VITE_API_URL=${VITE_API_URL}
RUN pnpm --filter @proplan/web build

# ---------- runtime ----------
FROM nginx:1.27-alpine AS runtime

COPY --from=build /app/apps/web/dist /usr/share/nginx/html
COPY apps/web/nginx.conf /etc/nginx/templates/default.conf.template

# A imagem nginx já roda envsubst sobre /etc/nginx/templates/*.template no
# entrypoint, gerando /etc/nginx/conf.d/default.conf com o $PORT do Railway.
ENV PORT=8080
EXPOSE 8080
