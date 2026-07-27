---
target: apps/web/src/pages/clients/ClientDetailPanel.tsx
total_score: 22
p0_count: 0
p1_count: 3
timestamp: 2026-07-26T23-59-01Z
slug: apps-web-src-pages-clients-clientdetailpanel-tsx
---
Method: dual-agent (A: 019fa0d8-1967-74b2-8406-26ce5630f89e · B: 019fa0d8-36de-7081-9f83-b40fb80cc384)

Design Health Score: 22/40.

Priority issues:

1. [P1] O fluxo usava "Novo / Link enviado" antes de existir link gerado/copiad. Isso induz o usuario a sair da tela achando que a acao ja aconteceu. Fix aplicado: copy do fluxo agora separa Rascunho, Gerar link e Copiar link; toast e modal de novo projeto nao dizem mais que o link foi enviado.

2. [P1] O token unico podia ser perdido por clique no backdrop ou Escape. Fix aplicado: quando o token recem-gerado esta visivel, o modal de link nao fecha por backdrop/Esc; o fechamento fica explicito.

3. [P1] A hierarquia do detalhe do cliente nao conduzia a proxima acao. Fix aplicado: drawer ganhou resumo do fluxo, contador de projetos, empty state com CTA, cards mais escaneaveis e CTA de link com forma de botao.

4. [P2] Textos pequenos usavam text-dim, reservado no design system para nao-texto. Fix aplicado no fluxo tocado: metadados e erro tecnico migraram para text-faint/text-muted.

5. [P2] A lista de clientes tinha role="button" mas ativava so Enter. Fix aplicado: Space tambem abre o detalhe com preventDefault.

Detector: detect.mjs retornou 0 findings nos arquivos da frente Clientes. Sinais manuais restantes: overlays com rgba hardcoded e modais ainda usando shadow-lg, consistentes com o padrao atual mas candidatos a uma passada posterior de tokens/escala de elevacao.
