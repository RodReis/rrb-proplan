---
proplan: v1
spec: SPEC-023
fatia: 17
status: aprovada-pi # rascunho | aprovada-pi | em-implementacao | entregue | aceita-pi
updated: 2026-07-17
---
# SPEC-023 — Stack detectada via SBOM / Dependency Graph (Fatia 17)

> Fecha o "sem escopo" da issue #8 (prio baixa). O **ADR-003 adendo (2026-07-12)** já autorizou a fonte e exigiu spec própria antes de codificar — é esta. Aprovada pelo PI em 2026-07-17.

## Objetivo

Exibir a **stack real detectada** de um projeto (linguagens e ecossistemas) a partir do Dependency Graph do GitHub e **confrontá-la com a stack declarada na documentação** — sem ler uma linha de código-fonte.

## Contexto herdado (já decidido)

- **ADR-003 adendo**: `GET /repos/{owner}/{repo}/dependency-graph/sbom` (SPDX JSON, derivado dos manifests pelo próprio GitHub) está **autorizado**. É metadado sobre o código, não conteúdo. **Ressalva**: em repo **privado** o Dependency Graph vem **desabilitado por padrão** — exige fallback explícito, **nunca falhar em silêncio**.
- **ADR-012**: confiança é **calculada, nunca inferida**. O SBOM é fonte determinística do GitHub — fato detectado, não palpite de IA.
- **ADR-018 / SPEC-013**: o padrão do produto para "duas fontes discordam" é **confrontar, não coroar** — é o que esta fatia faz com doc × SBOM (decisão do PI, ver Escopo 4).

## Escopo

1. **Ingestão do SBOM no sync** (ADR-002): buscar o SPDX, extrair pacotes e ecossistemas, persistir a lista normalizada (nunca os bytes de código). Ancorar ao **SHA do HEAD do branch default** no momento da leitura (ver Nota técnica).
2. **Fallback obrigatório**: Dependency Graph desabilitado, vazio, ou repo sem manifests → estado **"não habilitado neste repo"** com o como-habilitar, nunca erro mudo nem "stack vazia" ambígua.
3. **Proveniência própria**: cada item carrega origem `sbom` (detectado do manifest pelo GitHub) + o SHA de ancoragem — distinta de stack **declarada por humano** e de **inferência de IA**. A UI não faz o detectado passar por declarado.
4. **Confronto doc × SBOM** (padrão ADR-018, coroa nenhuma): quando a documentação declara uma stack e o SBOM detecta outra, a aba **mostra a discordância** — declarado vs. detectado, lado a lado, sem eleger verdade. Concordância é exibida como reforço; ausência de declaração na doc é informação, não erro.
5. **Exibição**:
   - Aba **Arquitetura**: bloco "Stack detectada" (linguagens/ecossistemas **agregados**; lista de dependências sob demanda) + o veredito de confronto.
   - Aba **Deploy**: a stack informa os componentes dos 3 eixos (SPEC-017) — no primeiro corte, **stack única do repo** (sem atribuir manifest→componente).

## Fora de escopo

- **Vulnerabilidades / Dependabot alerts** — outro escopo, outra permissão.
- Ler lockfile bruto como conteúdo de código — o SBOM já entrega via API.
- Sugerir upgrades, licenças, supply-chain.
- Detecção de infra de deploy (é a SPEC-013/013.6).
- **Monorepo → componentes**: atribuir subconjuntos de manifests a apps fica para um corte posterior (primeiro corte trata o repo como stack única).

## Critérios de aceite

> Verificáveis um a um. Cada critério diz **setup → ação → resultado observável** e o método. "Funciona" não é critério.

**Detecção (repo público, Dependency Graph ativo)**

- [ ] Setup: repo público com DG ativo e manifests. `GET /projects/:id/stack` retorna `enabled: true`, `source: 'sbom'`, os ecossistemas/linguagens agregados e `sourceSha` = HEAD do default branch; a aba Arquitetura os renderiza.
- [ ] O `sourceSha` exibido **bate** com o SHA do HEAD do default branch no momento do sync (conferível contra a Commits API do GitHub).
- [ ] A lista de dependências detalhada só é buscada/exibida **sob demanda** (expandir), não no carregamento da aba.

**Fallback (privado / desabilitado / vazio) — nunca falhar em silêncio**

- [ ] Repo privado com DG **desabilitado** → `enabled: false`; a aba mostra "não habilitado neste repo" **com o como-habilitar**; nunca 500, nunca lista vazia sem rótulo.
- [ ] Repo com DG **ativo porém sem manifests** → **mesmo** estado de fallback informativo (o usuário não precisa distinguir de desabilitado).
- [ ] O estado de fallback é visualmente distinto de "ainda não sincronizado" — não induz o usuário a achar que faltou rodar o sync.

**Confronto doc × SBOM (padrão ADR-018 — coroa nenhuma)**

- [ ] Setup: doc declara stack X, SBOM detecta Y, X≠Y. A aba exibe **declarado × detectado lado a lado**, marcados como discordância; **nenhum** rótulo unilateral de "correto"/"confere"/"errado" em qualquer das fontes.
- [ ] Doc declara X e SBOM detecta X → exibido como **concordância/reforço** (não como discordância).
- [ ] Doc **não** declara stack → estado "não declarado na doc" (informação, não erro); a stack detectada aparece sozinha, sem alarme falso.

**Proveniência e limites do ADR-003**

- [ ] Cada item detectado é **visualmente distinto** de stack declarada por humano e de inferência de IA (origem `sbom` vs. `doc` vs. `inference` — a UI não funde as três).
- [ ] Auditoria do banco após o sync: **só** a lista SPDX normalizada persistida — nenhum blob/bytes de código-fonte, nenhum lockfile bruto, nenhum conteúdo fora do escopo do ADR-003.

**Operação (sync e resiliência — ADR-002)**

- [ ] A leitura do SBOM roda **no sync**, não no render: abrir a aba (`GET`) **não** dispara chamada ao GitHub (conferir na aba de rede / logs).
- [ ] SBOM falhar (rate limit ou 5xx do GitHub) **não derruba** o sync de docs: o estado anterior persiste e a aba sinaliza a falha sem quebrar — tolerante como o `syncIssues`.

## Contratos (esboço)

- `ingestion`: passo de sync que produz `StackDetection { projectId, ecosystem, packages[], sourceSha, source: 'sbom', enabled: boolean }`.
- API: `GET /projects/:id/stack` devolve a detecção, o estado de fallback e o **veredito de confronto** contra a stack declarada resolvida da doc.
- Abas Arquitetura/Deploy consomem via composição já persistida (padrão do `Board`).

## Notas técnicas

- **Ancoragem por HEAD SHA** (não `docs_tree_sha`): o SBOM é função dos manifests, não de `docs/` — ancora ao SHA do HEAD do default branch. É uma **variação consciente** do padrão do ADR-002; **registrar no ARCHITECTURE → Resiliência** (não exige ADR novo — decisão do PI, ver Perguntas resolvidas).
- **Fonte da stack declarada** para o confronto: a resolução de documento já existente (Arquitetura/CONVENTION) — reusar, não criar parser novo.
- **Privado**: tratar "desabilitado" e "ativo porém vazio" como o mesmo estado de fallback informativo.

## Perguntas abertas

Nenhuma. **Resolvidas com o PI em 2026-07-17:**

- **Confrontar ou só exibir** → **confrontar** (padrão ADR-018; alinhado à tese "detectar doc que mente").

Resolvidas **por derivação / corte de escopo** (reverter se o PI discordar):

- **Granularidade** → **agregada** (linguagens + ecossistemas; dependências sob demanda) — evita ruído e inchaço de banco.
- **Monorepo → componentes** → **fora do primeiro corte**; repo como stack única (listado em Fora de escopo).
- **Ancoragem HEAD SHA** → aceita como **variação registrada no ARCHITECTURE**, sem ADR novo.
- **Numeração** → `fatia: 17` / SPEC-023 (issue #8 não tinha fatia).
