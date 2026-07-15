---
proplan: v1
spec: SPEC-021
fatia: 16
status: aprovada-pi # rascunho | aprovada-pi | em-implementacao | entregue | aceita-pi
updated: 2026-07-15
---
# SPEC-021 — Telas Login e Catálogo (padrão workspace)

## Objetivo

Redesenhar as telas de **Login** e **Catálogo** conforme os protótipos, completando a migração visual iniciada na SPEC-020 — o catálogo deixa de dividir a tela com a lista de projetos e vira a porta de entrada do painel.

Protótipos: `docs/design/ProPlan Login.dc.html` e `docs/design/ProPlan Catalogo.dc.html`. **Depende da SPEC-020** (tokens, temas, rotas).

## Escopo

1. **Login** (2 colunas):
   - Coluna visual: hero com imagem IA (`assets/hero-grafo*.{jpg,png}` por tema), Ken Burns (`heroZoom` 20–28s), gradiente de leitura, mensagens de valor (`TRANSPARÊNCIA E GOVERNANÇA`, docs × código, aceite humano).
   - Coluna de ação: logo, `Entrar com GitHub` (botão primário 48px), nota "Somente leitura de documentação — o ProPlan nunca clona seu código", bloco `TRÊS PRINCÍPIOS` (aceite humano · IA identificada · seus dados continuam seus).
   - Mesmo fluxo OAuth atual — muda só a apresentação.
2. **Catálogo** (página cheia em `/`, sem sidebar de workspace):
   - Header próprio: logo + `CATÁLOGO` + usuário/sair.
   - Título, subtítulo e CTA `Instalar em mais repositórios` (fluxo atual).
   - Grupos por instalação (conta + chip `PESSOAL`/`ORGANIZAÇÃO`), cards de repo (nome, chip `privado`, descrição, último push) com ações `Gerenciar`/`✓ Gerenciado` e **`Abrir workspace`** (navega para `/p/:id/overview`) quando gerenciado. `✓ Gerenciado` continua clicável para **desgerenciar, com diálogo de confirmação** (remove só o índice local — o repo não é tocado; deixar isso explícito no diálogo).
   - Banner com imagem IA (`assets/catalogo-banner*.{png,jpg}` por tema) e rodapé com a nota de somente-leitura.
   - Estado vazio (App em nenhum repo) preservado, re-estilizado.
3. Ambas as telas nos **dois temas** (o login antes de autenticar usa o tema do localStorage; padrão Carbono).

## Fora de escopo

- Mudança em qualquer fluxo (OAuth, gerenciar/remover projeto, instalar App) — só apresentação.
- Geração das imagens de IA é pré-requisito de conteúdo, não código: os assets já existem em `docs/design/assets/` e são copiados para o app.
- Multi-tenant/organizações além do agrupamento por instalação que já existe.

## Critérios de aceite

- [ ] Login renderiza nos dois temas com hero animado (e estático sob `prefers-reduced-motion`); `Entrar com GitHub` completa o OAuth como hoje.
- [ ] Catálogo em página cheia: gerenciar um repo cria o projeto e o card passa a oferecer `Abrir workspace`, que navega para `/p/:id/overview`.
- [ ] Remover gerenciamento de um projeto aberto em outra aba não quebra o workspace (cai no 404 amigável da SPEC-020 ao recarregar).
- [ ] Imagens servidas localmente (sem CDN), com `background-image` vindo do estado do tema (regra do DESIGN.md §Imagens).
- [ ] Nenhum valor de cor hardcoded fora dos arquivos de tokens.

## Contratos

Nenhum endpoint novo; consome `/installations`, `/projects`, fluxo OAuth existente.

## Notas técnicas

- Assets de imagem entram em `apps/web/public/` (ou importados pelo Vite) — decidir na implementação; protótipo referencia `assets/`.
- O gradiente de leitura sobre imagem muda por tema (carbono escurece, claro clareia) — tokens no DESIGN.md §Imagens.
- Reutilizar os componentes de card/chip/botão já migrados na SPEC-020 — esta fatia não cria componente base novo.

## Perguntas abertas

Nenhuma. Resolvidas com o PI em 2026-07-15: imagens IA de `docs/design/assets/` **aprovadas como finais** (regenerar depois é troca de arquivo, não retrabalho) · card gerenciado mantém `✓ Gerenciado` (d