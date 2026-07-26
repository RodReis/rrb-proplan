---
target: apps/web/src/pages/clients/ClientsPage.tsx
related_targets:
  - apps/web/src/pages/clients/ClientsShell.tsx
  - apps/web/src/pages/clients/FunnelPage.tsx
total_score: 31
p0_count: 0
p1_count: 2
timestamp: 2026-07-26T19-43-40Z
slug: apps-web-src-pages-clients-clientspage-tsx
---

## Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 3 | Lista mostra contagem e estados de loading/erro, mas nao mostra saude da relacao comercial. |
| 2 | Match System / Real World | 3 | Linguagem e clara, porem cliente ainda aparece como contato isolado, nao como relacao com projetos. |
| 3 | User Control and Freedom | 3 | Criar, editar, remover e cancelar existem; faltam filtros e atalhos por contexto. |
| 4 | Consistency and Standards | 4 | Banner, largura, painel e modal agora seguem o padrao visual do ProPlan. |
| 5 | Error Prevention | 3 | Mascaras reduzem erro, mas falta validacao comunicada para CPF/CNPJ/e-mail/CEP. |
| 6 | Recognition Rather Than Recall | 3 | Linha traz nome, empresa, contato e local; falta ultimo projeto/status para decisao rapida. |
| 7 | Flexibility and Efficiency | 3 | Busca existe; faltam ordenacao, filtros e acoes rapidas de contato. |
| 8 | Aesthetic and Minimalist Design | 4 | Densidade melhorou sem virar CRUD pesado; modal ficou escaneavel por blocos. |
| 9 | Error Recovery | 2 | Erros de salvar/carregar ainda sao genericos e nao apontam campo ou proxima acao. |
| 10 | Help and Documentation | 3 | Copy orienta a tela, mas nao antecipa fluxo recomendado para novo cliente. |
| **Total** | | **31/40** | **Bom operacionalmente; ainda falta transformar cliente em centro da relacao comercial.** |

## Anti-Patterns Verdict

Nao ha sinal forte de slop decorativo. O risco anterior era de tela autenticada com composicao estreita e solta; a padronizacao com o banner do ProPlan e o painel de lista corrigem boa parte disso.

Detector deterministico: `detect.mjs --json apps/web/src/pages/clients/ClientsShell.tsx apps/web/src/pages/clients/ClientsPage.tsx apps/web/src/pages/clients/FunnelPage.tsx apps/web/src/pages/clients/FunnelPage.css` retornou `[]`.

Overlay visual: conferido por screenshots locais do Playwright para Clientes, modal Editar cliente e Funil.

## What Improved Now

- `ClientsShell` passou a renderizar o mesmo banner visual do ProPlan no topo das telas Clientes e Funil.
- A pagina Clientes saiu do layout estreito e ganhou painel operacional com busca, contador, estados de loading/erro/vazio e linhas mais densas.
- O modal Editar cliente foi reorganizado por secoes: Identificacao, Contato, Endereco e Notas.
- A acao `+ Novo cliente` ficou dentro do banner, como CTA contextual da tela.
- A linha de cliente ganhou avatar, resumo de contato/localizacao e limite de truncamento para empresa longa.

## Priority Issues

**[P1] Cliente ainda nao mostra contexto comercial suficiente**

Why it matters: a frase da tela promete "quais projetos e em que ponto esta cada relacao", mas a lista ainda mostra principalmente dados cadastrais. O usuario precisa abrir outras telas para saber se o cliente esta ativo, parado, em contrato ou em entrega.

Fix: adicionar na linha do cliente um bloco compacto com `projetos ativos`, `ultimo projeto`, `etapa atual` e `proxima acao`. Se nao houver projeto, mostrar um CTA discreto `Criar projeto` ou `Vincular projeto`.

Suggested command: `$impeccable clarify apps/web/src/pages/clients/ClientsPage.tsx`

**[P1] Editar cliente precisa de validacao por campo, nao so toast generico**

Why it matters: CPF, CNPJ, e-mail e CEP parecem dados estruturados. Quando algo falha, o usuario deve saber exatamente qual campo corrigir antes de salvar.

Fix: validar formato localmente, marcar campo invalido com mensagem curta abaixo do input e desabilitar salvar apenas para erro bloqueante. Para CEP, separar "CEP nao encontrado" de "servico indisponivel" se houver autofill depois.

Suggested command: `$impeccable harden apps/web/src/pages/clients/ClientsPage.tsx`

**[P2] Falta eficiencia para carteiras maiores**

Why it matters: busca resolve ate certo ponto, mas com dezenas de clientes o usuario vai querer segmentar por empresa, cidade, cliente sem projeto, cliente com entrega ativa e cliente sem contato.

Fix: incluir filtros de estado operacional acima da lista: `Todos`, `Com projeto`, `Sem projeto`, `Em producao`, `Sem contato`. Ordenacao por nome, empresa e atividade recente.

Suggested command: `$impeccable layout apps/web/src/pages/clients/ClientsPage.tsx`

**[P2] Modal de edicao ainda e um formulario longo sem assistencia**

Why it matters: a divisao por secoes melhora escaneamento, mas campos de endereco e documentos ainda exigem digitacao manual e podem gerar inconsistencia.

Fix: adicionar autofill de endereco por CEP, normalizacao visual de UF em uppercase, hint de documento opcional e botao secundario de contato rapido quando houver WhatsApp/e-mail.

Suggested command: `$impeccable polish apps/web/src/pages/clients/ClientsPage.tsx`

## Persona Red Flags

**Alex (Power User)**: vai sentir falta de filtros e ordenacao quando houver muitas contas. A busca so por texto nao substitui segmentacao operacional.

**Sam (Acessibilidade/teclado)**: o modal tem trap de foco e Escape, mas mensagens de erro por campo ainda nao existem. Isso afeta principalmente leitores de tela e preenchimento por teclado.

**Rodrigo (PI/dev senior)**: a tela agora parece parte do produto, mas ainda nao entrega a promessa gerencial completa: cliente precisa conectar cadastro, projetos e funil na mesma leitura.

## Next UX/UI Moves

1. Linha de cliente com resumo de projetos e etapa atual.
2. Validacao inline no modal para documentos, e-mail e CEP.
3. Filtros operacionais no topo da lista.
4. Acoes rapidas: WhatsApp, e-mail, criar projeto, abrir funil filtrado pelo cliente.
5. Empty state com CTA coerente para `Novo cliente` e, depois do cadastro, `Criar primeiro projeto`.
