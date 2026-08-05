import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Seed de dados de REFERÊNCIA do briefing público (SPEC-031 §3): segmentos,
 * estados e municípios.
 *
 * ## Por que este arquivo existe separado do `seed.ts`
 *
 * O cabeçalho do `seed.ts` sempre disse que localidades e segmentos "valem em
 * produção também" — mas nada no deploy os colocava lá. O `preDeployCommand`
 * roda só `prisma migrate deploy`, que cria tabela e não popula dado; o
 * resultado foi produção com as três combos da Etapa 1 vazias e o formulário
 * público intransponível (FIX #284).
 *
 * Chamar `prisma/seed.ts` no deploy não resolveria, por dois motivos:
 *
 * 1. **Não roda na imagem de produção.** O `Dockerfile` reinstala com `--prod`,
 *    então `ts-node` não existe no runtime. Daí este arquivo ser `.mjs` puro:
 *    o `node` do runtime executa direto, sem passo de build. O `tsconfig` da api
 *    compila só `src/**`, então `prisma/` nunca teria saída em `dist/`.
 * 2. **Faria mais do que se pede.** O `main()` do `seed.ts` também aplica
 *    catálogo de serviços, templates de contrato e licenciamento aos tenants
 *    JÁ existentes — inclusive devolvendo item de catálogo que o dono apagou.
 *    Aceitável no dev; em produção, a cada deploy, seria dado do cliente
 *    voltando sozinho.
 *
 * Deste arquivo sai **só o que é de referência**: tabelas globais, sem
 * `tenant_id`, sem RLS, iguais para todo mundo. Reexecutar é seguro por
 * construção — é o que permite pendurá-lo no `preDeployCommand`.
 *
 * `seed.ts` importa daqui; não há segunda cópia das listas para divergir.
 */

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Segmentos derivados das seções CNAE 2.3 do IBGE, com rótulo em linguagem de
 * cliente — quem responde o briefing não conhece "Seção J". O `code` é a seção
 * original, para rastrear a origem e permitir refinar depois sem perder o de-para.
 */
export const SEGMENTS = [
  { code: 'A', label: 'Agropecuária' },
  { code: 'B', label: 'Indústria extrativa' },
  { code: 'C', label: 'Indústria de transformação' },
  { code: 'F', label: 'Construção' },
  { code: 'G', label: 'Comércio e varejo' },
  { code: 'H', label: 'Transporte e logística' },
  { code: 'I', label: 'Alimentação e hospedagem' },
  { code: 'J', label: 'Tecnologia, mídia e comunicação' },
  { code: 'K', label: 'Serviços financeiros e seguros' },
  { code: 'L', label: 'Imobiliário' },
  { code: 'M', label: 'Serviços profissionais e técnicos' },
  { code: 'N', label: 'Serviços administrativos' },
  { code: 'P', label: 'Educação' },
  { code: 'Q', label: 'Saúde e bem-estar' },
  { code: 'R', label: 'Arte, cultura, esporte e lazer' },
  { code: 'S', label: 'Serviços pessoais' },
];

/**
 * Estados e cidades do IBGE. Idempotente por chave natural (`code` da UF,
 * `ibgeId` do município) — reseed atualiza nome, não duplica linha.
 *
 * O arquivo é versionado, nunca a API do IBGE em runtime: o formulário público
 * ficaria refém de um terceiro no caminho do cliente. Atualizar a lista é
 * reseed (manutenção), não request.
 */
export async function seedLocalidades(prisma) {
  const file = join(__dirname, 'data', 'ibge-localidades.json');
  const data = JSON.parse(readFileSync(file, 'utf8'));

  const stateIdByCode = new Map();
  for (const s of data.states) {
    const row = await prisma.state.upsert({
      where: { code: s.code },
      update: { name: s.name },
      create: { code: s.code, name: s.name },
    });
    stateIdByCode.set(s.code, row.id);
  }

  // 5.5k linhas: `createMany` + `skipDuplicates` em lotes, senão são 5.5k
  // round-trips. `updateMany` de nome não é necessário — município não é
  // renomeado com frequência, e reseed com lista nova insere o que faltar.
  const BATCH = 500;
  for (let i = 0; i < data.cities.length; i += BATCH) {
    const batch = data.cities.slice(i, i + BATCH).map((c) => ({
      ibgeId: c.ibgeId,
      name: c.name,
      stateId: stateIdByCode.get(c.state),
    }));
    await prisma.city.createMany({ data: batch, skipDuplicates: true });
  }

  console.log(
    `Localidades seed: ${data.states.length} estados, ${data.cities.length} cidades (${data.source}, ${data.fetchedAt})`,
  );
}

export async function seedSegments(prisma) {
  for (const s of SEGMENTS) {
    await prisma.segment.upsert({
      where: { code: s.code },
      update: { label: s.label },
      create: s,
    });
  }
  console.log(`Segment seed: ${SEGMENTS.length} segmentos (CNAE 2.3, seções)`);
}

export async function seedReference(prisma) {
  await seedLocalidades(prisma);
  await seedSegments(prisma);
}
