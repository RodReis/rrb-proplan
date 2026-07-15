---
proplan: v1
spec: SPEC-014
fatia: 9
status: aprovada-pi # rascunho | aprovada-pi | em-implementacao | entregue | aceita-pi — aprovada 2026-07-14 (4 decisões do PI incorporadas)
updated: 2026-07-14
---
# SPEC-014 — Fatia 9: Modelo canônico + proveniência por campo + confiança determinística

> Numeração: `SPEC-009` já é "consumo de IA" (Fatia 7.5). A numeração de specs é cronológica, não alinhada à fatia. Esta é a **Fatia 9** (frontmatter), primeiro spec do núcleo do MVP2.

## Objetivo

Dar ao ProPlan o **objeto consultável** que o resto do MVP2 serve: cada campo do modelo de retomada carrega **sua própria proveniência** e um **grau de confiança determinístico** (ADR-012). Sem isso, a Fatia 10 (asserção humana) não tem onde encaixar e a Fatia 11 (MCP) não tem o que servir com o contrato de evidência.

## A regra que este objeto existe para cumprir (MVP2 §1)

O modo de falha que mata o produto **não é o silêncio — é a resposta confiante e errada**. Logo: **a granularidade é o campo, não o documento.** O objeto tem que conseguir dizer *"sei o objetivo (fato, 3 dias) mas não sei o deploy (ausente)"* — nunca um resumo uniforme de credibilidade desconhecida. Campo sem proveniência **não existe** (não há campo "genérico").

## Escopo

1. **Store estruturado `CanonicalField`** — uma linha por (projeto, entidade, campo), com valor, **classe de proveniência**, **referência de proveniência** e **confiança + a conta**. Derivado do sync, **reconstruível** (mesma disciplina do `DocumentResolution` — ADR-014: apagar e re-sincronizar reconstrói idêntico; a fonte é o repo, isto é índice).
2. **Extração determinística de `fato`** — para os campos que saem direto do repo, gravar `path + sha + data` (granularidade de proveniência: ver Perguntas abertas 3).
3. **Cálculo de confiança determinístico (ADR-012)** — função só de metadado; mesmo repo + mesmo `docsScopeHash` → mesmo número, sempre. Reusa `staleness` (colunas do ADR-010 no `Project`) e `cobertura` (o `DocumentResolution` da Fatia 6). `contradição` e `drift`: ver Perguntas abertas 2.
4. **Projeção de leitura `getCanonicalModel(projectId)`** — monta o objeto de N entidades a partir do `CanonicalField` **sem chamar IA** (ADR-002: nada de inferência no caminho de request). Puro e testável.
5. **UX: confiança clicável mostra a conta** (MVP2 §3) — `0.62 = 42 dias de staleness · 4/13 entidades ausentes · 1 contradição (ARCHITECTURE.md:31 vs ADR-004:12)`.
6. **Recusa abaixo do limiar** — campo com confiança < limiar responde **"não sei — ausente/defasado"** + link do que falta, nunca um palpite. Limiar configurável (ver Perguntas abertas 4).

## Fora de escopo (explícito)

- **Classe de proveniência `asserção`** (humano, ADR-013) → **Fatia 10** (`docs/CONTEXT.md`). Esta fatia deixa o **slot** pronto no modelo de proveniência, não a captura.
- **As 6 tools do MCP** → **Fatia 11**. Esta fatia entrega o objeto que elas servem, não o servidor.
- **Entidades puramente derivadas** — "próxima ação" (#8) e parte de "riscos" (#9) dependem de 10+11; ficam como slot declarado, não preenchido aqui (ver Perguntas abertas 1).
- **LLM emitindo score** — proibido (ADR-012). O LLM só entra como extrator de candidatos a `contradição`, citando **dois spans** (se a PA-2 incluir contradição nesta fatia).
- **Reescrever/renomear documento do repo** (ADR-014).

## As 4 classes de proveniência (MVP2 §2)

| classe | origem | carrega | nesta fatia? |
|---|---|---|---|
| `fato` | extraído do repo | `path + linha? + sha + data` | **sim** |
| `inferência` | LLM | spans citados que sustentam (ADR-012) | **sim** (reusa artefatos da Fatia 7) |
| `hipótese` | derivada, não confirmada | o que confirmaria | **slot** (preenchida quando 10/11 exigirem) |
| `asserção` | humano (ADR-013) | autor + data + sha + paths + validade | **slot** → Fatia 10 |

## Confiança (ADR-012) — o que é determinístico e já existe

| sinal | cálculo | fonte | pronto? |
|---|---|---|---|
| `staleness` | `last_code_commit − last_doc_commit` (dias) | `Project.lastCodeCommitAt/lastDocsCommitAt` (ADR-010) | **sim** |
| `cobertura` | entidades resolvidas (níveis 1–3) / total | `DocumentResolution` (Fatia 6) | **sim** |
| `contradição` | nº de pares de spans conflitantes confirmados | LLM extrator + regra determinística | **novo** (PA-2) |
| `drift` | doc afirma artefato que o sinal do GitHub não confirma | workflows/releases/checks; deploy já na SPEC-013 | **parcial** (PA-2) |

O número **nunca sai do LLM**. `contradição`: o LLM emite `ARCHITECTURE.md:31 afirma A · ADR-004:12 afirma B`; sem par de spans citáveis, a saída é **descartada**; a regra determinística decide se conta e quanto pesa.

## Contratos

**Prisma** (novo modelo; segue o padrão reconstruível do `DocumentResolution`):
```
model CanonicalField {
  id             String   @id @default(uuid())
  projectId      String   @map("project_id")
  entity         String   // projeto | objetivo | modulos | arquitetura | decisoes | testes | deploy | skills | ...
  field          String   // nome do campo dentro da entidade
  value          Json?    // valor extraído (null = ausente)
  provenanceClass String  @map("provenance_class") // fato | inferencia | hipotese | assercao
  provenanceRef  Json     @map("provenance_ref")   // {path, line?, sha, date} | {spans:[...]} | ...
  confidence     Float
  confidenceMath Json     @map("confidence_math")  // {staleness, cobertura, contradicao, drift} — a conta clicável
  docsScopeHash  String   @map("docs_scope_hash")  // versão da árvore que gerou (auditoria/rebuild)
  resolvedAt     DateTime @default(now()) @map("resolved_at")
  project        Project  @relation(fields: [projectId], references: [id], onDelete: Cascade)
  @@unique([projectId, entity, field])
  @@map("canonical_fields")
}
```

**Domínio puro e testável** (`insight/domain/` ou módulo novo `canonical/domain/`):
```ts
computeConfidence(signals: {staleness, cobertura, contradicao, drift}): {score: number, math: object}
assembleCanonicalModel(fields: CanonicalField[]): CanonicalModel   // projeção de leitura, sem IA
belowThreshold(score: number, threshold: number): boolean          // recusa
```

**API**: `GET /projects/:id/canonical` → o objeto montado (entidades → campos → {value, provenance, confidence, math} | refusal). Sem IA no caminho (ADR-002); lê do `CanonicalField`.

**Preenchimento**: no `sync-job`, após a resolução de documentos e os insights existentes, um passo determinístico popula/atualiza `CanonicalField` por (entidade, campo). Versionado por `docsScopeHash`.

## Critérios de aceite

- [ ] `getCanonicalModel` responde por **campo**, cada um com classe de proveniência + confiança + a conta — nunca um score uniforme de documento.
- [ ] Confiança é **determinística**: rodar 2× sobre o mesmo `docsScopeHash` dá número idêntico (teste de fixture, não "avaliação").
- [ ] Confiança é **auditável**: o payload traz a conta (`{staleness, cobertura, ...}`) que soma no número exibido.
- [ ] Campo abaixo do limiar → **recusa explícita** ("ausente/defasado" + o que falta), nunca palpite.
- [ ] Campo `fato` carrega `path + sha + data` verificáveis (linha conforme PA-3).
- [ ] Zero chamada de IA no caminho de `GET /canonical` (verificável: não cria linha em `LlmUsage`).
- [ ] `CanonicalField` é reconstruível: apagar as linhas + re-sync reproduz idêntico (ADR-014).
- [ ] Contradição (se na fatia — PA-2): sem par de spans citáveis, a saída do LLM é descartada; o teste prova que um "achado" sem spans não vira confiança.

## Notas técnicas

- **Módulo**: candidato a módulo novo `canonical` (NestJS), ou dentro de `insight`. O `assembleCanonicalModel` é projeção de leitura pura (padrão `activity-feed` da Fatia 7). Decisão de arquitetura do Code; aponto que **não pode importar entidade interna de outro módulo** (ADR-001) — consome `DocumentResolution` e `Project` por interface pública.
- **`cobertura` já modula por nível de resolução** (convenção > alias > IA), conforme MVP2 §3. Nível 4 (ausente) derruba o score.
- **Custo**: preenchimento roda no sync (determinístico, sem IA para staleness/cobertura). Se a PA-2 incluir contradição, aí sim há chamada de IA no sync — sujeita ao teto da SPEC-009.

## Decisões do PI (2026-07-14) — nenhuma pergunta aberta

1. **Escopo de entidades**: **doc+resolver + maquinário**. Preenche projeto, objetivo, módulos, arquitetura, decisões, testes, deploy, skills + a máquina de proveniência/confiança. `asserção` (#13) → Fatia 10; derivadas (#8 próxima ação, #9 riscos) → slot declarado, não preenchido aqui.
2. **Sinais vivos**: **framework de 4, só `staleness`+`cobertura` calculando** (determinísticos, zero IA). `contradição` e `drift` entram como **slots de peso zero**, extensíveis em fatia própria — mantém a fundação sem custo de IA e sem o extrator de pares-de-spans.
3. **Proveniência `fato`**: **nível de documento primeiro** — `path + sha + data`. Linha é fatia de refino posterior (não requisito da 9).
4. **Limiar de recusa**: **configurável em `Settings`, padrão `0.4`, `0` desliga** (mostra tudo com confiança crua). Mesmo padrão do limiar do ADR-010.

> Consequência dos cortes 2 e 3: esta fatia é **100% determinística e sem IA** — `staleness`+`cobertura`+resolução já existem, a proveniência é path+sha+data. A primeira fatia do MVP2 não toca o provedor de IA nem o teto da SPEC-009. `contradição`/`drift` (que puxam IA) ficam para fatias próprias sobre esta base.
