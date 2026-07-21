---
proplan: v1
spec: SPEC-025
fatia: pós-MVP1 · Frente Identidade (2/2) — depende da SPEC-026
status: aprovada-pi # rascunho | aprovada-pi | em-implementacao | entregue | aceita-pi
updated: 2026-07-20
---
# SPEC-025 — Configurações: desconectar / reconectar o GitHub

> **Pós-MVP1. Depende da SPEC-026** (costura identidade ⊥ conexão). Sem a sessão de app independente que a SPEC-026 introduz, desconectar o GitHub seria deslogar — este comportamento não-destrutivo só existe depois dela. Ver ADR-021 (atualização 2026-07-20).

## Objetivo

Dar ao dono uma tela de Configurações onde ele **desconecta** a conexão com o GitHub (o ProPlan para de acessar suas docs) **sem perder a sessão do app**, e **reconecta** (refaz o OAuth do App) quando quiser. Desconectar cai no **Catálogo** com um botão *conectar GitHub* — o usuário continua dentro do produto.

## Escopo

1. **Página de Configurações** (`/settings`, no shell da SPEC-020), acessível pelo menu do usuário, com seções **Tema · Conta/Identidade · IA** (a de Conta/Identidade nasce com a SPEC-026 — `/settings` é criada uma vez só, coordenada entre as duas specs).
2. **Desconectar GitHub**: botão **vermelho** rotulado **"Desconectar GitHub"**. Revoga o **token user-to-server** (OAuth do App) e encerra a conexão. Diálogo de confirmação. A **sessão do app (identidade, SPEC-026) permanece** — não desloga (distinto de **"Sair da conta"**, rótulo neutro, SPEC-026).
3. **Destino pós-desconexão**: **Catálogo**, sem repositórios vivos (sem leitura no GitHub), exibindo o CTA *conectar GitHub*.
4. **Índice já ingerido**: **mantido em modo read-only** — os projetos antes gerenciados aparecem como **cards read-only com selo "GitHub desconectado"** (preserva a memória do produto; reconectar reidrata).
5. **Reconectar GitHub**: refaz o OAuth do App (mesmo de *conectar GitHub* no catálogo). As **instalações do App persistem no GitHub** — reconectar reidrata sem reinstalação.
6. **Distinguir na UI** três ações hoje confundíveis: *desgerenciar repo* (índice local, SPEC-021) · *desinstalar o App* (github.com, via link) · *desconectar do GitHub* (revoga a autorização, mantém a sessão).

## Fora de escopo

- **Sair da conta** (encerrar a sessão da SPEC-026) — ação separada no mesmo menu, especificada com a SPEC-026.
- Desinstalar o App de repos/orgs pela nossa UI — ato do dono no github.com (só o link). O App não se desinstala server-side.
- Introduzir a identidade/sessão de app e o Google — SPEC-026, pré-requisito.
- Mudança no fluxo de login/instalação em si (SPEC-021/SPEC-008).

## Critérios de aceite

- [ ] Pelo menu do usuário, o dono abre Configurações e vê **Desconectar GitHub** (botão vermelho), com diálogo que descreve o efeito.
- [ ] Ao desconectar, o token user-to-server é **revogado** (não só descartado localmente); a **sessão do app permanece ativa**.
- [ ] Após desconectar, o usuário cai no **Catálogo**: projetos antes gerenciados aparecem como **cards read-only com selo "GitHub desconectado"**, com CTA *conectar GitHub*; nenhuma leitura/escrita ocorre no GitHub em nome dele.
- [ ] **Reconectar** completa o OAuth e o catálogo/cards voltam a ficar vivos, **sem** reinstalar o App.
- [ ] A tela diferencia visualmente *desgerenciar repo* × *desinstalar App (link externo)* × *desconectar do GitHub*; e **Desconectar GitHub** (vermelho) × **Sair da conta** (neutro).

## Contratos

Provável: `POST /connections/github/disconnect` (revoga user-to-server via API do GitHub, marca a conexão como inativa; **não** toca a sessão de app) e reuso do fluxo OAuth do App para reconectar. Sem modelo novo — a conexão GitHub já é entidade separada da identidade na SPEC-026.

## Notas técnicas

- **ADR-015**: leitura usa user-to-server; escrita usa installation token (`proplan[bot]`). Desconectar remove o **user-to-server**; o installation token segue válido no servidor enquanto o App estiver instalado. A spec deve garantir que **nenhum job** aja com installation token de uma conexão desconectada.
- **ADR-021 / SPEC-026**: a conexão GitHub pendura numa identidade; desconectar mexe só na conexão. É isso que torna *desconectar ≠ deslogar*.
- Revogação real (não só apagar o token do nosso lado) honra "seus dados continuam seus".
- Reaproveitar diálogo/confirmação e botões migrados (SPEC-020).

## Perguntas abertas

Nenhuma. Resolvidas com o PI em 2026-07-20: catálogo desconectado mostra **cards read-only com selo** (memória preservada) · `/settings` com seções **Tema · Conta/Identidade · IA**, criada uma vez em coordenação com a SPEC-026 · botão **"Desconectar GitHub" em vermelho**, distinto de **"Sair da conta"** · posição: **2ª fatia da Frente Identidade**, imediatamente após a SPEC-026 (decidido pelo Cowork a pedido do PI).
