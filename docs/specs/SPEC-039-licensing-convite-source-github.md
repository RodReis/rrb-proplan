---
proplan: v1
spec: SPEC-039
fatia: 28
status: aprovada-pi # rascunho | aprovada-pi | em-implementacao | entregue | aceita-pi
updated: 2026-07-29
---
# SPEC-039 — Licensing: convite ao repo source, coleta do username e revogação de colaborador

> 4ª fatia do MVP4 (`docs/specs/MVP4.md`). Depende das Fatias 25 (SPEC-036), 26 (SPEC-037) e 27 (SPEC-038): o `sourceInviteAt` que esta fatia consome é gravado lá, na compra.

## Objetivo

A venda da edição **com código-fonte** vira acesso ao repositório privado sem ninguém no meio — e o acesso acaba quando o dinheiro volta.

Passado o prazo legal de arrependimento (CDC art. 49, decisão #5 do MVP4), quem comprou é convidado ao repo. Quem pediu reembolso perde o convite pendente ou o assento de colaborador — pela chamada certa, que não é a mesma nos dois casos.

**O que esta fatia não entrega, e precisa estar escrito antes de qualquer tela dizer o contrário:** remover o colaborador **não recupera o que já foi clonado**. O que a remoção entrega é o fim dos *updates* — que é o mecanismo real do produto (§8 do MVP4: *"clone do repo source roda sem DRM — mecanismo é contratual"*). Painel que sugira "acesso revogado = código recuperado" mente para o operador.

## Escopo

### Coleta do username (página pública `/s/:token`)

- **E-mail no ato da compra** (template novo na fila `mail` da SPEC-038) com link único para uma página pública mínima onde o comprador informa o username do GitHub.
- **Padrão de link herdado** das SPEC-029/031: só o `tokenHash` no banco, **tenant derivado do hash** (nunca do payload), rota fora de `JwtAuthGuard`/`TenantGuard`, sem cookie de sessão, rate-limited, resposta **não-diferencial** (token inválido e token de outro tenant respondem igual), `<meta name="robots" content="noindex">`.
- **Uso único, sem prazo fixo** (decisão PI #3): o link morre ao ser usado ou quando o convite é emitido. Não existe o beco do comprador que abre o e-mail no dia 10 e encontra link morto — na venda mais cara do catálogo, esse beco vira ticket de suporte com o cliente já pago e sem o que comprou.
- **Validar existência não é validar identidade.** A página consulta o usuário na GitHub API e exibe **avatar, nome e login** para confirmação explícita antes de gravar. Sem esse passo, um typo convida um estranho para um repositório privado — e o erro só apareceria quando o estranho aceitasse.
- Gravado o username, o comprador recebe **e-mail nomeando quem será convidado e em que data**. É o canal por onde o erro volta *antes* de virar acesso; a confirmação na tela protege contra descuido, o e-mail protege contra o descuido confirmado.
- **Trocar depois é só pelo admin** (decisão PI #4): o admin substitui o username, o sistema cancela o convite pendente (se houver) e reagenda. Nenhum caminho automatizado reabre um token que concede acesso a código-fonte.

### Job do convite — reconciliação, não gatilho de data

- Job diário que seleciona licenças com **edição que concede source**, `status = ACTIVE`, `githubUsername` presente, `sourceInviteAt <= now` e `sourceAccess = PENDING`; convida com permissão `pull`, grava `githubInvitationId` e passa a `INVITED`.
- **"Dia 8" é o `sourceInviteAt`, não uma data no job.** Job que convidasse "quem comprou há exatamente 8 dias" deixaria órfão, para sempre e em silêncio, o comprador que informou o username no dia 9 — o caso mais provável de todos, porque depende de alguém ler e-mail. Quem responde no dia 20 é convidado no dia 20.
- **Sem username no `sourceInviteAt`**: nada acontece, e a licença entra na lista de pendências do admin. Ausência de convite é informação, não erro.
- **Idempotente por estado, não por horário**: a transição `PENDING → INVITED` é a guarda. Rodar o job duas vezes no mesmo dia, ou reprocessar depois de uma queda, não emite dois convites.
- **Aceitação é descoberta por reconciliação**, não por webhook: o GitHub não avisa aceitação de convite nesta configuração. O mesmo job confere colaborador e convites pendentes e move `INVITED → ACTIVE`.

### Estado do acesso — o booleano da SPEC-036 sai

- `License.sourceAccess: NONE | PENDING | INVITED | ACTIVE | REMOVED | FAILED`, mais `githubUsername?`, `githubInvitationId?`, `sourceAccessError?`.
- **`sourceInvited: Boolean` é removido na migração.** Ele não distingue *"convidado, ainda não aceito"* de *"aceito"* — e a revogação depende exatamente dessa diferença: convite pendente se cancela por `DELETE /repos/:owner/:repo/invitations/:id`; colaborador aceito se remove por `DELETE /repos/:owner/:repo/collaborators/:username`. **Chamar a errada é no-op silencioso**: a API responde sem erro e o comprador reembolsado continua com acesso. O campo foi carimbado na SPEC-036 antes desta fatia existir; agora que ela é real, o tipo não serve.

### Revogação de acesso

- Gatilhos: **reembolso** e **chargeback** (webhook da SPEC-038) e **revogação manual** no admin.
- **Antes do `sourceInviteAt`**: limpa o agendamento — comportamento já definido na SPEC-038, aqui só consumido.
- **Depois**: cancela o convite ou remove o colaborador, conforme o estado; `sourceAccess = REMOVED`.
- **Falha do GitHub é visível, com retry**: `FAILED` + erro legível na lista de pendências. Reembolsado que continua colaborador é a falha que custa dinheiro — ela não pode viver só no log, onde ninguém olha sem motivo.

### Configuração por tenant

- `LicSettings` (criada na SPEC-038) ganha **`githubPat`**, criptografado com o `TOKEN_ENCRYPTION_KEY` que já existe no projeto (mesmo mecanismo do token do GitHub App). Decisão PI #2 — mesmo argumento aceito para o `webhookSecret`: env var global não escala para o 2º tenant.
- `LicProduct.sourceRepo` (`owner/name`) e `LicEdition.grantsSourceAccess Boolean @default(false)`.
- **PAT fine-grained**, `administration:write` **só no repo do produto** (decisão #8 do MVP4): não expande as permissões do GitHub App (ADR-015) nem exige re-consent das instalações.
- Admin: no formulário de settings, o PAT é **write-only** (nunca reexibido) e tem **teste de conexão** que valida o escopo contra o repo configurado — a primeira venda não é o lugar de descobrir que o token está errado.

## Fora de escopo

- **Organização do GitHub e convite por e-mail** — o repo é pessoal (decisão PI #1). Fica registrado como simplificação futura: em org, o convite sai por e-mail e a página pública, o token e a validação de username **desaparecem**. Gatilho de revisão: 2º produto com edição source, ou 2º tenant vendendo código.
- Painel completo e métricas (Fatia 29 / SPEC-040) — aqui, o mínimo: lista de pendências de source com ação de corrigir username, reemitir convite e remover acesso.
- Outras plataformas de venda; portal self-service; cliente de licença do War Room.
- **Remoção por expiração de assinatura**: a edição source do piloto é `PERPETUAL`. Se um dia existir source em `SUBSCRIPTION`, *"expirou, remove do repo?"* é decisão de produto do PI, não extensão automática desta spec.
- Lembrete automático para quem não informou o username — a pendência no admin é o mecanismo desta fatia.

## Critérios de aceite

- [ ] Compra da edição source (fixture da SPEC-038) grava `sourceInviteAt = compra + 8 dias` e **enfileira o e-mail** com o link de coleta.
- [ ] `/s/:token` válido abre **sem sessão** (janela anônima), sem cookie, com `noindex`; token inválido, usado ou de outro tenant respondem **do mesmo jeito**.
- [ ] Username inexistente no GitHub → recusa **nomeando** o que foi procurado; username existente → tela mostra **avatar, nome e login** e exige confirmação explícita antes de gravar.
- [ ] Gravar o username marca o link como usado: **reabrir o mesmo link mostra "já utilizado", nunca o formulário de novo**.
- [ ] Gravado o username, o comprador recebe e-mail **nomeando o login que será convidado** e a data prevista.
- [ ] Job rodando **antes** do `sourceInviteAt` não convida; rodando **depois**, com username presente, convida **uma vez** — e rodar de novo no mesmo dia não emite segundo convite.
- [ ] Username informado **no dia 20** produz convite no dia 20 (o job é reconciliação, não gatilho de data).
- [ ] Licença sem username no dia 8 aparece na **lista de pendências** do admin; gravar o username pelo admin e rodar o job emite o convite.
- [ ] **Reembolso com convite pendente** cancela a *invitation* (`DELETE /invitations/:id`); **reembolso com colaborador aceito** remove o colaborador (`DELETE /collaborators/:username`). Os dois casos são testados **separadamente** — é a diferença que o booleano removido não expressava.
- [ ] Convite **aceito** no GitHub move `INVITED → ACTIVE` na reconciliação seguinte, sem webhook.
- [ ] Falha do GitHub (403, 404, rede) → `sourceAccess = FAILED` com erro legível na pendência, licença **intacta**, e o retry conclui quando a API volta.
- [ ] PAT ausente, expirado ou sem escopo → pendência explícita no admin; **nunca** falha silenciosa nem licença marcada como convidada.
- [ ] Tenant B não lê nem usa o PAT do tenant A (RLS verificado por teste).
- [ ] O token **não aparece** em log, em `LicEvent.payload` nem em mensagem de erro. A trilha registra `source_invite_sent`, `source_username_set`, `source_invited`, `source_invite_accepted`, `source_access_removed`.
- [ ] **CI não depende do GitHub real** (fixtures gravadas), como o CI da SPEC-038 não depende da Kiwify.
- [ ] `build` e `test` verdes (`lint` **quando existir** — [#190](https://github.com/RodReis/rrb-proplan/issues/190)); arch-spec de fronteira mantida: `licensing` usa `mail` pelo service público **e o caminho do convite não usa o cliente do GitHub App** — são credenciais de propósitos diferentes e misturá-las reabre o ADR-015 por acidente.

## Contratos

### Público (sem sessão)

`GET /s/:token` → `200 { status: valid|used|invalid, product?, edition? }` — só produto e edição; nenhum dado pessoal do comprador na resposta.
`POST /s/:token/username { username, confirm: true }` → `200 { username }` · `422` username inexistente · `410` link já usado · `404` inválido · `429` rate limit.

### Modelo (deltas)

```prisma
model LicSourceLink { id tenantId licenseId tokenHash @unique usedAt? createdAt }
```

`License` ganha `sourceAccess` (enum acima, default `NONE`), `githubUsername?`, `githubInvitationId?`, `sourceAccessError?` — e **perde `sourceInvited`**.
`LicProduct` ganha `sourceRepo?`; `LicEdition` ganha `grantsSourceAccess Boolean @default(false)`; `LicSettings` ganha `githubPat?` (criptografado).

### Admin

`GET /licensing/admin/source-pending` (sem username · convite pendente · `FAILED`) · `PUT /licensing/admin/licenses/:id/github-username { username }` · `POST /licensing/admin/licenses/:id/source-invite` (reemitir) · `DELETE /licensing/admin/licenses/:id/source-access` · `GET|PUT /licensing/admin/settings` (ganha o PAT, write-only, com teste de conexão).

## Notas técnicas

- **O token concede acesso a código-fonte privado — e isso é de outra ordem que o link do briefing.** Quem tiver a URL grava o próprio username e é convidado. As mitigações são três e nenhuma elimina o risco: **uso único** (a janela fecha no primeiro uso), **confirmação com avatar** (typo não passa despercebido) e **e-mail nomeando o convidado** (o comprador reclama antes do dia do convite). O que sobra é aceito: e-mail comprometido é acesso comprometido — o mesmo que vale para qualquer recuperação de senha.
- **Por que uso único e não prazo curto**: prazo curto minimiza exposição do token, mas troca um risco raro (link vazado) por um problema frequente (comprador que responde tarde e encontra link morto). O uso único fecha a janela no evento que importa — o uso — em vez de num relógio que não sabe nada sobre o comprador.
- **Por que `PUT /collaborators` e não convite por e-mail**: a API de repositório **pessoal** não aceita e-mail. Convite por e-mail existe em organização — daí a nota do *Fora de escopo*, que é onde a simplificação mora se o repo se mudar.
- **PAT fine-grained expira** (limite do GitHub). Expiração silenciosa pararia os convites sem nenhum erro visível; o que a torna visível é o par **teste de conexão no admin + pendência `FAILED`**. Rotação documentada em `docs/DEPLOY.md`, junto do par Ed25519.
- **A página não usa o `request()` do `lib/api`** — precedente do FIX #136: `request()` trata `401` como *"precisa logar"*, e quem informa o username nunca terá conta. `fetch` cru, e **`429`/`5xx` não viram "link inválido"**.
- **`sourceAccess` é do módulo `licensing`, não do `catalog`.** O repo do produto aqui é destino de convite, não repositório ingerido — não entra no catálogo, não é sincronizado, não vira card.
- **LGPD**: o username do GitHub é dado pessoal; a página declara a finalidade (*"para convidar você ao repositório do produto que comprou"*) e a exclusão a pedido remove `githubUsername` junto do resto (§7 do MVP4).
- Rate limit no `/s/:token` por IP e por token, mesmo desenho das rotas públicas existentes.

## Decisões do PI (2026-07-29)

Nenhuma pergunta aberta. As quatro que bloqueavam foram resolvidas:

1. **Repo em conta pessoal** — o convite exige username, então a página pública de coleta permanece. Org (convite por e-mail, que dispensaria página e token) fica registrada como simplificação futura, com gatilho.
2. **PAT por tenant, em `LicSettings`**, criptografado com o `TOKEN_ENCRYPTION_KEY` existente — mesmo argumento do `webhookSecret` da SPEC-038.
3. **Link de uso único**, válido até ser usado ou até o convite sair — sem prazo fixo.
4. **Correção de username é só do admin.** Nenhum caminho self-service reabre token que dá acesso a código-fonte.

### Pendências que não bloqueiam esta fatia

- **`lint` não existe no repo** ([#190](https://github.com/RodReis/rrb-proplan/issues/190)) — o critério de aceite exige `build` + `test`, e `lint` quando existir.
- **Domínio do remetente** (herdado da SPEC-038) — bloqueia só o primeiro envio real em produção; os testes usam fixtures.
