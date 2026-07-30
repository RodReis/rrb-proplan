import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * As fronteiras do módulo `licensing` (SPEC-036), provadas por varredura
 * estática — o instrumento da casa (`contracts-boundaries`, `tenant-scope`,
 * `llm-public-surface`). É o critério de aceite *"arch-spec de fronteira do
 * módulo"* da fatia.
 *
 * Por que varredura e não confiança no `@Module`: o `exports` do Nest resolve
 * **injeção**, não resolve o import de TypeScript (ADR-027). E `PrismaService`
 * é global — nada impediria o `licensing` de fazer `prisma.client.update` ou
 * `prisma.contract.create` direto. Funcionaria hoje, e a fronteira teria
 * desmanchado em silêncio.
 *
 * Três regras, e cada uma protege uma decisão diferente:
 *
 * 1. **Frente disjunta** (MVP4 §3, mesmo princípio dos ADR-023/024). Um produto
 *    licenciado não é um cliente; a licença de um binário não é o contrato de
 *    prestação. A costura com o catálogo é uma **coluna** (`projectId?`), não
 *    uma dependência de módulo.
 * 2. **A chave privada tem um dono só.** A afirmação "a privada não sai do
 *    servidor" só é verificável se houver um ponto único que a lê.
 * 3. **A chave em claro não é persistida.** É a garantia central da fatia, e a
 *    forma de quebrá-la é acrescentar uma coluna ou um campo de log.
 */

const RAIZ = join(__dirname);

/** Todos os `.ts` do módulo, menos os próprios testes. */
function arquivosDoModulo(dir: string = RAIZ): string[] {
  const out: string[] = [];
  for (const entrada of readdirSync(dir)) {
    const caminho = join(dir, entrada);
    if (statSync(caminho).isDirectory()) {
      out.push(...arquivosDoModulo(caminho));
      continue;
    }
    if (!entrada.endsWith('.ts')) continue;
    // `.int-spec.ts` também é teste, e o filtro do `contracts` não precisava
    // dele porque aquele módulo não tem nenhum. Sem esta linha, o int-spec do
    // `/activate` entra na varredura e reprova regras que ele exercita de
    // propósito (importar `PrismaService`, nomear a chave de assinatura).
    if (entrada.endsWith('.spec.ts') || entrada.endsWith('.int-spec.ts')) continue;
    out.push(caminho);
  }
  return out;
}

interface Ocorrencia {
  arquivo: string;
  linha: number;
  texto: string;
}

function varrer(padrao: RegExp): Ocorrencia[] {
  const achados: Ocorrencia[] = [];
  for (const arquivo of arquivosDoModulo()) {
    const linhas = readFileSync(arquivo, 'utf8').split('\n');
    linhas.forEach((texto, i) => {
      // Comentário não é código: a regra é sobre o que executa, e os arquivos
      // deste módulo explicam a fronteira em prosa — incluindo os nomes que a
      // varredura procura.
      const semComentario = texto.replace(/\/\/.*$/, '').replace(/^\s*\*.*$/, '');
      if (padrao.test(semComentario)) {
        achados.push({
          arquivo: arquivo.replace(RAIZ, '').replace(/\\/g, '/'),
          linha: i + 1,
          texto: texto.trim(),
        });
      }
    });
  }
  return achados;
}

const ESCRITAS = '(create|update|upsert|delete|createMany|updateMany|deleteMany)';

/**
 * Tira comentários de bloco e de linha. As regras deste arquivo são sobre o que
 * **executa**; os arquivos do módulo explicam as decisões em prosa, e essa
 * prosa cita os nomes que a varredura procura.
 */
function semComentarios(fonte: string): string {
  return fonte.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}

describe('licensing: a varredura enxerga o módulo', () => {
  it('acha os arquivos — senão os testes abaixo passariam vazios', () => {
    // Sem esta âncora, um erro no caminho transformaria tudo em "nenhum
    // arquivo, logo nenhuma violação": verde e sem valor nenhum.
    expect(arquivosDoModulo().length).toBeGreaterThanOrEqual(7);
  });
});

describe('licensing: frente disjunta das outras duas (MVP4 §3)', () => {
  it('não importa módulo de domínio além do `identity` e do `mail`', () => {
    // `identity` dá os guards. `mail` é a exceção da SPEC-038 — e ela é
    // infraestrutura compartilhada, não uma frente: a assinatura é
    // `send({ to, template, data })` e não menciona licença. O arch-spec do
    // `mail` prova o outro lado (ele não conhece licenciamento), e o consumo
    // aqui é pelo **service público**: escrever em `mail_deliveries` direto
    // pularia a fila, e o arch-spec de lá barra isso.
    //
    // Qualquer OUTRO import de módulo-irmão seria o licenciamento passando a
    // depender de uma frente que ele não conhece.
    //
    // A regex mira os IRMÃOS (`../<modulo>/` a partir de qualquer profundidade
    // dentro do módulo), não tudo que sobe um nível: `../../prisma/` e
    // `../../../shared/` são infraestrutura compartilhada, e proibi-los diria
    // que este módulo não pode falar com o banco.
    const imports = varrer(
      /from '(?:\.\.\/)+modules\/(?!identity\/|mail\/)[a-z-]+\/|from '\.\.\/\.\.\/(?!identity\/|mail\/|prisma\/|shared\/)[a-z-]+\//,
    );
    expect(imports).toEqual([]);
  });

  it('usa o `mail` pelo service público, nunca escrevendo na tabela dele', () => {
    // O critério de aceite da SPEC-038 em uma linha. `PrismaService` é global:
    // nada impediria um `prisma.mailDelivery.create` aqui, que funcionaria hoje
    // e pularia a fila — registro de envio sem job é um e-mail que nunca sai,
    // com linha no banco dizendo que saiu.
    expect(varrer(/prisma\.mailDelivery\b/)).toEqual([]);
  });

  it('não lê nem escreve nas tabelas da Frente Clientes', () => {
    const acessos = varrer(
      /prisma\.(client|clientProject|clientStatusTransition|briefingLink|briefingVersion|estimate|contract|artifact)\b/,
    );
    expect(acessos).toEqual([]);
  });

  it('não move card de funil', () => {
    // Nem gravando a trilha direto, nem pedindo a transição: vender uma licença
    // não é um passo do funil de prestação de serviço.
    expect(varrer(/\.transition\(/)).toEqual([]);
    expect(varrer(new RegExp(`prisma\\.clientStatusTransition\\.${ESCRITAS}`))).toEqual([]);
  });

  it('não escreve em `projects` — a costura com o catálogo é só leitura', () => {
    // `LicProduct.projectId` aponta para o repo quando ele existe; o dono
    // daquela tabela é o `catalog`.
    expect(varrer(new RegExp(`prisma\\.project\\.${ESCRITAS}`))).toEqual([]);
  });

  it('nada de IA nesta fatia', () => {
    // Emitir e ativar licença é aritmética e criptografia. Um import de LLM
    // aqui seria o ADR-012 sendo furado por engano.
    //
    // **Decide por SEGMENTO do especificador, não por substring.** A versão
    // anterior era `/(llm|anthropic|openai)/i` sobre a linha inteira, e
    // `bu(llm)q` contém `llm`: quando a fila do webhook entrou (SPEC-038), ela
    // reprovou 27 imports de `@nestjs/bullmq`. Um arch-spec que grita por
    // engano é um arch-spec que alguém desliga — e aí ele para de proteger a
    // regra de verdade.
    //
    // Cobre as três formas de importar IA: caminho relativo (`../llm`), pacote
    // nu (`openai`) e escopo npm (`@anthropic-ai/sdk`). Não cobre — e não deve
    // — arquivo cujo NOME contém o termo (`./llm-usage.recorder`), que é código
    // do próprio módulo `llm` e não um import dele.
    const proibidos = arquivosDoModulo().flatMap((arquivo) => {
      const linhas = readFileSync(arquivo, 'utf8').split('\n');
      return linhas.flatMap((texto, i) => {
        const semComentario = texto.replace(/\/\/.*$/, '').replace(/^\s*\*.*$/, '');
        const especificador = /from '([^']+)'/.exec(semComentario)?.[1];
        if (!especificador) return [];
        const suspeito = especificador
          .toLowerCase()
          .split('/')
          .some((segmento) => /^@?(llm|anthropic|openai)(-ai)?$/.test(segmento));
        return suspeito
          ? [{ arquivo: arquivo.replace(RAIZ, '').replace(/\\/g, '/'), linha: i + 1 }]
          : [];
      });
    });
    expect(proibidos).toEqual([]);
  });
});

describe('licensing: a chave privada tem um dono só', () => {
  it('`LICENSING_SIGNING_KEY` é lida em UM arquivo', () => {
    // A afirmação "a privada não sai do servidor" só é verificável se houver um
    // ponto único que a lê. Se um segundo arquivo passar a lê-la, esta lista
    // cresce e o teste cai — a decisão aparece no diff.
    //
    // `process.env.` na regex: o nome da variável aparece em prosa e em
    // mensagem de log noutros pontos, e nenhum dos dois é uma LEITURA dela.
    const leituras = varrer(/process\.env\.LICENSING_SIGNING_KEY/);
    expect([...new Set(leituras.map((o) => o.arquivo))]).toEqual([
      '/application/license-signing.service.ts',
    ]);
  });

  it('só o `domain/license-file` toca a primitiva de assinatura', () => {
    // `createPrivateKey` e o `sign` do `node:crypto` moram num arquivo só. O
    // service é quem tem a CHAVE; o domain é quem sabe assinar. Separados, e
    // nenhum terceiro arquivo faz nem uma coisa nem outra.
    const usos = varrer(/\bcreatePrivateKey\(|[^a-zA-Z]sign\(null/);
    expect([...new Set(usos.map((o) => o.arquivo))]).toEqual([
      '/domain/license-file.ts',
    ]);
  });
});

describe('licensing: a chave em claro não é persistida', () => {
  it('nenhuma coluna do Prisma se chama `key`', () => {
    // A forma de quebrar a garantia central é uma coluna nova. O schema é a
    // fonte: se `key` (não `keyHash`) aparecer como campo de `License`, a
    // chave em claro passou a ter onde morar.
    const schema = readFileSync(
      join(RAIZ, '..', '..', '..', 'prisma', 'schema.prisma'),
      'utf8',
    );
    const modeloLicense = schema.slice(
      schema.indexOf('model License {'),
      schema.indexOf('model Activation {'),
    );
    expect(modeloLicense).toMatch(/keyHash\s+String/);
    expect(modeloLicense).not.toMatch(/^\s{2}key\s+String/m);
  });

  it('nenhum logger recebe a chave', () => {
    // O log é o segundo caminho de fuga: `logger.log(\`chave ${key}\`)`
    // persistiria o segredo num arquivo que ninguém trata como banco.
    const logs = varrer(/logger\.(log|warn|error|debug)\([^)]*\bkey\b/);
    expect(logs).toEqual([]);
  });
});

describe('licensing: a rota pública é separada da protegida', () => {
  it('o controller público não tem guard nenhum', () => {
    const publico = readFileSync(
      join(RAIZ, 'presentation', 'licensing-public.controller.ts'),
      'utf8',
    );
    // Um `@UseGuards` aqui exigiria sessão de quem não tem conta: toda ativação
    // passaria a falhar com 401. O interceptor de tenant tem o mesmo efeito —
    // ele deriva o tenant da sessão, que aqui não existe.
    //
    // `semComentarios`: os dois nomes aparecem na prosa do arquivo, explicando
    // justamente por que NÃO estão lá. Buscar no texto cru reprovaria a
    // documentação da decisão.
    expect(semComentarios(publico)).not.toMatch(/@UseGuards/);
    expect(semComentarios(publico)).not.toMatch(/TenantContextInterceptor/);
  });

  it('o controller admin tem os três', () => {
    const admin = readFileSync(
      join(RAIZ, 'presentation', 'licensing-admin.controller.ts'),
      'utf8',
    );
    // O espelho do teste acima: perder qualquer um deles abriria o admin de um
    // tenant para quem não é membro dele.
    expect(admin).toMatch(/JwtAuthGuard/);
    expect(admin).toMatch(/TenantGuard/);
    expect(admin).toMatch(/TenantContextInterceptor/);
  });

  it('a escrita sem sessão passa por `runInTenantContext`', () => {
    // Sem ele o RLS é fail-closed e o `create` grava ZERO LINHAS sem erro — a
    // rota devolveria 200 com um license file para uma ativação que não
    // existe. É a classe de bug que já custou 5 ocorrências nesta base.
    const ativacao = readFileSync(
      join(RAIZ, 'application', 'license-activation.service.ts'),
      'utf8',
    );
    expect(ativacao).toMatch(/runInTenantContext/);
    // E nunca um bypass genérico de RLS (ADR-020) — no código, não na prosa que
    // explica por que ele é proibido.
    expect(semComentarios(ativacao)).not.toMatch(/bypass/i);
  });
});

describe('licensing: métricas saem por um service público (SPEC-040)', () => {
  it('o `licensing-summary.service.ts` existe — a promessa do MVP4 §3 cumprida', () => {
    // O `licensing.module.ts` prometia este arquivo desde a Fatia 25: *"se um
    // compositor quiser métricas daqui, o módulo exporta um
    // licensing-summary.service.ts"*. Enquanto ele não existia, a promessa era
    // prosa; agora é o ponto único por onde número de licenciamento sai.
    const caminho = join(RAIZ, 'application', 'licensing-summary.service.ts');
    expect(statSync(caminho).isFile()).toBe(true);
  });

  it('o módulo EXPORTA o service de métrica', () => {
    // Exportado antes de haver consumidor, de propósito. Sem isso, o primeiro
    // compositor que precisasse de um número leria `PrismaService` direto (ele
    // é global) e a fronteira desmancharia em silêncio — nenhum `@Module`
    // reclamaria, que é exatamente o buraco que o ADR-027 nomeia.
    const modulo = semComentarios(
      readFileSync(join(RAIZ, 'licensing.module.ts'), 'utf8'),
    );
    expect(modulo).toMatch(/exports:\s*\[[^\]]*LicensingSummaryService/);
  });

  it('a métrica não lê `payload` — contagem é sobre coluna tipada', () => {
    // Contar sobre o JSON bruto faria a métrica depender do formato que a
    // plataforma manda, e mudá-lo do lado dela quebraria a contagem em
    // silêncio. É também o que garante que a anonimização (que reduz o
    // payload a uma allowlist) não altere número nenhum.
    const summary = semComentarios(
      readFileSync(join(RAIZ, 'application', 'licensing-summary.service.ts'), 'utf8'),
    );
    expect(summary).not.toMatch(/payload/);
  });

  it('nenhum nome de dinheiro aparece no service de métrica', () => {
    // Prova por ausência, no código e não só no tipo (mesmo desenho das provas
    // de receita da SPEC-034/035). Preço não é do ProPlan: vive no payload,
    // sem coluna tipada nem moeda normalizada, e um total derivado dali seria
    // plausível e indefensável — o número sem origem que o MVP3 §9 barra.
    const summary = semComentarios(
      readFileSync(join(RAIZ, 'application', 'licensing-summary.service.ts'), 'utf8'),
    );
    expect(summary).not.toMatch(/\b(amount|price|revenue|currency|totalCents|ticket)\b/i);
  });

  it('o `period.ts` é do módulo, não importado do `dashboard`', () => {
    // A regra do período é a mesma dos dois (lista fechada + virada em BRT),
    // mas importar de `dashboard/` criaria a dependência de módulo-irmão que a
    // primeira regra deste arquivo existe para impedir — por um arquivo de 60
    // linhas sem estado. A duplicação é o custo escolhido, e os testes dos dois
    // falham antes de qualquer contagem mentir.
    expect(statSync(join(RAIZ, 'domain', 'period.ts')).isFile()).toBe(true);
    expect(varrer(/from '.*dashboard.*period'/)).toEqual([]);
  });
});
