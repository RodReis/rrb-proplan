---
proplan: v1
spec: SPEC-015
fatia: 10
status: aprovada-pi # rascunho | aprovada-pi | em-implementacao | entregue | aceita-pi — aprovada 2026-07-14 (3 decisões do PI incorporadas)
updated: 2026-07-14
---
# SPEC-015 — Fatia 10: `docs/CONTEXT.md` e captura de asserção humana (ADR-013)

> **O fosso.** A pergunta de maior valor de um agente — *"o que eu não devo mexer?"* — não está em repo nenhum; está na cabeça de quem escreveu. Esta fatia dá ao ProPlan o cofre versionado dessa asserção, preenchendo a classe de proveniência `asserção` que a Fatia 9 deixou como slot.

## Objetivo

Capturar afirmações humanas ("não mexa em X", "essa gambiarra é intencional", "esse módulo parece morto e não é"), **escrevê-las de volta no repo** em `docs/CONTEXT.md` (conteúdo humano, sobrevive ao ProPlan), e mantê-las com **validade datada** — rebaixadas a "a revalidar" quando o mundo que elas descrevem muda. É o único ativo do produto que **cresce com o uso** em vez de depreciar.

## Por que escrever no repo, e não só no banco (ADR-013)

Guardar a asserção só no banco preservaria *"repositório é fonte de verdade"* **na aparência** — o conhecimento morreria junto com o ProPlan. Logo: `docs/CONTEXT.md` no repo-alvo, **conteúdo humano** (o ProPlan é só o teclado). Consequência que o ADR-013 torna obrigatória: os commits de `CONTEXT.md` **contam como frescor de documentação** (ADR-010) — vão para `docs/`, nunca para `.proplan/`.

## Escopo

1. **Captura na UI** — uma superfície para o dono registrar uma asserção: o **texto** + os **paths citados**. O ProPlan preenche sozinho `autor` (o usuário), `data` (agora) e `sha` (head do repo no momento da captura).
2. **Write-back em `docs/CONTEXT.md`** — via **installation token** (`proplan[bot]`, caminho de escrita do ADR-015), formato **parseável e round-trip** (o ProPlan escreve; o humano pode editar à mão; o próximo sync relê). Segue a disciplina de conflito por SHA base (ARCHITECTURE.md → Resiliência) e o re-sync SHA-aware (não declarar `noop` sobre árvore velha).
3. **Ingestão no sync** — `docs/CONTEXT.md` é resolvido pela convenção (já na `CONVENTION.md`), parseado em asserções e projetado em `CanonicalField` com `entity = constraints` ("o que não mexer", #13 do modelo canônico) e `provenanceClass = assercao`. **O repo é a fonte** — asserção editada à mão pelo humano é ingerida igual.
4. **Validade datada** — no sync, para cada asserção, se **algum path citado recebeu commit depois da `data` da asserção**, ela é marcada **`a-revalidar`** (rebaixada, **nunca apagada**). Reusa a Commits API com filtro por `path` (ADR-003 adendo; mesma máquina do ADR-010).
5. **A marca `a-revalidar` é obrigatória** em toda saída que exponha a asserção (UI e, na Fatia 11, o MCP) — **nunca omitida**. Asserção velha com cara de fato é o pior modo de falha (ADR-013).
6. **Revalidação leve** — quando uma asserção fica `a-revalidar`, a UI oferece **confirmar** (renova data+sha) ou **corrigir/remover** (novo commit em `CONTEXT.md`). É o **único** momento em que o ProPlan puxa a conversa (ver Decisão de cadência).

## Fora de escopo (explícito)

- **ProPlan "entrevistador"** — provocar asserções proativamente (perguntar "isso é intencional?" a cada módulo novo, a cada drift). É o risco central do ADR-013 (*"perguntar demais mata o canal"*). Esta fatia entrega o **cofre + a revalidação**, não um motor de perguntas. Elicitar bem é fatia própria, se provar necessário.
- **As tools do MCP** (`get_constraints` etc.) → **Fatia 11**. Esta fatia entrega a asserção no modelo canônico; a 11 a serve com contrato de evidência.
- **Sinais de confiança `contradição`/`drift`** → seguem como slot da Fatia 9.
- **Reescrever/renomear outro documento do repo** (ADR-014). O ProPlan só escreve `CONTEXT.md`, e como conteúdo do humano.

## Contrato de `docs/CONTEXT.md` (convenção v2)

Markdown round-trip: legível e editável à mão, parseável de volta. Proposta — uma asserção por seção, com um bloco de campos:

```markdown
---
proplan: v2
---
# Contexto — o que não mexer

## Não refatorar o motor de folha v1 antes do corte com o contador
- paths: lib/folha/engine/, supabase/migrations/202606130005_drop_folha_legada.sql
- autor: rodrigo
- data: 2026-06-12
- sha: a1b2c3d
- status: vigente        # vigente | a-revalidar

O drop é irreversível e depende de validação fiscal com 2-3 contracheques reais.
```

O parser tolera edição humana (campos ausentes → degradam com sinalização, nunca quebram o sync). `status` é derivado pelo ProPlan na ingestão (não é o humano que marca `a-revalidar`).

## Contratos

**Prisma** — a asserção pode viver como `CanonicalField` (`entity=constraints`, `provenanceClass=assercao`, `provenanceRef = {author, date, sha, paths, status}`) **ou** em modelo próprio `Assertion` referenciado pelo campo. Recomendo modelo próprio `Assertion` (a asserção tem ciclo de vida — captura, revalidação — que o `CanonicalField` reconstruível não tem): 
```
model Assertion {
  id           String   @id @default(uuid())
  projectId    String   @map("project_id")
  statement    String
  paths        String[]
  author       String
  assertedAt   DateTime @map("asserted_at")
  assertedSha  String   @map("asserted_sha")
  status       String   // vigente | a-revalidar
  contextPath  String   @default("docs/CONTEXT.md") @map("context_path")
  createdAt    DateTime @default(now()) @map("created_at")
  project      Project  @relation(fields: [projectId], references: [id], onDelete: Cascade)
  @@map("assertions")
}
```
O `CanonicalField` de `constraints` é **projeção** sobre `Assertion` (a fonte é `CONTEXT.md` no repo; `Assertion` é índice reconstruível dele).

**Domínio puro** (`context/domain/`): `parseContextMd(md): Assertion[]`, `serializeContextMd(assertions): string` (round-trip provado por teste: parse∘serialize = identidade), `revalidationStatus(assertion, commitsSince): 'vigente'|'a-revalidar'`.

**API**: `POST /projects/:id/assertions` (captura → write-back via Operation, passos nomeados como na SPEC-010), `POST /projects/:id/assertions/:id/revalidate` (confirma), `GET /projects/:id/assertions`.

## Critérios de aceite

- [ ] Capturar uma asserção na UI → commit em `docs/CONTEXT.md` no repo (via `proplan[bot]`), com autor+data+sha+paths.
- [ ] `CONTEXT.md` editado **à mão** e sincronizado → ingerido igual (o repo é a fonte).
- [ ] Round-trip provado: `parseContextMd(serializeContextMd(x)) == x` (teste).
- [ ] Asserção cujo path citado recebeu commit após a data → **`a-revalidar`** no próximo sync; **nunca apagada**.
- [ ] A marca `a-revalidar` aparece em toda exposição da asserção (UI); **nunca omitida**.
- [ ] Confirmar uma asserção `a-revalidar` → renova data+sha com novo commit; volta a `vigente`.
- [ ] Commit de `CONTEXT.md` **conta** como frescor de docs (ADR-010): mexe em `lastDocsCommitAt`.
- [ ] Write-back respeita o SHA-aware (sem `noop` falso) e o conflito por SHA base.
- [ ] Zero IA nesta fatia (captura e validade são determinísticas).

## Notas técnicas

- **Custo de validade**: 1 request à Commits API por **path citado** por asserção por sync (`?path=&since=<data>&per_page=1`). Mitigação: só re-checar asserções `vigente` (as já `a-revalidar` não pioram); cap por sync; o orçamento de requests do sync (ARCHITECTURE.md → Resiliência) se aplica. Se virar gargalo com muitas asserções, considerar checagem lazy no read — mas o padrão é no sync (mantém o read sem chamada externa, ADR-002).
- **`Assertion` não some com o projeto** por acidente: é reconstruível de `CONTEXT.md`, mas a fonte viva é o repo — apagar o banco e re-sync reconstrói.
- **Convenção v2**: `CONTEXT.md` exige `proplan: v2`; o parser mantém compat com v1 por ≥1 ciclo (regra vigente da `CONVENTION.md`).

## Decisões do PI (2026-07-14) — nenhuma pergunta aberta

1. **Cadência: conservador.** Captura **sob demanda**; o único disparo proativo é a **revalidação** (path citado mudou → "ainda vale?"). **Zero** interrogatório por módulo novo/drift — protege o canal (ADR-013). Elicitar proativamente fica para fatia própria, se provar necessário.
2. **Validade no sync**, só re-checando asserções `vigente`, com cap por sync. Mantém o read sem chamada externa (ADR-002).
3. **Modelo próprio `Assertion`** (tem ciclo de vida), com o `CanonicalField` de `constraints` como **projeção** sobre ele. A fonte viva é `docs/CONTEXT.md` no repo.
