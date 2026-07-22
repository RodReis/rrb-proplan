/**
 * Cria/atualiza a role `proplan_app` no Postgres de produção (SPEC-027).
 *
 * Roda uma vez por banco, com a role OWNER (DIRECT_URL). Existe porque o init
 * do Docker (docker/postgres-init/01-app-role.sql) não roda no Railway.
 *
 * Uso:
 *   DIRECT_URL=postgres://owner:...@host:5432/railway \
 *   APP_DB_PASSWORD=<senha forte> \
 *   node scripts/bootstrap-app-role.mjs
 *
 * A senha NUNCA entra no repo: vem das Variables do Railway. Depois de rodar,
 * monte a DATABASE_URL do runtime com proplan_app:<senha>@<host privado>.
 *
 * Idempotente — re-executar troca a senha e re-aplica os grants.
 */
import { PrismaClient } from '@prisma/client';

const directUrl = process.env.DIRECT_URL;
const password = process.env.APP_DB_PASSWORD;

if (!directUrl) {
  console.error('DIRECT_URL ausente (conexão da role owner).');
  process.exit(1);
}
if (!password) {
  console.error('APP_DB_PASSWORD ausente (senha da role proplan_app).');
  process.exit(1);
}
// Aspas simples viram escape em literal SQL; barra invertida idem. Rejeitar é
// mais honesto que escapar silenciosamente uma senha que o operador escolheu.
if (/['\\]/.test(password)) {
  console.error("APP_DB_PASSWORD não pode conter aspa simples (') nem barra invertida (\\).");
  process.exit(1);
}

const prisma = new PrismaClient({ datasources: { db: { url: directUrl } } });

// $executeRawUnsafe: DDL não aceita parâmetro bindado para nome de role nem
// para senha. A senha é validada acima e vem de secret do operador, não de
// input de usuário.
const quoted = `'${password}'`;

try {
  const [{ current_user: owner }] = await prisma.$queryRawUnsafe(
    'SELECT current_user',
  );

  const exists = await prisma.$queryRawUnsafe(
    "SELECT 1 FROM pg_roles WHERE rolname = 'proplan_app'",
  );

  await prisma.$executeRawUnsafe(
    exists.length
      ? `ALTER ROLE proplan_app WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE PASSWORD ${quoted}`
      : `CREATE ROLE proplan_app WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE PASSWORD ${quoted}`,
  );
  console.log(exists.length ? 'role proplan_app: atualizada' : 'role proplan_app: criada');

  await prisma.$executeRawUnsafe('GRANT USAGE ON SCHEMA public TO proplan_app');
  await prisma.$executeRawUnsafe(
    'GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO proplan_app',
  );
  await prisma.$executeRawUnsafe(
    'GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO proplan_app',
  );

  // Garante acesso às tabelas que as migrations criarem depois.
  await prisma.$executeRawUnsafe(
    `ALTER DEFAULT PRIVILEGES FOR ROLE "${owner}" IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO proplan_app`,
  );
  await prisma.$executeRawUnsafe(
    `ALTER DEFAULT PRIVILEGES FOR ROLE "${owner}" IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO proplan_app`,
  );
  console.log(`grants aplicados (owner: ${owner})`);

  // Guarda contra o risco #1 da fatia: se a role virasse superuser/bypassrls, o
  // RLS seria no-op e o vazamento multi-tenant passaria despercebido.
  const [check] = await prisma.$queryRawUnsafe(
    "SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = 'proplan_app'",
  );
  if (check.rolsuper || check.rolbypassrls) {
    console.error('FALHA: proplan_app tem superuser/bypassrls — o RLS seria ignorado.');
    process.exit(1);
  }
  console.log('verificado: proplan_app é não-superuser e não ignora RLS.');
} finally {
  await prisma.$disconnect();
}
