-- SPEC-039 — a venda da edição com código-fonte vira acesso ao repo privado, e o
-- acesso acaba quando o dinheiro volta.
--
-- PR-1 da Fatia 28 (4ª do MVP4). Só o schema: sem rota `/s/:token`, sem job de
-- convite, sem cliente do GitHub — mesmo recorte dos PR-1 da SPEC-036 e da
-- SPEC-038, e pelo mesmo motivo: a forma dos dados é a decisão mais cara de
-- desfazer.
--
-- A regra que organiza o arquivo: **o booleano não expressa a diferença que a
-- revogação precisa.** `source_invited` não distingue "convidado, ainda não
-- aceito" de "aceito" — e as duas situações se desfazem por chamadas DIFERENTES
-- na API do GitHub (`DELETE /invitations/:id` vs.
-- `DELETE /collaborators/:username`). Chamar a errada é **no-op silencioso**: a
-- API responde sem erro, ninguém vê falha, e o comprador reembolsado continua
-- com acesso ao código-fonte. Por isso o booleano sai e um enum de seis estados
-- entra.

-- ===========================================================================
-- Enum
-- ===========================================================================

-- `FAILED` é estado de primeira classe, não log: reembolsado que continua
-- colaborador é a falha que custa dinheiro, e ela precisa aparecer na lista de
-- pendências do admin. `ACTIVE` (aceitou o convite) é descoberto por
-- reconciliação — o GitHub não manda webhook de aceitação nesta configuração.
CREATE TYPE "LicSourceAccess" AS ENUM ('NONE', 'PENDING', 'INVITED', 'ACTIVE', 'REMOVED', 'FAILED');

-- ===========================================================================
-- licenses — o estado do acesso substitui o booleano.
--
-- A ordem importa: a coluna nova nasce, o dado do booleano é traduzido, e só
-- então o booleano é derrubado. Fazer o DROP antes do UPDATE perderia, sem aviso,
-- a informação de quem já havia sido convidado — em produção não há como
-- reconstruí-la, porque o `github_invitation_id` que permitiria consultar o
-- GitHub também nasce só agora.
-- ===========================================================================
ALTER TABLE "licenses" ADD COLUMN "source_access" "LicSourceAccess" NOT NULL DEFAULT 'NONE';
-- Login do GitHub do comprador. **Dado pessoal** (LGPD): a exclusão a pedido da
-- SPEC-040 remove este campo junto do resto.
ALTER TABLE "licenses" ADD COLUMN "github_username" TEXT;
-- Id da *invitation* devolvido pelo GitHub. É o que permite cancelar o convite
-- PENDENTE pela chamada certa — sem ele, a revogação só saberia remover
-- colaborador, que é exatamente o no-op silencioso descrito no topo do arquivo.
ALTER TABLE "licenses" ADD COLUMN "github_invitation_id" TEXT;
-- Motivo legível da última falha (403 do PAT expirado, 404 do repo, rede).
ALTER TABLE "licenses" ADD COLUMN "source_access_error" TEXT;

-- Tradução do que o booleano sabia. `true` só pode virar `INVITED`: o booleano
-- registrava que o convite SAIU, e nada nele dizia se foi aceito. Marcar `ACTIVE`
-- aqui afirmaria aceitação que ninguém verificou — e a primeira reconciliação
-- promove a `ACTIVE` quem de fato aceitou, que é o caminho honesto.
--
-- No banco local a tabela está vazia (verificado antes de escrever esta
-- migration), mas o UPDATE fica: produção é o ambiente em que ele importa, e uma
-- migration que só funciona onde não há dado não é uma migration.
UPDATE "licenses" SET "source_access" = 'INVITED' WHERE "source_invited" = true;
-- Quem tem convite agendado e ainda não foi convidado já nasce na fila do job.
UPDATE "licenses" SET "source_access" = 'PENDING'
  WHERE "source_invited" = false AND "source_invite_at" IS NOT NULL;

ALTER TABLE "licenses" DROP COLUMN "source_invited";

-- A varredura do job de reconciliação: quem tem direito, já passou do
-- `source_invite_at` e ainda não foi convidado. Sem o índice, cada rodada é uma
-- varredura na tabela de licenças.
CREATE INDEX "licenses_tenant_id_source_access_source_invite_at_idx"
  ON "licenses"("tenant_id", "source_access", "source_invite_at");

-- ===========================================================================
-- lic_products.source_repo — `owner/name` do repositório privado do produto.
--
-- Texto e não FK para `projects`: este repo é **destino de convite, não repo
-- ingerido** (§Notas técnicas). Não entra no catálogo, não é sincronizado, não
-- vira card. O vínculo com o catálogo, quando existe, é o `project_id` que já
-- está na tabela e responde outra pergunta.
-- ===========================================================================
ALTER TABLE "lic_products" ADD COLUMN "source_repo" TEXT;

-- ===========================================================================
-- lic_editions.grants_source_access — qual edição dá acesso ao código.
--
-- Existe para **não casar a edição pelo slug `source`**. Hardcode de slug
-- funciona no piloto e quebra em silêncio no primeiro produto que chame a edição
-- de outra coisa: a compra emitiria a licença sem agendar convite, e o comprador
-- da edição mais cara do catálogo nunca receberia o código-fonte — sem erro em
-- lugar nenhum.
-- ===========================================================================
ALTER TABLE "lic_editions" ADD COLUMN "grants_source_access" BOOLEAN NOT NULL DEFAULT false;

-- ===========================================================================
-- lic_settings.github_pat — o PAT fine-grained do tenant, criptografado.
--
-- **Não é o token do GitHub App** (ADR-015). São credenciais de propósitos
-- diferentes: aqui basta `administration:write` no repo do produto (decisão #8 do
-- MVP4), sem expandir as permissões do App nem exigir re-consent das
-- instalações. A arch-spec cobra a separação no código; misturá-las reabriria o
-- ADR por acidente.
--
-- Por tenant e não em env var (decisão PI #2): mesmo argumento aceito para o
-- `webhook_secret` — variável global não escala para o 2º tenant. Criptografado
-- com o `TOKEN_ENCRYPTION_KEY` que já existe no projeto.
-- ===========================================================================
ALTER TABLE "lic_settings" ADD COLUMN "github_pat" TEXT;

-- ===========================================================================
-- lic_source_links — o link de uso único que coleta o username. Raiz de tenancy.
--
-- **Só o hash.** O token em claro existe no e-mail do comprador e em nenhum
-- outro lugar: não entra em log, em `lic_events.payload` nem em mensagem de erro.
-- E ele vale mais que o token do briefing — quem o tiver grava o próprio username
-- e é convidado a um repositório privado.
--
-- **`used_at` é a morte do link, não um relógio** (decisão PI #3): sem prazo
-- fixo. Prazo curto trocaria um risco raro (link vazado) por um problema
-- frequente — o comprador que responde no dia 10 e encontra link morto, na venda
-- mais cara do catálogo, já pago e sem o que comprou.
-- ===========================================================================
CREATE TABLE "lic_source_links" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "license_id" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "used_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lic_source_links_pkey" PRIMARY KEY ("id")
);

-- O único caminho de busca da rota pública é por hash — e `UNIQUE` é o que faz
-- desse lookup uma operação e não uma varredura.
CREATE UNIQUE INDEX "lic_source_links_token_hash_key" ON "lic_source_links"("token_hash");
CREATE INDEX "lic_source_links_license_id_idx" ON "lic_source_links"("license_id");

-- Cascade nos dois: o link não sobrevive à licença nem ao tenant. Aqui não vale o
-- argumento de "preservar a prova" que manteve `mail_deliveries` com SetNull — o
-- link não é prova de nada, é uma credencial de uso único. Credencial órfã
-- apontando para licença apagada é só superfície.
ALTER TABLE "lic_source_links" ADD CONSTRAINT "lic_source_links_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "lic_source_links" ADD CONSTRAINT "lic_source_links_license_id_fkey"
  FOREIGN KEY ("license_id") REFERENCES "licenses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ===========================================================================
-- RLS (ADR-020, MVP4 decisão 2)
--
-- Raiz com `tenant_id` próprio, mesma policy do resto da casa. Fail-closed — sem
-- `app.tenant_ids`, `NULLIF(...,'')` vira NULL, `= ANY(NULL)` é NULL, e nenhuma
-- linha sai. `FORCE` porque o owner da tabela também precisa obedecer.
--
-- E é justamente esse fail-closed que exige a função abaixo: a armadilha já
-- custou CINCO ocorrências nesta frente.
-- ===========================================================================
ALTER TABLE "lic_source_links" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "lic_source_links" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "lic_source_links"
  USING ("tenant_id" = ANY (NULLIF(current_setting('app.tenant_ids', true), '')::text[]));

-- ===========================================================================
-- resolve_source_link — o lookup público, sem contexto de tenant.
--
-- Espelha a `resolve_briefing_link` (SPEC-029) e a `resolve_contract_link`
-- (SPEC-034) porque o problema é idêntico: `GET /s/:token` **não tem sessão**,
-- roda sem `app.tenant_ids`, e o RLS fail-closed devolveria vazio para TODO
-- token — inclusive os válidos. O sintoma seria "todo comprador vê link
-- inválido", sem erro em log.
--
-- Superfície mínima e auditável:
--   - recebe UM argumento: o hash (SHA-256 hex de um token de 256 bits);
--   - devolve o ciclo de vida do link + a licença + o tenant + o que a página
--     mostra (nome do produto e da edição);
--   - não aceita filtro livre, não lista, não pagina — não há como enumerar;
--   - o RLS continua ATIVO na tabela para todo o resto.
--
-- Por que não uma policy `USING (true)`: abriria a tabela inteira para qualquer
-- query sem contexto. Por que não uma role com BYPASSRLS: o ADR-022 proíbe (o
-- bootstrap FALHA se a role tiver `rolbypassrls`).
--
-- `search_path` fixo é obrigatório em SECURITY DEFINER: sem ele, um caller
-- poderia apontar `lic_source_links` para uma tabela própria e a função
-- executaria com privilégio de owner sobre ela.
--
-- **Nenhum dado pessoal do comprador sai daqui** (§Contratos: "só produto e
-- edição"). Nem e-mail, nem nome, nem o `github_username` já gravado: a página é
-- pública e quem a abre pode ser qualquer um com a URL. Devolver o e-mail do
-- comprador faria do link vazado um vazamento de dado pessoal, além de acesso.
-- ===========================================================================
CREATE OR REPLACE FUNCTION resolve_source_link(p_token_hash text)
RETURNS TABLE (
  id text,
  used_at timestamp(3),
  tenant_id text,
  license_id text,
  license_status "LicenseStatus",
  source_access "LicSourceAccess",
  product_name text,
  edition_name text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT sl.id, sl.used_at, sl.tenant_id, sl.license_id, l.status, l.source_access,
         p.name, e.name
  FROM lic_source_links sl
  JOIN licenses l ON l.id = sl.license_id
  JOIN lic_editions e ON e.id = l.edition_id
  JOIN lic_products p ON p.id = e.product_id
  WHERE sl.token_hash = p_token_hash
  LIMIT 1;
$$;

-- A função é o único caminho: `proplan_app` continua sem enxergar a tabela fora
-- de contexto (o RLS não muda). REVOKE de PUBLIC + GRANT explícito.
REVOKE ALL ON FUNCTION resolve_source_link(text) FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'proplan_app') THEN
    GRANT EXECUTE ON FUNCTION resolve_source_link(text) TO proplan_app;
  END IF;
END $$;
