---
proplan: v1
spec: SPEC-023
fatia: 17
status: rascunho # rascunho | aprovada-pi | em-implementacao | entregue | aceita-pi
updated: 2026-07-17
---
# SPEC-023 — Stack detectada via SBOM / Dependency Graph (Fatia 17)

> **Rascunho.** Fecha o "sem escopo" da issue #8 (prio baixa). O **ADR-003 adendo (2026-07-12)** já autorizou a fonte e exigiu spec própria antes de codificar — é esta. **Não implementar** enquanto houver *Pergunta aberta*.

## Objetivo

Exibir a **stack real detectada** de um projeto (linguagens, ecossistemas e dependências) a partir do Dependency Graph do GitHub, alimentando as abas **Arquitetura** e **Deploy** — sem ler uma linha de código-fonte.

## Contexto herdado (já decidido)

- **ADR-003 adendo**: `GET /repos/{owner}/{repo}/dependency-graph/sbom` (SPDX JSON, derivado dos manifests pelo próprio GitHub) está **autorizado**. É metadado sobre o código, não conteúdo — não fere o "nunca clonar". **Ressalva registrada**: em repo **privado** o Dependency Graph vem **desabilitado por padrão** — a feature exige fallback explícito, **nunca falhar em silêncio**.
- **ADR-012**: confiança é **calculada, nunca inferida**. O SBOM é fonte determinística do GitHub — é fato detectado, não palpite de IA. A proveniência precisa dizer isso (ver Escopo 3).
- **ADR-018 / SPEC-013**: o padrão do produto para "duas fontes discordam" é **confrontar, não coroar**. A stack **declarada na doc** vs. a **detectada no SBOM** é exatamente esse caso (ver Pergunta aberta 1).

## Escopo (primeiro corte — sujeito às Perguntas abertas)

1. **Ingestão do SBOM no sync** (ADR-002): buscar o SPDX, extrair pacotes e ecossistemas, persistir a lista (nunca os bytes de código). Ancorar ao **SHA do HEAD do branch default** no momento da leitura — o SBOM muda com os manifests, não com `docs/` (ver Nota técnica).
2. **Fallback obrigatório**: Dependency Graph desabilitado ou repo sem manifests → estado **"não habilitado neste repo"** com instrução de como habilitar, nunca erro mudo nem "stack vazia" ambígua.
3. **Proveniência própria**: cada item de stack carrega origem `sbom` (detectado do manifest pelo GitHub) e o SHA de ancoragem — distinta de stack **declarada por humano** na doc e de **inferência de IA**. A UI não pode fazer o detectado passar por declarado.
4. **Exibição**:
   - Aba **Arquitetura**: bloco "Stack detectada" (linguagens/ecossistemas agregados; lista de dependências sob demanda — Pergunta aberta 2).
   - Aba **Deploy**: a stack informa os componentes dos 3 eixos (SPEC-017) — atribuição de manifest→componente é a Pergunta aberta 3.

## Fora de escopo

- **Vulnerabilidades / Dependabot alerts** — outro escopo, outra permissão; não entra.
- Ler versões travadas de lockfile como conteúdo de código — o SBOM já entrega o que precisamos via API; não baixar lockfile bruto.
- Sugerir upgrades, licenças ou análise de supply-chain.
- Detecção de infra de deploy (isso é a SPEC-013/013.6 — drift e probe).

## Critérios de aceite

- [ ] Num repo **público com Dependency Graph ativo**, a aba Arquitetura mostra os ecossistemas e principais dependências detectados, com o SHA de ancoragem visível.
- [ ] Num repo **privado sem Dependency Graph**, a aba mostra "não habilitado neste repo" (com o como-habilitar), **nunca** erro nem lista vazia silenciosa.
- [ ] O item de stack aparece marcado como **detectado (SBOM)**, distinto de qualquer stack declarada na doc — a UI não confunde as origens.
- [ ] A leitura roda no sync e não chama nada no caminho de render (ADR-002); falha do SBOM não derruba o sync de docs (tolerante, como o `syncIssues`).
- [ ] Nenhum byte de código-fonte é persistido — só a lista SPDX normalizada.

## Contratos (esboço)

- `ingestion`: passo de sync que produz `StackDetection { projectId, ecosystem, packages[], sourceSha, source: 'sbom', enabled: boolean }`.
- API: `GET /projects/:id/stack` devolve a detecção + estado de fallback.
- Abas Arquitetura/Deploy consomem via composição já persistida (padrão do `Board`, ADR/ARCHITECTURE).

## Notas técnicas

- **Ancoragem de invalidação**: o padrão do produto persiste inferência com `docs_tree_sha` (ADR-002). O SBOM **não** é função de `docs/` — muda quando os manifests mudam. Ancorar ao SHA do commit HEAD do default branch. Isso é uma **variação consciente** do padrão; confirmar na Pergunta aberta 4 se merece nota no ARCHITECTURE ou um mini-ADR.
- **Monorepo**: o SBOM agrega todos os manifests do repo num só documento — atribuir subconjuntos a apps/componentes exige heurística de path (Pergunta aberta 3).
- **Privado**: além de desabilitado por padrão, o Dependency Graph pode estar ativo mas vazio; tratar os dois como o mesmo estado de fallback informativo.

## Perguntas abertas

> Todas BLOQUEIAM implementação. Decisão do PI.

1. **Confrontar ou só exibir?** Quando a doc humana declara uma stack e o SBOM detecta outra, o ProPlan **confronta as fontes** (padrão ADR-018 — coroa nenhuma) ou apenas mostra a detectada ao lado da declarada? O confronto é o ângulo mais alinhado à tese ("detectar doc que mente"), mas é mais trabalho. Qual o corte?
2. **Granularidade**: agregado (linguagens + ecossistemas, ex.: "Node/pnpm, 42 deps") ou lista completa de dependências com versões? A lista completa é ruído numa aba de arquitetura e infla o banco.
3. **Monorepo → componentes**: atribuir manifests a componentes dos 3 eixos do Deploy (SPEC-017) por heurística de path, ou tratar o repo como uma stack única neste primeiro corte?
4. **Ancoragem por HEAD SHA** (não `docs_tree_sha`): aceita como variação registrada, ou quer um ADR curto formalizando a nova âncora de invalidação?
5. **Numeração**: criei como `fatia: 17` / SPEC-023 (issue #8 não tinha fatia). Confirma o número ou prefere outro?
