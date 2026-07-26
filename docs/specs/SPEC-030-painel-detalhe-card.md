---
proplan: v1
spec: SPEC-030
fatia: Painel de detalhe do card (UX do board) — pós-MVP1
status: aprovada-pi # rascunho | aprovada-pi | em-implementacao | entregue | aceita-pi
updated: 2026-07-25 # aprovada pelo PI com as 3 perguntas abertas resolvidas nas recomendações
---
# SPEC-030 — Painel de detalhe do card: corpo da issue, metadados e trilha

> **Refinamento da SPEC-005 (Kanban), não contradição.** Colunas, labels, mutações
> e o ciclo de vida da issue (ADR-011) permanecem intactos. O que muda é o que
> acontece ao **clicar num card**: hoje abre um formulário de edição com título e
> prioridade; passa a abrir um **painel de leitura** com o que já existe na issue
> do GitHub, com a edição atual atrás de um botão.

## Objetivo

Ao abrir um card, o dono lê **o que a issue realmente diz** — corpo renderizado,
metadados e trilha de eventos — sem sair do ProPlan e sem precisar do GitHub.

## Contexto: por que não vem da spec

A leitura óbvia do pedido era extrair `Objetivo` / `Escopo` / `Critérios de aceite`
do arquivo `docs/specs/SPEC-nnn-*.md`, resolvido pelo token `[SPEC-nnn]` do título.
**Descartado pelo PI em 2026-07-25.** Isso é a convenção deste trio — o `CLAUDE.md`
é explícito (*"nada disso vira código do ProPlan"*) e o **ADR-014** rege: o ProPlan
se adapta ao repo, nunca impõe convenção. O painel ficaria perfeito neste
repositório e vazio em todos os outros.

O corpo da issue é **universal** — existe em qualquer repo, com qualquer processo —
e no `rrb-proplan` já contém exatamente essa informação, inclusive o link para a
spec, escrito pelo humano. É a mesma informação, sem impor o formato.

## Escopo

1. **Painel de detalhe (gaveta lateral)** substitui o clique no card como ação
   primária. Segue o padrão do `DocViewerPanel` (SPEC-004) e a animação `drawerIn`
   do `DESIGN.md` §9. Fecha com Esc e com clique no backdrop.
2. **Cabeçalho** — `#N`, estado (aberta/fechada), título completo (sem truncar),
   coluna atual, prioridade, labels com a cor do GitHub, autor, assignees, datas
   de abertura/atualização/fechamento e link "abrir no GitHub".
3. **Corpo da issue** renderizado como markdown, via o `MarkdownView` já existente
   (GFM: tabelas, checklists, código). É o bloco principal do painel.
4. **Trilha de eventos** — timeline da issue como o GitHub mostra: quem abriu,
   auto-atribuições, labels adicionadas/removidas (incluindo as `proplan:*`, que
   são a movimentação entre colunas), fechamento e reabertura, cada uma com ator e
   carimbo de tempo.
5. **Leitura ao vivo, sob demanda** — corpo e trilha são buscados no GitHub quando
   o painel abre, nunca persistidos. Skeleton durante a carga (`DESIGN.md` §9:
   skeleton, não spinner). O painel exibe o carimbo do momento da leitura.
6. **Editar vira modo secundário** — botão `Editar` no painel abre o
   `EditCardPopover` atual, sem mudança de comportamento nem de contrato. Descartar
   card continua lá dentro.
7. **Modo degradado** — se a leitura falhar (rate limit, issue removida, repo sem
   permissão), o painel abre com o que o cache do board já tem (título, coluna,
   prioridade, assignee, link) e um aviso explícito de que o corpo não pôde ser
   lido, com ação "tentar de novo". Nunca renderiza painel em branco.

## Fora de escopo

- **Editar o corpo da issue.** As mutações continuam sendo título, prioridade,
  coluna e descarte. Editar corpo abre conflito de escrita e comparação de versão —
  outra fatia, se o PI quiser.
- **Comentários da issue.** Ver *Perguntas abertas* §1.
- **Persistir corpo ou trilha no banco.** Proibido por decisão desta spec (ver
  *Notas técnicas*).
- **Transformar `#N` do corpo em link para o card do board.** Enriquecimento
  legítimo e barato, mas não é o pedido; nasce como card próprio se incomodar.
- **Sub-issues e épico-pai no painel.** Já são a swimlane (SPEC-024); repetir aqui
  seria o mesmo fato em dois lugares.

## Critérios de aceite

- [ ] Clicar num card abre o painel de detalhe, **não** o formulário de edição.
- [ ] O corpo da issue #127 aparece renderizado — links clicáveis, listas e
      `código` formatados — equivalente ao que o GitHub mostra.
- [ ] Card cujo corpo está vazio no GitHub mostra "sem descrição", não área em branco.
- [ ] Cabeçalho traz `#N`, estado, labels com cor, autor, assignees e as três datas.
- [ ] A trilha mostra, em ordem cronológica, ao menos: abertura, atribuição e cada
      label adicionada/removida, com ator e data — conferível contra a aba do GitHub.
- [ ] Botão `Editar` abre o formulário atual; salvar título/prioridade continua
      funcionando e o painel reflete o novo valor sem F5.
- [ ] `Descartar card` continua acessível e com a mesma confirmação.
- [ ] Esc fecha o painel; o board por baixo não perde scroll nem filtro.
- [ ] Com a rede/GitHub indisponível, o painel abre em modo degradado com aviso e
      botão de nova tentativa — nunca tela branca nem erro não tratado.
- [ ] Fechar e reabrir o mesmo card faz nova leitura (nada de dado velho silencioso).
- [ ] Nenhuma tabela nova, nenhuma coluna nova: `grep` por `body` no schema do board
      continua sem resultado.

## Contratos (assinaturas, não implementação)

```
GET /t/:tenant/projects/:id/board/cards/:number
→ 200 {
    number: number
    title: string
    state: 'open' | 'closed'
    htmlUrl: string
    body: string | null              // markdown cru, como está no GitHub
    author: { login, avatarUrl } | null
    assignees: { login, avatarUrl }[]
    labels: { name, color }[]        // color = hex do GitHub, sem tradução
    createdAt: string
    updatedAt: string
    closedAt: string | null
    timeline: {
      type: 'opened' | 'assigned' | 'unassigned' | 'labeled' | 'unlabeled'
          | 'closed' | 'reopened' | 'renamed'
      actor: { login, avatarUrl } | null
      createdAt: string
      label?: { name, color }
      assignee?: { login }
      rename?: { from: string, to: string }
    }[]
    fetchedAt: string                // carimbo da leitura ao vivo
  }
→ 404 issue inexistente · 502 falha de leitura no GitHub (aciona modo degradado)
```

Guards e escopo idênticos ao `BoardController` (JWT + tenant + RLS). Leitura →
token **user-to-server** (ADR-015). Nenhuma mutação nova.

## Notas técnicas

- **ADR-017 — uma fonte por fato.** O ADR já autoriza a UI a ler cache
  (*"o humano vê o botão Sincronizar e sabe que aquilo é uma foto"*), mas corpo e
  trilha mudam sem que nada nos avise (sem webhooks, ADR-009). Persistir seria criar
  uma segunda fonte defasada de um fato que o GitHub serve ao vivo — o padrão que o
  ADR chama de *"dado velho com aparência de autoridade"*. **Leitura sob demanda,
  descartada ao fechar.** Custo aceito pelo PI: ~2 chamadas e latência no open.
- **Sem `rehype-raw` no render do corpo.** O corpo da issue é conteúdo de terceiros;
  o `MarkdownView` atual já é seguro por padrão (HTML cru não é interpretado) e essa
  propriedade não pode ser afrouxada aqui.
- **Anexos privados do GitHub** (`user-attachments`) exigem sessão do GitHub no
  navegador; imagem que não carrega deve degradar para o link, não quebrar o layout.
- **Rate limit** — user-to-server dá 5.000 req/h; 2 por card aberto é folgado, mas o
  cliente não deve refazer a leitura a cada re-render (uma por abertura).
- **Trilha vs. board.** As labels `proplan:*` na trilha *são* o histórico de
  movimentação entre colunas — não inventar um evento sintético "moveu de X para Y"
  a partir delas nesta fatia; mostrar o fato como o GitHub o registra.
- **Reaproveitar**, não recriar: `MarkdownView`, o padrão de estados do
  `DocViewerPanel`, `EditCardPopover` intacto, tokens do `DESIGN.md`.

## Perguntas abertas

**Nenhuma.** As três que bloqueavam foram resolvidas pelo PI em 2026-07-25, todas
nas recomendações do Cowork. Registro do que foi decidido:

1. **Comentários da issue ficam FORA da trilha.** A trilha mostra eventos
   (abertura, atribuição, labels, fechamento, reabertura, rename), não conversa. Se
   a discussão estiver acontecendo na issue, o link "abrir no GitHub" resolve.
   Mantém o painel como ficha do card, não como thread.
2. **Trilha longa: 10 eventos mais recentes + "ver todos" que expande em linha.**
   Sem paginação contra o GitHub — a timeline já veio inteira na leitura.
3. **Gaveta lateral** (padrão do `DocViewerPanel`, `drawerIn` do `DESIGN.md` §9),
   largura `min(92vw, 720px)` — 720px é o mesmo teto que o modal centrado teria,
   então corpo com tabela não fica mais espremido do que ficaria na alternativa.
