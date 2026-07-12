---
proplan: v1
spec: SPEC-006
fatia: 6
status: aprovada-pi
updated: 2026-07-12
---
# SPEC-006 — Abas de convenção: Arquitetura, Design, Testes, Deploy, Skills & Agentes

## Objetivo

Completar o workspace: todas as abas restantes renderizando suas fontes primárias determinísticas (`CONVENTION.md`) — o ciclo inteiro do projeto visível, do desenho à produção. (Nota: Arquitetura e Design não estavam em nenhuma fatia do roadmap original; corrigido aqui.)

## Escopo

- **Ingestion — escopo ampliado**: incluir `.claude/**` (yaml/md) e `.github/workflows/*.yml` no filtro de sync (mesmo pipeline, mesmo hash). Migration não necessária; re-sync popula.
- **Aba Arquitetura**: renderiza `docs/ARCHITECTURE.md`. **Render de Mermaid no viewer entra aqui** (melhoria registrada na SPEC-002) — vale para todas as abas e para a aba Documentos. Sem o arquivo → estado vazio com aviso "fallback por IA na Fatia 7".
- **Aba Design**: renderiza `docs/DESIGN.md`. Mesmo comportamento.
- **Aba Testes & Ciclos**: fonte primária `docs/TESTING.md` (seções Estratégia e Ciclos executados; tabela renderizada estruturada). Fallback determinístico: parse de `.github/workflows/*.yml` → lista de workflows, jobs e gatilhos, com aviso "inferido do CI — crie docs/TESTING.md para a visão completa".
- **Aba Deploy**: renderiza a tabela de ambientes de `docs/DEPLOY.md` como componente estruturado (status com badge: ativo=success, inativo=neutro), não como markdown cru. **Sem fallback** (CONVENTION.md: deploy inferido errado é pior que ausente) — vazio com CTA de criar o doc.
- **Aba Skills & Agentes**: parse determinístico (sem IA) de `CLAUDE.md` (seções de skills/agentes se existirem), `.claude/skills/*/SKILL.md` e `.claude/agents/*.md` — nome + descrição do frontmatter, agrupados em Skills / Agentes / Plugins. Sem `.claude/` → "não configurado".
- **Web**: as cinco abas saem de desabilitadas; empty states conforme DESIGN.md (ilustração + CTA).

## Fora de escopo

Qualquer inferência por IA (Fatia 7), edição de documentos pelas abas, execução/estatística real de testes (só o que a doc/CI declara — limite do ADR-003), criação de DEPLOY.md pela UI.

## Critérios de aceite

- [ ] Re-sync de projeto com `.claude/` e workflows traz os novos arquivos (visíveis na aba Documentos também).
- [ ] rrb-proplan como repo gerenciado: aba Arquitetura renderiza ARCHITECTURE.md **com o diagrama Mermaid desenhado**, não como bloco de código.
- [ ] Aba Deploy com DEPLOY.md válido mostra a tabela estruturada com badges; sem o arquivo, CTA — nunca inferência.
- [ ] Aba Testes sem TESTING.md mas com workflows mostra a lista de CI com o aviso de origem.
- [ ] Aba Skills & Agentes lista skills/agents de um repo com `.claude/` (nome + descrição); sem a pasta, "não configurado".
- [ ] Documento da convenção presente sempre vence o fallback (regra do mapa aba→fonte).
- [ ] Nenhuma chamada de IA em toda a fatia.

## Contratos

- Parsers novos no `board` (composição de abas): `TestingDoc`, `DeployDoc` (tabela de ambientes), `SkillsIndex` — todos derivados de `documents`, sem tabelas novas (cache derivado, ADR-005).
- `GET /projects/:id/tabs/:tab` → payload estruturado por aba (evita o front conhecer regra de fallback).

## Notas técnicas

- Mermaid: renderizar client-side (`mermaid` lazy-loaded só quando há bloco), com fallback para código em erro de sintaxe — diagrama quebrado não pode derrubar a aba.
- Parse de workflow YAML: extrair `name`, `on`, jobs (nome + runs-on) — nada além; não interpretar steps.
- `.claude/skills` usa frontmatter `name`/`description` — mesmo parser gray-matter da Fatia 2.

## Perguntas abertas

Nenhuma.
