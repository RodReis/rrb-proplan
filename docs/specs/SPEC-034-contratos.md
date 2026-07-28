---
proplan: v1
spec: SPEC-034
fatia: 23
status: rascunho # rascunho | aprovada-pi | em-implementacao | entregue | aceita-pi
updated: 2026-07-28
---
# SPEC-034 — Contratos: perfil, templates versionados, snapshot imutável e link público

> **`rascunho` em 2026-07-28.** As decisões do PI de 2026-07-27 (corpo da #149)
> e as 6 de 2026-07-28 (§8) estão incorporadas — **não há pergunta aberta**.
>
> **Dependência dupla, e é dela que vem o carimbo**: o contrato congela
> **escopo** (SPEC-032, `kind = scope`) e **valor** (SPEC-033, `Estimate`
> aprovada). A SPEC-033 foi carimbada `aprovada-pi` em 2026-07-28 com a
> dependência dela própria em aberto; encadear um segundo carimbo sobre isso
> empilharia duas aprovações sobre a mesma incerteza. Ver §4.

## 1. Objetivo

5ª fatia do MVP3. Congela escopo e valor num **contrato-snapshot imutável**,
gerado de um **template versionado**, acessível ao cliente por **link público
auditado e de leitura**, com o aceite registrado pelo prestador no painel.

**É a fatia com o maior custo de erro do MVP3** (#149) e a razão é dupla: expõe
dado pessoal de duas partes numa URL sem autenticação, e produz um documento que
alguém pode tratar como vinculante. As duas coisas são tratadas como escopo, não
como rodapé — §2.7 a §2.11 e §7.1.

## 2. Escopo

Módulos novos `contracts` (+ `ProviderProfile`), conforme MVP3 §3. Estrutura
padrão (`presentation/` · `application/` · `domain/` · `infrastructure/`).

1. **`ProviderProfile`** — dados do prestador (pessoa/empresa, documento,
   endereço, contato), **um por tenant**. Alterável só pelo `owner` (regra do
   ADR-026). Mascarado em log e em qualquer payload de erro — nunca no contrato
   em si (§2.7).
2. **`ContractTemplate` + `ContractTemplateVersion`** — **um template por
   modalidade** (`desenvolvimento` · `desenvolvimento_manutencao` ·
   `desenvolvimento_venda_codigo`, MVP3 §3), sem seção condicional dentro de
   texto jurídico. Editar **cria versão nova**; contrato já emitido **nunca**
   muda por edição de template.
3. **Seed de template-exemplo por modalidade**, marcado `isSeedExample`.
   **O 1º contrato de uma modalidade exige que o template tenha ao menos uma
   versão salva pelo prestador** — o produto não emite contrato com texto que o
   dono nunca leu (§8.2, §7.3).
4. **Placeholders por substituição escapada**, nunca engine que avalie
   expressão: `{{provider_name}}`, `{{provider_document}}`, `{{provider_address}}`,
   `{{client_name}}`, `{{client_document}}`, `{{client_address}}`, `{{scope}}`,
   `{{budget}}`, `{{duration_days}}`, `{{payment_terms}}`, `{{date}}`,
   `{{modality}}`. Placeholder desconhecido é **erro de validação na hora de
   salvar o template**, não texto cru vazando para o contrato do cliente.
5. **`Contract` é snapshot imutável**: copia — não referencia — prestador,
   cliente, escopo (da `ArtifactVersion` aprovada de `kind = scope`), valor e
   duração em dias (da `Estimate` aprovada), texto renderizado e a
   `ContractTemplateVersion` usada. Editar qualquer origem depois **não** muda
   contrato emitido; refazer **emite contrato novo**, versionado.
6. **Emitir contrato NÃO move o card.** Quem move para `CONTRACT_PENDING` é a
   aprovação da estimativa (SPEC-033 §2.11). **Registrar o aceite** move
   `CONTRACT_PENDING → CONTRACT_APPROVED`, com `ClientStatusTransition` e ator
   **nunca nulo**.
7. **Link público de leitura, com dados completos das partes.** Decisão do PI
   (§8.1): CPF/CNPJ e endereço **completos** das duas partes no HTML — é o que
   um contrato de verdade traz. **Sem botão "Aceito"**: aceite anônimo seria
   assinatura sem nenhuma garantia de assinatura.
8. **Mitigações que acompanham a decisão 7, todas obrigatórias** (§8.1):
   - **Expiração de 48 h** (não 7 dias), regeneração livre.
   - `Cache-Control: no-store` + `Pragma: no-cache` — sem cópia em proxy,
     browser ou CDN.
   - `X-Robots-Tag: noindex, nofollow` e `<meta name="robots">`.
   - **Aviso em tela**, acima do contrato: este link contém dados pessoais das
     duas partes e expira em 48 h.
   - **Revogação em 1 clique** no painel, com efeito imediato.
9. **Nada de PDF** — nem gerado, nem guardado. HTML na página pública e
   `Ctrl+P` do cliente. Assim o gatilho *"segundo caso de uso de binário"* do
   ADR-025 **não** é disparado.
10. **Registro de aceite pelo prestador**: ator, data/hora, **canal de lista
    fechada** (`email | whatsapp | presencial | telefone`) e observação livre.
    O link **continua válido até expirar** depois do aceite (§8.4) — o cliente
    relê o que aceitou.
11. **Acesso ao link é auditado, mas sem IP nem user agent** — só data/hora,
    `AuditEvent` (decisão do PI, #149). Guardar IP seria coletar mais dado
    pessoal na fatia cujo problema é justamente excesso de dado pessoal.
12. **Disclaimer fixo no rodapé do contrato renderizado** (não só na tela de
    edição): documento não revisado juridicamente, sujeito a revisão por
    advogado. Viaja com o documento que o cliente lê (§8.2).
13. **Leitura no painel**: contratos do `ClientProject` com estado, versão do
    template usada, estado do link e trilha de acessos.

## 3. Fora de escopo

- **Dados bancários** — não existem nesta fatia (decisão do PI, #149; backlog
  no `STATUS.md`). Formas de pagamento entram como texto em `{{payment_terms}}`.
- **Assinatura eletrônica / integração com DocuSign & similares.** O aceite
  desta fatia é **registro do prestador**, não assinatura — e a spec não deve
  sugerir o contrário em lugar nenhum da UI.
- **Geração ou armazenamento de PDF** (§2.9).
- **Data de início.** O contrato carrega **duração em dias** — nenhuma fatia do
  MVP3 produz data (mesma restrição da SPEC-033 §3).
- **Segunda barreira de autenticação no link** (ex.: confirmar 4 dígitos do
  documento). Avaliada e descartada nesta fatia por atrito e tamanho; volta a
  ser candidata se o gatilho do §7.1 disparar.
- **Contrato multi-idioma, aditivo contratual, rescisão.**

## 4. Pré-requisitos

1. **SPEC-032 (Fatia 21) aceita** — o `{{scope}}` vem da `ArtifactVersion`
   aprovada de `kind = scope`.
2. **SPEC-033 (Fatia 22) entregue e aceita** — `{{budget}}` e
   `{{duration_days}}` vêm da `Estimate` aprovada, e é a aprovação dela que põe
   o card em `CONTRACT_PENDING`, estado a partir do qual esta fatia opera.

   > **Por que esta spec não é carimbada junto**: a SPEC-033 recebeu
   > `aprovada-pi` em 2026-07-28 **com a dependência dela em aberto**, por
   > decisão do PI. Carimbar a SPEC-034 agora empilharia um segundo carimbo
   > sobre a mesma incerteza — duas specs aprovadas contra um contrato de dados
   > (`Estimate`) que ainda não existe em código. Uma vez é decisão de risco
   > tomada de olhos abertos; duas vira hábito, e o hábito é o que este produto
   > existe para detectar.

3. **Nenhum ADR novo previsto.** Se a decisão de expor documento completo em URL
   pública for revisada (gatilho no §7.1), aí sim vira ADR — porque terá virado
   decisão estrutural sobre dado pessoal, não detalhe de tela.

## 5. Critérios de aceite

**Template e perfil**

- [ ] `member` (não-`owner`) não altera `ProviderProfile` nem template.
- [ ] Salvar template **cria versão nova**; a anterior continua legível.
- [ ] Emitir contrato de uma modalidade cujo template só tem a versão semeada é
      **recusado** com motivo legível ("edite e salve o template antes").
- [ ] Placeholder desconhecido no corpo do template é recusado **ao salvar**,
      com o nome do placeholder na mensagem.
- [ ] Renderização escapa o valor substituído: um cliente chamado
      `<script>alert(1)</script>` aparece como texto no HTML público, não
      executa (teste direto).

**Snapshot**

- [ ] Emitir contrato exige `Estimate` aprovada e `scope` aprovado; sem um dos
      dois, recusa com motivo legível.
- [ ] Editar o template **depois** de emitir não altera o contrato emitido
      (teste comparando o texto renderizado antes e depois).
- [ ] Editar o cliente (nome/endereço) depois de emitir não altera o contrato
      emitido — o snapshot copiou, não referenciou.
- [ ] Não existe rota que altere `Contract` (teste que lê metadados de rota do
      Nest, padrão do PR-6 da SPEC-031, estendido ao módulo novo).

**Link público — a parte cara**

- [ ] Token inexistente, de outro tenant, expirado ou revogado: inexistente e
      alheio devolvem **a mesma** resposta; nenhum dos quatro vaza tenant,
      cliente ou projeto (não-diferencial, padrão da SPEC-029/031).
- [ ] O tenant é resolvido por **função `SECURITY DEFINER` própria** a partir do
      hash do token — nunca de `workspaceId` no request. **O teste de
      fail-closed é escrito antes do controller** (§7.2).
- [ ] Rate limit próprio na rota pública, com `Retry-After` no 429.
- [ ] Resposta traz `Cache-Control: no-store`, `Pragma: no-cache` e
      `X-Robots-Tag: noindex, nofollow`; o HTML traz `<meta name="robots">`.
- [ ] O link expira em **48 h** por padrão e a tela mostra o aviso de dados
      pessoais **acima** do contrato (não no rodapé, não abaixo da dobra — a
      SPEC-031 já pagou esse defeito uma vez, com um aviso invisível na etapa 9).
- [ ] Revogar no painel derruba o acesso na requisição seguinte.
- [ ] Acesso ao link grava `AuditEvent` **sem IP e sem user agent**; um teste
      afirma essa ausência (auditável por ausência, padrão do §7.1 da SPEC-032).
- [ ] Nenhuma rota pública devolve `notes` internas do cliente, e-mail/telefone
      do cliente que não estejam no corpo do contrato, nem qualquer campo de
      outro `ClientProject`.

**Aceite e funil**

- [ ] Emitir contrato **não** move o card.
- [ ] Registrar aceite move `CONTRACT_PENDING → CONTRACT_APPROVED` com ator
      **nunca nulo** e grava canal (lista fechada) + observação.
- [ ] Canal fora da lista fechada é recusado.
- [ ] O link **continua acessível** depois do aceite, até expirar.
- [ ] Não existe caminho pelo qual o cliente (rota pública) registre aceite.

**Transversal**

- [ ] O disclaimer aparece no **contrato renderizado**, não só na tela de
      edição do template.
- [ ] Auditoria de RLS no CI cobre as tabelas novas.

## 6. Contratos

**Consome**:

```ts
// artifacts (SPEC-032) — ArtifactVersion.content quando kind = 'scope'
{ entregaveis: string[]; foraDeEscopo: string[]; premissas: string[]; riscos: string[] }

// estimates (SPEC-033) — Estimate aprovada
{ scenarios: { provavel: { totalBrl: number; durationDays: number } } }
```

> **Ponto a reler se a SPEC-033 mudar** (§4): o contrato consome **um** número
> de valor e **um** de duração. Qual cenário vira `{{budget}}` é decisão de
> produto que a SPEC-033 §2 não fixa explicitamente — esta spec assume o
> **provável**, e o assume **em voz alta** em vez de escolher em silêncio.

**Modelos novos** (assinatura, não implementação):

- `ProviderProfile` — raiz de tenancy, `tenantId` **@unique** (um por tenant):
  `legalName`, `documentType` (`cpf|cnpj`), `document`, endereço, contato,
  `updatedAt`.
- `ContractTemplate` — raiz, por (`tenantId`, `modality`) **@unique**;
  `currentVersionId`, `isSeedExample` (vira `false` na 1ª versão salva pelo
  prestador).
- `ContractTemplateVersion` — **imutável**: `version` sequencial por template,
  `body` (texto com placeholders), `createdBy`, `createdAt`.
- `Contract` — raiz, **imutável**: `clientProjectId`, `modality`,
  `templateVersionId`, `renderedHtml`, `providerSnapshot` (`jsonb`),
  `clientSnapshot` (`jsonb`), `scopeSnapshot` (`jsonb`), `budgetBrl`,
  `durationDays`, `paymentTerms`, `version` sequencial por projeto,
  `acceptedAt`, `acceptedBy`, `acceptanceChannel`, `acceptanceNote`,
  `createdAt`.
- `ContractLink` — token 256 bits, **só o hash persiste** (padrão
  `BriefingLink`): `contractId`, `tokenHash` @unique, `expiresAt` (default
  agora + 48 h), `revokedAt`, `createdAt`.

**Enum novo**: `AcceptanceChannel { email whatsapp presencial telefone }`.

**Função de banco nova**: `resolve_contract_link(token_hash)` — `SECURITY
DEFINER` de superfície mínima, espelhando `resolve_briefing_link`: recebe só o
hash, devolve só este link, não lista nem pagina.

**Rotas autenticadas** (sob `withTenant`):

- `GET|PUT   /t/:tenant/provider-profile` — só `owner` escreve.
- `GET       /t/:tenant/contract-templates` · `GET .../:modality/versions`
- `POST      /t/:tenant/contract-templates/:modality/versions` — salva nova
  versão (não é `PATCH`: nada é alterado no lugar).
- `POST      /t/:tenant/client-projects/:id/contracts` — emite (snapshot).
- `GET       /t/:tenant/client-projects/:id/contracts` — lista versões.
- `POST      /t/:tenant/contracts/:id/link` — cria/regenera (revoga o anterior).
- `DELETE    /t/:tenant/contracts/:id/link` — revoga.
- `POST      /t/:tenant/contracts/:id/acceptance` — registra aceite; **é aqui,
  e só aqui, que o card se move**.

**Rota pública** (sem sessão, sem `/t/:tenant`):

- `GET /c/:token` — HTML do contrato + estado do link. Rate limit próprio;
  `no-store`, `noindex`; nada além do contrato.

## 7. Notas técnicas

### 7.1 O risco que a decisão 8.1 aceita, dito com todas as letras

Documento e endereço completos das duas partes ficam legíveis para **quem tiver
a URL**, sem autenticação, por 48 h. A ameaça não é enumeração — 256 bits de
entropia resolvem isso — é **o link circular**: encaminhado em grupo de
WhatsApp, printado, deixado no histórico de um aparelho compartilhado.

O PI decidiu por dado completo (é o que um contrato traz) **com** as mitigações
do §2.8. O que as mitigações fazem: encurtam a janela, impedem cópia em cache e
dão ao prestador um botão de corte. O que elas **não** fazem: impedir que quem
recebeu o link o repasse. Isso é irredutível sem segunda barreira, e a segunda
barreira foi conscientemente deixada fora (§3).

**Gatilho de revisão** — qualquer um destes reabre a decisão como ADR: (a) um
link de contrato comprovadamente circulou fora do destinatário; (b) o produto
passar a ter mais de um prestador por tenant emitindo contrato; (c) demanda de
cliente por LGPD/ANPD. Registrado aqui para que a revisão tenha critério, e não
dependa de alguém lembrar.

### 7.2 2º link público do produto — a lista já conhecida

A SPEC-029/031 pagaram estas armadilhas, **cinco vezes** a mesma classe. Nenhuma
delas deve ser redescoberta aqui:

1. **RLS fail-closed em rota sem sessão devolve zero linhas, não erro.** Service
   de módulo autenticado chamado de rota pública precisa de
   `runInTenantContext`, ou o corte acontece em silêncio. Daí a
   `resolve_contract_link` `SECURITY DEFINER`.
2. **`fetch` cru sem o `request()` da casa** — o cliente web tem que usar o
   helper com `withTenantPrefix`; o FIX #166 nasceu exatamente disso, e nenhum
   teste pegou porque **todos mockam a camada de API**, que é onde o defeito
   mora.
3. **Resposta não-diferencial** entre token inexistente e token de outro tenant.
4. **Rate limit próprio** na rota pública.
5. **O teste de fail-closed vem antes do controller** (#149) — escrito depois,
   ele passa a documentar o que foi construído em vez de barrar o que não pode
   existir.

### 7.3 Por que exigir uma edição do template antes do 1º contrato

O seed existe para a fatia ser utilizável no dia 1 (§8.2). O risco é o texto
semeado ser usado como veio, com o ProPlan virando **fonte de minuta jurídica
sem advogado por trás** — um risco de produto, não de código.

A trava é deliberadamente fraca: exige **uma** edição salva, não revisão de
verdade. Ela não garante que o texto foi lido — garante que o dono passou pela
tela e assumiu o texto uma vez, e que o `isSeedExample` deixa de mentir. O
disclaimer no rodapé do documento (§2.12) cobre o resto, e cobre no lugar certo:
junto do que o cliente lê.

### 7.4 Herdado, sem novidade

- Toda query sob `withTenant` (`ARCHITECTURE.md`, regra de 2026-07-22).
- Interativa, não lote, sob contexto de tenant (issue #113 /
  `batch-transaction.arch.spec.ts`).
- Token em claro devolvido **uma única vez**, nunca persistido nem logado
  (padrão `BriefingLinkService`).
- Nada de IA nesta fatia — o `ContractComposer` do MVP3 §6 **não** entra: o
  contrato é renderização determinística de template + snapshot. LLM redigindo
  cláusula é exatamente o que o ADR-012 e o MVP3 §9 recusam.

## 8. Decisões do PI

**2026-07-27** (registradas na #149, incorporadas em §2/§3): link público só de
leitura, sem botão "Aceito" anônimo · um template por modalidade · nada de PDF ·
expiração obrigatória com regeneração livre · dados bancários fora · emitir não
move o card, aceite move · duração em dias, não data · sem IP e user agent no
acesso.

**2026-07-28** (esta rodada):

| # | pergunta | decisão | onde entrou |
|---|---|---|---|
| 1 | O que aparece no HTML público | **Dados completos das duas partes** (CPF/CNPJ e endereço) — com as 5 mitigações obrigatórias do §2.8, **incluindo expiração reduzida de 7 dias para 48 h** | §2.7, §2.8, §7.1 |
| 2 | Template semeado ou em branco | **Seed de exemplo por modalidade**, + **exigir 1 edição salva antes do 1º contrato** + **disclaimer no rodapé do documento** | §2.3, §2.12, §7.3 |
| 3 | Canal do aceite | **Lista fechada** (`email`/`whatsapp`/`presencial`/`telefone`) + observação livre | §2.10, §6 |
| 4 | Link depois do aceite | **Continua válido até expirar** | §2.10 |
| 5 | Segunda barreira no link (4 dígitos do documento) | **Fora desta fatia** — atrito e tamanho; volta se o gatilho do §7.1 disparar | §3, §7.1 |
| 6 | Expiração | **48 h** (revisa a decisão de 7 dias da #149, como mitigação da #1) | §2.8 |

**Não há pergunta aberta.**

## 9. Nota de processo

A #149 é a única das quatro issues placeholder (#147–#150) cujo corpo **já
tinha sido corrigido** em 2026-07-27 — ela diz, com todas as letras, que o
arquivo não existe e que *"até lá, nada de código"*. Esta spec materializa o
arquivo; o ponteiro deixa de ser promessa.

**O que esta spec deliberadamente não faz**: virar `aprovada-pi` junto. A
SPEC-033 foi carimbada com a dependência em aberto por decisão do PI, e isso é
prerrogativa dele — mas repetir aqui transformaria uma exceção consciente em
regra silenciosa. O carimbo desta fica para quando a Fatia 22 estiver entregue,
ou para uma decisão explícita do PI que saiba que está sendo a segunda.
