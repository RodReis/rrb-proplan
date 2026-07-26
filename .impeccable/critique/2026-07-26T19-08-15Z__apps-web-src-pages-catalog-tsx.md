---
target: apps/web/src/pages/Catalog.tsx
total_score: 24
p0_count: 0
p1_count: 3
timestamp: 2026-07-26T19-08-15Z
slug: apps-web-src-pages-catalog-tsx
---
## Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 3 | Conexao e loading aparecem, mas a lista nao deixa claro prioridade/recencia. |
| 2 | Match System / Real World | 3 | Linguagem e correta para dev, mas "catalogo" parece vitrine, nao painel operacional. |
| 3 | User Control and Freedom | 2 | Ha desconectar/desgerenciar, mas sem filtro/busca/atalho para repos. |
| 4 | Consistency and Standards | 3 | Usa tokens e padrao do shell, mas o hero destoa da densidade de produto. |
| 5 | Error Prevention | 3 | Confirmacoes existem; faltam guardrails visuais para repos gerenciados vs pendentes. |
| 6 | Recognition Rather Than Recall | 2 | Usuario precisa varrer lista; nao ha agrupamento acionavel por estado. |
| 7 | Flexibility and Efficiency | 1 | Fluxo um repo por vez, sem busca, filtro, ordenacao ou bulk. |
| 8 | Aesthetic and Minimalist Design | 2 | Muito vazio lateral e vertical; pixels nao estao trabalhando. |
| 9 | Error Recovery | 3 | Erros sao exibidos, mas recuperacao e generica. |
| 10 | Help and Documentation | 2 | Texto explica seguranca, mas nao ajuda a decidir o proximo passo. |
| **Total** | | **24/40** | **Acceptable: base funcional, layout precisa reestruturar.** |

## Anti-Patterns Verdict

O problema nao parece "AI slop" decorativo pesado. O problema e mais de produto: a pagina usa composicao de landing page estreita dentro de um painel desktop. Em `Catalog.tsx`, o wrapper `max-w-[980px]` centralizado cria os vazios laterais, enquanto `overflow-y-auto` no conteudo e uma lista vertical longa empurram a tela para scroll.

Detector deterministico: `detect.mjs --json apps/web/src/pages/Catalog.tsx` retornou `[]`. Isso nao invalida os problemas, porque sao estruturais de layout/UX, nao regras sintaticas detectaveis.

Overlay visual: nao aplicado. Usei a captura fornecida pelo usuario e leitura do codigo como evidencia visual; nao havia ferramenta de subagente/browser mutavel exposta nesta sessao.

## Overall Impression

A tela funciona como cadastro/listagem, mas desperdiça a area mais valiosa do desktop. Para um app de gestao, o usuario deveria conseguir decidir rapidamente: quais repos estao gerenciados, quais faltam gerenciar, quais precisam acao e onde abrir. Hoje ele ve uma coluna estreita, rola para baixo e precisa ler linha por linha.

## What's Working

- Estado de conexao esta separado do estado dos repos. Isso evita confundir "desconectar GitHub" com "desgerenciar repo".
- As linhas de repos sao densas o suficiente individualmente; o problema e o container e a hierarquia ao redor.
- O uso de tokens/tema esta alinhado ao Carbono/Claro, sem cores absolutas evidentes no componente.

## Priority Issues

**[P1] Layout estreito gera vazio lateral e scroll desnecessario**

Why it matters: em desktop largo, metade da tela vira margem morta enquanto a lista cresce para baixo. Isso reduz a quantidade de repos visiveis e obriga scroll onde caberia mais conteudo.

Fix: trocar `max-w-[980px]` por layout responsivo de painel: `max-w-[1440px]` ou largura total com grid de 12 colunas. Lista ocupa 8-9 colunas; coluna lateral de 3-4 colunas mostra resumo, filtros, status da conexao e CTA. Em telas muito largas, limitar por `max-w-[1500px]`, nao 980.

Suggested command: `$impeccable layout apps/web/src/pages/Catalog.tsx`

**[P1] A pagina rola como documento, nao como ferramenta**

Why it matters: "sem scroll vertical" literal nao escala para 50+ repos, mas a tela atual rola mesmo em cenarios pequenos porque banner, card, gaps e lista somam altura demais.

Fix: transformar o conteudo em viewport fixo: `main` sem scroll de pagina; topo compacto; lista em area calculada (`min-h-0`, `overflow-hidden`) com tabela/lista virtual, paginacao ou scroll interno apenas quando o volume exigir. Para ate 7-10 repos, tudo deve caber no primeiro viewport.

Suggested command: `$impeccable adapt apps/web/src/pages/Catalog.tsx`

**[P1] Hierarquia nao ajuda a decidir o que fazer**

Why it matters: todos os repos tem peso parecido. O usuario precisa descobrir manualmente quais estao gerenciados, quais nao, e qual acao importa.

Fix: adicionar uma faixa operacional acima da lista: contadores clicaveis `Todos`, `Gerenciados`, `Nao gerenciados`, `Privados`, campo de busca e ordenacao por ultimo push/estado. Separar visualmente "Abrir workspace" como acao primaria para gerenciados e "Gerenciar" como primaria para nao gerenciados.

Suggested command: `$impeccable clarify apps/web/src/pages/Catalog.tsx`

**[P2] Hero ocupa espaco demais para uma tela autenticada**

Why it matters: o banner comunica marca, mas no uso diario vira obstaculo. Em produto, a primeira dobra deve priorizar acao e estado, nao imagem.

Fix: reduzir o hero para uma barra de contexto de 72-96px ou integrar titulo, conexao e CTA no header do conteudo. A imagem pode virar detalhe sutil, nao bloco de 160px.

Suggested command: `$impeccable distill apps/web/src/pages/Catalog.tsx`

**[P2] Falta modo denso/escaneavel para repos**

Why it matters: linha em card e boa para poucos itens, mas ruim para catalogo. Repos sao entidades comparaveis; pedem tabela leve ou lista com colunas previsiveis.

Fix: trocar cards por tabela/lista densa com colunas: repo, descricao, ultimo push, estado, acoes. Manter selecao/filtro no topo e acoes alinhadas na direita.

Suggested command: `$impeccable polish apps/web/src/pages/Catalog.tsx`

## Persona Red Flags

**Alex (Power User)**: nao tem busca, filtro, ordenacao nem bulk. Para 20 repos, ele precisa varrer a tela manualmente e clicar um por um.

**Sam (Acessibilidade/teclado)**: indicadores de gerenciado dependem muito de ponto verde/cinza; precisa texto/estado mais forte e foco claro nos botoes principais.

**Rodrigo (PI/dev senior)**: a tela nao respeita o modo de trabalho desktop. Ele quer decidir rapido entre repos; hoje o espaco lateral nao vira informacao e a rolagem atrasa a comparacao.

## Minor Observations

- `Catálogo` como titulo e fraco para acao. `Repositórios` ou `Projetos GitHub` comunica melhor a tarefa.
- O rodape explicativo repete seguranca quando poderia virar tooltip/nota fixa menor.
- O botao `Instalar em mais repositórios` fica longe do contexto da lista; poderia morar na barra de filtros/acoes.
- A lista nao mostra "qual repo merece atencao agora"; ultimo push existe, mas nao vira ordenacao nem destaque.

## Questions to Consider

- A tela principal deve otimizar "abrir projeto gerenciado" ou "configurar novos repos"?
- Quantos repos o caso real precisa suportar sem dor: 7, 30 ou 100?
- O que e mais importante no primeiro viewport: status da conexao, lista de repos, ou acoes de instalacao?
