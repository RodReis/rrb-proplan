---
proplan: v1
spec: SPEC-012
fatia: 6.1
status: aprovada-pi # rascunho | aprovada-pi | em-implementacao | entregue | aceita-pi
updated: 2026-07-14
---
# SPEC-012 — Aba Deploy: documento primeiro, painel de ambientes como enriquecimento

## Contexto — a contradição que originou a fatia

Achado no dogfooding do `rrb-organize` (2026-07-14), com o mapeamento **funcionando corretamente**.

O repo documenta deploy em `docs/runbooks/deploy-railway.md` — prosa, formato próprio. A escada do ADR-014 fez exatamente o que devia: convenção não achou `docs/DEPLOY.md`, alias não pegou (subdiretório), o dono mapeou pela UI, o `.proplan/config.yml` foi commitado por `rrb-proplan[bot]`, a resolução virou `source: config` com o path certo.

E a aba mostrou uma **tabela vazia**.

Causa (`board/application/tabs.service.ts:93`):

```ts
case 'deploy': {
  const md = await this.markdownOf(projectId, r.path);
  return { source, payload: { environments: parseDeploy(md), ...inference } };
}
```

A aba **não renderiza o documento**. Ela roda `parseDeploy` (`board/domain/deploy-doc.ts`), que só sabe extrair linhas de tabela:

```ts
if (!t.startsWith('|')) continue;   // ignora todo o resto do documento
if (cells.length < 4) continue;
```

Nenhuma linha do runbook começa com `|` → `[]` → o `DeployTab.tsx` desenha o `<thead>` e nenhum `<tr>`. Cabeçalho fantasma, sem mensagem.

**Deploy é a única aba com parser estrutural rígido.** Arquitetura e Design renderizam markdown livre. Na prática, a aba Deploy exige *"me dê a doc no meu formato"* — o ProPlan violando o **ADR-014** na camada de renderização, logo depois de o mapeamento (também ADR-014) ter feito a coisa certa. A regra estava sendo cumprida na resolução e quebrada na exibição, onde ninguém tinha olhado.

## Objetivo

Um documento mapeado **sempre aparece**. A tabela de ambientes deixa de ser pedágio de quem não segue a convenção e vira bônus de quem segue.

## Escopo

1. **`tabs.service.ts` (`case 'deploy'`)** — o payload passa a carregar os documentos resolvidos, além dos ambientes parseados:
   `{ environments: DeployEnv[], docs: { path: string; markdown: string }[] }`.
   Arquivo único (`r.path`) → `docs` com 1 item. **Coleção** (`r.paths`, ex.: `deploy: docs/runbooks/`) → `docs` com N itens, na ordem de `paths` (Decisão 1).
   `parseDeploy` roda sobre os documentos resolvidos: **se qualquer um deles tiver a tabela, o painel aparece.**
   `parseDeploy` **não muda** — mesmo parser determinístico, mesmo comportamento, mesmos testes.
2. **`DeployTab.tsx`** — estados de render:
   - `environments.length > 0` → painel de ambientes **acima**, documento(s) **abaixo**.
   - `environments.length === 0` e há doc(s) → **só o(s) documento(s)**, renderizados como markdown.
   - coleção (N docs) → os N renderizados em sequência, cada um com o **path como título**.
   - sem doc resolvido (`absent`) → estado vazio atual, com CTA "Mapear fonte". **Inalterado.**
3. **Reúso do viewer de markdown** já existente (react-markdown + Mermaid lazy, entregue na Fatia 6). Não criar renderer novo.

## Fora de escopo

- **Qualquer mudança no `parseDeploy`.** Não flexibilizar o formato da tabela, não aceitar variação de cabeçalho, não tolerar colunas a mais/menos. Se o repo quiser o painel, segue a convenção — que agora é um convite, não um requisito.
- **Fallback de IA em Deploy.** Permanece proibido (`CONVENTION.md`: *"deploy inferido errado é pior que ausente"*). Renderizar o markdown que o humano escreveu **não é inferir deploy** — é mostrar o que ele escreveu. A regra continua intacta e esta fatia não a arranha.
- **Alterar o `CONVENTION.md`** no formato de `docs/DEPLOY.md`. O formato segue idêntico; muda só o que acontece quando o repo *não* o adota.
- Detecção de stack via SBOM / dependency graph (já no Backlog, exige spec própria).
- Estender o mesmo tratamento a outras abas — nenhuma outra tem parser rígido; não há o que corrigir.

## Critérios de aceite

- [ ] No `rrb-organize`, com `deploy: docs/runbooks/deploy-railway.md` no `.proplan/config.yml`, a aba Deploy **renderiza o conteúdo do runbook** — o texto que está no GitHub aparece na tela.
- [ ] Nesse mesmo caso **não há tabela de ambientes na tela** — nem cabeçalho vazio, nem tabela fantasma.
- [ ] Num repo com `docs/DEPLOY.md` no formato do `CONVENTION.md` (ex.: dogfooding do `rrb-proplan` ou fixture), a aba mostra **o painel de ambientes E o documento**, com o painel acima.
- [ ] Repo sem deploy resolvido continua com o estado vazio "Deploy não documentado" + CTA "Mapear fonte" — comportamento **idêntico** ao de hoje.
- [ ] Os testes existentes de `parseDeploy` passam **sem alteração** (prova de que o parser não foi mexido).
- [ ] Teste que prova a fatia: doc mapeado **sem** tabela → payload traz `docs` não-vazio e `environments: []`.
- [ ] **Coleção**: `deploy: docs/runbooks/` no `.proplan/config.yml` → a aba renderiza os N documentos da pasta em sequência, cada um com o path como título (Decisão 1).
- [ ] Mermaid dentro do doc de deploy renderiza (o viewer reusado, não um renderer novo).

## Contratos

`GET /projects/:id/tabs/deploy` — payload alterado (aditivo):

```ts
// antes
{ environments: DeployEnv[] }
// depois
{ environments: DeployEnv[]; docs: { path: string; markdown: string }[] }
```

`DeployEnv` inalterado. Sem migração de banco: o markdown já está em `Document.content` (o `markdownOf` já o lê hoje — só era descartado depois do parse).

## Notas técnicas

- **ADR-014** é a razão de ser da fatia: *"O ProPlan se adapta ao repo, nunca o contrário."* O caso do `rrb-organize` é a evidência de que a regra estava sendo violada na renderização.
- **ADR-001** (fronteira de módulos): `parseDeploy` fica onde está (`board/domain`); `board` segue consumindo `resolutionOf` do `ingestion`. A fatia não move nada entre módulos.
- **Risco baixo**: mudança aditiva no payload + render. Nenhuma escrita no repo-alvo, nenhuma chamada de IA, nenhum job novo.
- **Padrão já existente**: Arquitetura e Design já fazem "renderiza o markdown do doc resolvido". Esta fatia remove uma exceção, não inventa comportamento.

## Perguntas abertas

Nenhuma. As 3 foram resolvidas com o PI em 2026-07-14 (registro abaixo).

## Decisões do PI (2026-07-14)

**1. Deploy mapeado para diretório → a aba renderiza a coleção.**
O `document-resolver` já aceita `deploy: docs/runbooks/` (`mapped.endsWith('/')` vale para qualquer entidade) → `path: null`, `paths: [N docs]`, e o select de mapeamento **oferece o diretório**. Mas o `case 'deploy'` chama `markdownOf(projectId, r.path)` com `r.path` **null** — a opção existe e a aba não sabe consumi-la.
Descartadas: *(b) estado "não suportado"* — cria um beco sem saída que o próprio produto oferece, o ProPlan se contradizendo em dois cliques; *(c) tirar diretório do select* — mantém Deploy como exceção sem razão (**Decisões e Skills já suportam coleção**) e não cobre `config.yml` editado à mão no repo.
Depois que a aba passa a renderizar documento, suportar N é iterar `paths`. Não há razão para a exceção existir.

**2. Doc com tabela → aceitar a duplicação visual.**
A alternativa (omitir a seção `## Ambientes` do markdown, já consumida pelo painel) **não é implementável sem código novo**: `parseDeploy` **não tem noção de seção** — varre linhas soltas atrás de `|` (`if (!t.startsWith('|')) continue`), não conhece headings. Omitir exigiria um **segundo parser**, de estrutura de seções, cuja única função seria **esconder conteúdo escrito pelo usuário** — mais código, mais frágil e contra o princípio do ADR-014.
Uma tabela repetida é ruído visual irrelevante. Esconder doc do dono é dívida de princípio.

**3. `roteiro-teste-prod.md` fica fora desta fatia.**
É conteúdo de **Testes**, não de Deploy. O PI mapeia em *Testes* pela própria tela de mapeamento. A aba Testes **não tem** o problema de parser rígido que Deploy tem — não há o que corrigir lá.
