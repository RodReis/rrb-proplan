---
proplan: v1
spec: SPEC-020
fatia: 15
status: aprovada-pi # rascunho | aprovada-pi | em-implementacao | entregue | aceita-pi
updated: 2026-07-15
---
# SPEC-020 — Shell workspace + temas Carbono/Claro

## Objetivo

Substituir o shell atual (rail + lista permanente de projetos + abas horizontais) pelo **padrão workspace**: um projeto por vez, selecionado por combo na sidebar, com navegação vertical dedicada ao projeto — e o painel inteiro re-tokenizado no design system Carbono/Claro (novo `docs/DESIGN.md`).

**Motivação real** (registrada para não virar lenda): o combo não "protege" nada — os projetos continuam a um clique. O que o padrão entrega é **foco** (a sidebar serve ao projeto aberto, não à troca de projeto) e **escala de navegação** (12 abas horizontais já não cabem; grupos verticais cabem e comunicam hierarquia). Proteção de verdade (permissão, isolamento) é a Fatia 8 (multi-tenant), fora daqui.

Protótipos de referência: `docs/design/ProPlan Workspace.dc.html` (+ `support.js`, `assets/`). Telas Login e Catálogo ficam na **SPEC-021**.

## Escopo

1. **Sidebar (270px, fixa)** conforme protótipo:
   - **Combo de workspace** no topo: logo "P" (gradiente da marca) + rótulo mono `WORKSPACE` + nome do projeto aberto. Clique abre dropdown `PROJETOS GERENCIADOS` com a lista (nome, dono, ponto de estado, badge de alerta), **ordenada por último acesso** (mais recente no topo; registro local por projeto), e rodapé `← Voltar ao catálogo`.
   - **Navegação em grupos** (rótulos mono caixa-alta), mapa 1:1 das abas atuais de `tabs.ts` — nenhuma aba nova, nenhuma removida:
     - `PROJETO`: Visão Geral · Documentos · Kanban · Grafo · Decisões
     - `ENGENHARIA`: Arquitetura · Skills & Agentes · Testes · Design · Deploy
     - `GOVERNANÇA`: Contexto · Handoff
   - **Rodapé de usuário**: avatar + nome + e-mail + menu (Configurações · Sair). O rail de ícones atual é removido; Configurações migra para este menu.
2. **Topbar (60px)**: breadcrumb `RodReis / <projeto> / <aba>` · toggle de tema (lua/sol) · **pílula viva de atividade** · botões `Mapeamento` e `Sincronizar`. **Sem campo de busca global** — decisão do PI em 2026-07-15: fora de requisito (o protótipo o exibe; ignorar).
   - **Pílula de atividade** (DESIGN.md §6) substitui o botão `Atividade`; clique abre a gaveta. Estados: ociosa (`● Em dia · sync há X`), sincronizando (narra o passo atual em Mono, na cor da etapa), escrita concluída com gaveta fechada (badge verde `popIn`). Alimentada pelos eventos/passos que a SPEC-010 já emite — nenhum backend novo. *(Adicionado em 2026-07-15 por decisão do PI — estava no protótipo e fora do escopo original.)*
3. **Realocação dos sinais de alerta** que hoje vivem na lista de projetos (`sem instalação`, `importar`, `deploy divergente`, `deploy?`):
   - No **item do combo**: ponto de estado de sync + no máximo **um** badge (o alerta mais grave, na ordem: `sem instalação` > `deploy divergente` > `deploy?` > `importar`).
   - No **workspace aberto**: os alertas do projeto atual aparecem onde já existem hoje (banner do Kanban, aba Deploy, badge no header) — nada some, só deixa de ficar visível para projetos *não abertos*.
4. **Re-tokenização** (novo `docs/DESIGN.md`): tokens CSS por `:root[data-theme="carbono"|"claro"]`, IBM Plex Sans/Mono, componentes existentes migrados para `var(--token)` — **nenhum valor hardcoded em componente**. Carbono é o padrão.
5. **Toggle de tema** persistido em `localStorage` (decisão do PI em 2026-07-15; diverge do design system, ver Notas técnicas).
6. **Rotas com URL** (react-router): `/` (catálogo) · `/p/:projectId/:tab`. F5 e link direto voltam ao mesmo projeto/aba; `Voltar ao catálogo` é navegação, não estado. Substitui o `openProjectId`/`activeTab` em `useState` de `Home.tsx`/`Workspace.tsx`. URL de projeto inexistente/removido → página amigável "Projeto não encontrado" com link ao catálogo (copy padrão, aprovada pelo PI).
7. **Faixa de aba (hero das abas de documento)** — componente do DESIGN.md §6: imagem `workspace-vista*` por tema com gradiente de leitura, ícone-chip, título, descrição de valor e rótulo Mono de estado (`SINCRONIZADO DO REPOSITÓRIO · <quando>` ou `AGUARDA <arquivo>` quando o doc não existe — ausência é informação, ADR-014). Sem documento, a faixa é o empty state da aba. *(Adicionado em 2026-07-15 a pedido do PI — estava nos protótipos e faltava na spec.)*
8. **Catálogo e Login continuam funcionais** com o layout atual sobre os tokens novos (re-skin automático via tokens); o redesenho deles é a SPEC-021.

## Fora de escopo

- Busca global / command palette (`⌘K`) — removida do requisito, sem placeholder.
- Telas novas de Login e Catálogo (SPEC-021).
- Eventos/backend novos de atividade — a pílula consome o que a SPEC-010 já fornece; qualquer evento novo é fatia própria.
- Endpoint de preferências do usuário (tema via API) — dívida registrada.
- Qualquer mudança de comportamento nas abas (Kanban, Grafo, etc.) — só pele.
- Imagens de IA do Login (`hero-grafo*`) e do Catálogo (`catalogo-banner*`) — SPEC-021. A `workspace-vista*` (faixa de aba) entra **aqui**, pois pertence ao shell.

## Critérios de aceite

- [ ] Abrir o painel autenticado com ≥1 projeto gerenciado cai no catálogo (`/`); abrir um projeto leva a `/p/:id/overview` com sidebar de grupos e combo mostrando o nome do projeto.
- [ ] O combo lista todos os projetos gerenciados com ponto de estado; projeto com App removido exibe badge `sem instalação` no item do combo.
- [ ] Trocar de projeto pelo combo carrega o workspace do outro projeto sem passar pelo catálogo; `← Voltar ao catálogo` leva a `/`.
- [ ] F5 em `/p/:id/kanban` volta exatamente para o mesmo projeto e aba.
- [ ] Toggle de tema alterna Carbono ↔ Claro em toda a UI sem reload; a escolha sobrevive a F5 (localStorage). Nenhum componente exibe cor do tema errado (inspeção visual das 12 abas nos 2 temas).
- [ ] `Sincronizar`, `Atividade` e `Mapeamento` funcionam exatamente como antes (mesmos fluxos, painel de atividade abre ao fim do sync).
- [ ] Nenhum valor de cor hardcoded em componente novo/migrado — grep por `#[0-9a-fA-F]{3,8}` em `apps/web/src` só encontra os arquivos de tokens (e SVGs).
- [ ] Contraste AA nos dois temas nos pares texto/fundo do DESIGN.md; foco visível (`outline` acento) em todos os controles interativos.
- [ ] Kanban e Grafo re-tokenizados: colunas/cards com tintas por etapa e nós/arestas conforme DESIGN.md — sem regressão funcional (drag & drop, seleção de nó).
- [ ] Aba de documento com doc presente exibe a faixa hero com `SINCRONIZADO DO REPOSITÓRIO · <quando>`; aba cujo doc não existe exibe a faixa como empty state com `AGUARDA <arquivo>` — nos dois temas, sem cor de erro.

## Contratos

- **Sem endpoint novo.** Consome os já existentes (`/projects`, `/installations`, docs, kanban, sync).
- **Frontend**: rotas `/` e `/p/:projectId/:tab` (`:tab` ∈ ids de `tabs.ts`; id inválido → redirect `overview`).
- **Tokens**: `apps/web/src` passa a ter fonte única de tokens (CSS custom properties + mapeamento Tailwind `@theme`), conforme DESIGN.md §Implementação.

## Notas técnicas

- **Tema em localStorage diverge do design system** (que manda API). Decisão do PI (2026-07-15): endpoint de preferências só quando houver uma segunda preferência a guardar. Registrar comentário no código apontando esta spec.
- **Sem pacote `libs/ui-tokens` por ora.** O design system sugere workspace lib; com um único consumidor (`apps/web`), tokens vivem em `apps/web/src` (`tokens.css` + `stageTint.ts`). Extrair quando existir o segundo consumidor — YAGNI, coerente com monolito modular (ADR-001).
- **Fontes self-hosted** (`@fontsource/ibm-plex-sans`, `@fontsource/ibm-plex-mono`), não Google Fonts CDN — ambiente 100% local (CLAUDE.md) não pode depender de rede em runtime.
- **Tailwind v4