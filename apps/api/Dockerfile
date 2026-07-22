# Imagem de produção da API (SPEC-027).
#
# Contexto de build = RAIZ do monorepo (não apps/api): o pnpm-workspace.yaml e o
# lockfile vivem lá, e sem eles o install não resolve o workspace.
#
# syntax=docker/dockerfile:1

# ---------- build ----------
FROM node:20-slim AS build

# openssl: o engine do Prisma linka contra ele; a imagem slim não traz.
RUN apt-get update && apt-get install -y --no-install-recommends openssl \
  && rm -rf /var/lib/apt/lists/*

RUN corepack enable
WORKDIR /app

# Sem TTY o pnpm aborta ao recriar node_modules (ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY)
# no install --prod mais abaixo. CI=true é a resposta oficial do próprio erro.
ENV CI=true

# Manifests primeiro: camada de dependências só invalida quando eles mudam.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN pnpm install --frozen-lockfile --filter @proplan/api...

COPY apps/api apps/api

# `prisma generate` ANTES do build. Sem isto o PrismaClient não tem os models e
# o `nest build` quebra com centenas de TS2339 ("Property 'x' does not exist on
# type 'PrismaService'") — foi exatamente o que derrubou o primeiro deploy.
# O pnpm ignora scripts de dependências (postinstall do prisma), então o generate
# tem de ser explícito aqui.
RUN pnpm --filter @proplan/api exec prisma generate
RUN pnpm --filter @proplan/api build

# Reinstala só as deps de produção, já sem devDependencies (nest-cli, jest, ts-*).
# O CLI `prisma` é dependency (não dev) de propósito: o release command roda
# `prisma migrate deploy` na imagem de runtime e precisa dele aqui.
RUN pnpm install --frozen-lockfile --prod --filter @proplan/api...
# O --prod recriou node_modules; o client gerado acima se foi com ele.
RUN pnpm --filter @proplan/api exec prisma generate

# ---------- runtime ----------
FROM node:20-slim AS runtime

RUN apt-get update && apt-get install -y --no-install-recommends openssl \
  && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production
WORKDIR /app

COPY --from=build /app/node_modules node_modules
COPY --from=build /app/apps/api/node_modules apps/api/node_modules
COPY --from=build /app/apps/api/dist apps/api/dist
COPY --from=build /app/apps/api/package.json apps/api/package.json
# schema + migrations: o release command roda `prisma migrate deploy` daqui.
COPY --from=build /app/apps/api/prisma apps/api/prisma

# Usuário não-root (a imagem node já traz `node`).
USER node

WORKDIR /app/apps/api
# A porta real vem de PORT (Railway); EXPOSE é documentação.
EXPOSE 3311
# dist/SRC/main.js: o tsconfig inclui `test/`, então o tsc preserva a estrutura
# de pastas e o entrypoint não cai na raiz do dist.
CMD ["node", "dist/src/main.js"]
