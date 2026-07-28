import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PrismaClient } from '@prisma/client';
import { CONTRACT_TEMPLATE_SEEDS } from './contract-templates.seed';

/**
 * Seed de dados de desenvolvimento (CLAUDE.md: sem hardcode/mock — dado local
 * entra por aqui). Idempotente: rodar de novo não duplica.
 *
 * `ModelPrice` (SPEC-009): preço por 1M tokens, em USD. Fonte anotada no campo
 * `source`. OpenRouter não precisa de preço (usa costSource: provider), mas
 * seedamos por completude. Cache write da OpenAI = 0 (não cobra).
 *
 * Localidades e segmentos (SPEC-031 §3): dado de REFERÊNCIA, não de dev — vale
 * em produção também. Vem de arquivo versionado, nunca da API do IBGE em
 * runtime: o formulário público ficaria refém de um terceiro no caminho do
 * cliente. Atualizar a lista é reseed (manutenção), não request.
 */
const prisma = new PrismaClient();

const EPOCH = new Date('2026-01-01T00:00:00Z'); // effectiveFrom fixo (idempotência)

const PRICES = [
  {
    provider: 'anthropic',
    model: 'claude-sonnet-5',
    inputPer1M: '3',
    outputPer1M: '15',
    cacheWritePer1M: '3.75',
    cacheReadPer1M: '0.30',
    source: 'anthropic.com/pricing (Sonnet — 2026-07)',
  },
  {
    provider: 'openai',
    model: 'gpt-4o',
    inputPer1M: '2.50',
    outputPer1M: '10',
    cacheWritePer1M: '0', // OpenAI não cobra cache write
    cacheReadPer1M: '1.25',
    source: 'openai.com/pricing (gpt-4o — 2026-07)',
  },
];

/**
 * Segmentos derivados das seções CNAE 2.3 do IBGE, com rótulo em linguagem de
 * cliente — quem responde o briefing não conhece "Seção J". O `code` é a seção
 * original, para rastrear a origem e permitir refinar depois sem perder o de-para.
 */
const SEGMENTS = [
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

type Localidades = {
  source: string;
  fetchedAt: string;
  states: Array<{ code: string; name: string }>;
  cities: Array<{ ibgeId: number; name: string; state: string }>;
};

/**
 * Estados e cidades do IBGE. Idempotente por chave natural (`code` da UF,
 * `ibgeId` do município) — reseed atualiza nome, não duplica linha.
 */
async function seedLocalidades() {
  const file = join(__dirname, 'data', 'ibge-localidades.json');
  const data = JSON.parse(readFileSync(file, 'utf8')) as Localidades;

  const stateIdByCode = new Map<string, string>();
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
      stateId: stateIdByCode.get(c.state) as string,
    }));
    await prisma.city.createMany({ data: batch, skipDuplicates: true });
  }

  console.log(
    `Localidades seed: ${data.states.length} estados, ${data.cities.length} cidades (${data.source}, ${data.fetchedAt})`,
  );
}

/**
 * Catálogo padrão de produtos/serviços por segmento (SPEC-031 §3). É o ponto
 * de partida do tenant, NÃO uma lista fechada: o workspace edita, e o cliente
 * ainda pode digitar item livre (que fica só na resposta, sem virar linha aqui).
 *
 * Só os segmentos com serviço de software plausível têm lista — para os demais
 * o cliente digita livre. Ausência é informação (ADR-014): inventar item para
 * todo segmento encheria a tela de ruído.
 */
const SERVICE_CATALOG: Record<string, string[]> = {
  G: ['Loja virtual', 'Catálogo de produtos online', 'Integração com marketplace'],
  I: ['Cardápio digital', 'Reserva de mesa online', 'Pedido e delivery próprio'],
  J: ['Site institucional', 'Landing page de campanha', 'Blog e conteúdo', 'Sistema web interno'],
  K: ['Portal do cliente', 'Simulador de contratação'],
  L: ['Portal de imóveis', 'Agendamento de visita'],
  M: ['Site institucional', 'Portal do cliente', 'Agendamento de consultoria'],
  P: ['Portal do aluno', 'Área de cursos online', 'Matrícula online'],
  Q: ['Agendamento de consulta', 'Portal do paciente', 'Site da clínica'],
  R: ['Venda de ingressos', 'Site de eventos'],
  S: ['Agendamento de horário', 'Site institucional'],
};

/**
 * Aplica o catálogo padrão aos tenants JÁ existentes. Idempotente pelo unique
 * (tenant_id, segment, label): reseed não duplica, e item que o dono apagou
 * volta — é seed de dado de partida, não sincronização.
 *
 * Tenant NOVO recebe o catálogo no provisionamento (fatia que expõe a rota do
 * catálogo); aqui é só o retrofit de quem já existe.
 */
async function seedServiceCatalog() {
  const tenants = await prisma.tenant.findMany({ select: { id: true } });
  let created = 0;

  for (const tenant of tenants) {
    // `service_catalog_items` tem RLS com FORCE: sem `app.tenant_ids` no
    // contexto a policy barra até o OWNER (é o ponto do FORCE). O seed abre o
    // contexto do tenant, mesma mecânica do `PrismaService.withTenant`.
    created += await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.tenant_ids', ${`{${tenant.id}}`}, true)`;

      let count = 0;
      for (const [segment, labels] of Object.entries(SERVICE_CATALOG)) {
        const result = await tx.serviceCatalogItem.createMany({
          data: labels.map((label) => ({ tenantId: tenant.id, segment, label })),
          skipDuplicates: true,
        });
        count += result.count;
      }
      return count;
    });
  }

  console.log(
    `ServiceCatalogItem seed: ${created} itens novos em ${tenants.length} tenant(s)`,
  );
}

/**
 * Templates-exemplo de contrato, um por modalidade (SPEC-034 §2.3).
 *
 * Nasce com `isSeedExample = true`, e é isto que a trava do §7.3 consulta: o 1º
 * contrato de uma modalidade exige uma versão salva pelo prestador. O seed
 * existe para a fatia ser utilizável no dia 1, não para ser assinado como veio.
 *
 * Idempotente pelo unique `(tenant_id, modality)`: reseed não duplica. E
 * **nunca sobrescreve** — se o template já existe, o seed não o toca, porque
 * ele pode já ter versões escritas pelo dono, e reescrever o corpo apagaria
 * texto jurídico que alguém revisou.
 */
async function seedContractTemplates() {
  const tenants = await prisma.tenant.findMany({ select: { id: true } });
  let created = 0;

  for (const tenant of tenants) {
    // RLS com FORCE: sem `app.tenant_ids` a policy barra até o OWNER. Mesma
    // mecânica do `PrismaService.withTenant`.
    created += await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.tenant_ids', ${`{${tenant.id}}`}, true)`;

      let count = 0;
      for (const { modality, body } of CONTRACT_TEMPLATE_SEEDS) {
        const existente = await tx.contractTemplate.findUnique({
          where: { tenantId_modality: { tenantId: tenant.id, modality } },
          select: { id: true },
        });
        if (existente) continue;

        // Template e 1ª versão na MESMA transação: `current_version_id` é
        // nullable só nesta janela, e um template sem versão corrente seria um
        // registro que a tela mostra e a emissão não consegue usar.
        const template = await tx.contractTemplate.create({
          data: { tenantId: tenant.id, modality, isSeedExample: true },
        });
        const versao = await tx.contractTemplateVersion.create({
          data: { templateId: template.id, version: 1, body },
        });
        await tx.contractTemplate.update({
          where: { id: template.id },
          data: { currentVersionId: versao.id },
        });
        count += 1;
      }
      return count;
    });
  }

  console.log(
    `ContractTemplate seed: ${created} templates novos em ${tenants.length} tenant(s)`,
  );
}

async function seedSegments() {
  for (const s of SEGMENTS) {
    await prisma.segment.upsert({
      where: { code: s.code },
      update: { label: s.label },
      create: s,
    });
  }
  console.log(`Segment seed: ${SEGMENTS.length} segmentos (CNAE 2.3, seções)`);
}

async function main() {
  await seedLocalidades();
  await seedSegments();
  await seedServiceCatalog();
  await seedContractTemplates();

  for (const p of PRICES) {
    await prisma.modelPrice.upsert({
      where: {
        provider_model_effectiveFrom: {
          provider: p.provider,
          model: p.model,
          effectiveFrom: EPOCH,
        },
      },
      update: {
        inputPer1M: p.inputPer1M,
        outputPer1M: p.outputPer1M,
        cacheWritePer1M: p.cacheWritePer1M,
        cacheReadPer1M: p.cacheReadPer1M,
        source: p.source,
      },
      create: { ...p, effectiveFrom: EPOCH },
    });
    console.log(`ModelPrice seed: ${p.provider}/${p.model}`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
