import { PrismaClient } from '@prisma/client';
import { seedReference } from './reference.seed.mjs';

/**
 * Entrypoint do seed de referência no deploy (FIX #284).
 *
 * Roda no `preDeployCommand`, logo após o `prisma migrate deploy` — a ordem
 * importa: o seed escreve nas tabelas que a migração acabou de garantir.
 *
 * Falhar aqui **aborta o deploy** e mantém a versão anterior no ar, que é o
 * comportamento desejado: subir a api com as tabelas de referência vazias é
 * exatamente o estado que este fix existe para impedir — o formulário público
 * responderia 200 com listas vazias e o cliente não passaria da Etapa 1.
 *
 * Conecta com a `DATABASE_URL` do runtime (role `proplan_app`, não-owner). Não
 * precisa da `DIRECT_URL`/owner do `migrate deploy`: aqui é DML em tabela
 * global — `segments`, `states` e `cities` não têm `tenant_id` nem RLS, de
 * propósito (o seletor da Etapa 1 é montado sem tenant no contexto).
 */
const prisma = new PrismaClient();

seedReference(prisma)
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error('seed de referência falhou:', e);
    await prisma.$disconnect();
    process.exit(1);
  });
