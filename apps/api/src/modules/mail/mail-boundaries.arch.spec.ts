import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * As fronteiras do módulo `mail` (SPEC-038), provadas por varredura estática —
 * o instrumento da casa (`licensing-boundaries`, `contracts-boundaries`,
 * `tenant-scope`). É o critério de aceite *"arch-spec de fronteira mantida
 * (`licensing` usa `mail` pelo service público)"*.
 *
 * Por que varredura e não confiança no `@Module`: o `exports` do Nest resolve
 * **injeção**, não resolve o import de TypeScript (ADR-027). E `PrismaService`
 * é global — nada impediria o `licensing` de fazer `prisma.mailDelivery.create`
 * direto, pulando a fila. Funcionaria hoje, e a fronteira teria desmanchado em
 * silêncio.
 *
 * Três regras, cada uma protegendo uma decisão:
 *
 * 1. **O `mail` não conhece licença.** Ele nasce nesta fatia porque a venda
 *    precisa dele, mas a interface é `send({ to, template, data })`. Um import
 *    de `licensing` aqui tornaria compartilhado só no nome.
 * 2. **Quem escreve em `mail_deliveries` é o `mail`.** Escrever de fora pularia
 *    a fila — e um registro de envio sem job é um e-mail que nunca sai, com
 *    linha no banco dizendo que saiu.
 * 3. **A chave em claro não vaza para log nem para o banco.** É a garantia da
 *    SPEC-036 atravessando este módulo, que é justamente por onde a chave passa.
 */

const RAIZ = join(__dirname);
const MODULOS = join(__dirname, '..');

/** Todos os `.ts` de um módulo, menos os próprios testes. */
function arquivos(dir: string): string[] {
  const out: string[] = [];
  for (const entrada of readdirSync(dir)) {
    const caminho = join(dir, entrada);
    if (statSync(caminho).isDirectory()) {
      out.push(...arquivos(caminho));
      continue;
    }
    if (!entrada.endsWith('.ts')) continue;
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

function varrer(padrao: RegExp, dir: string = RAIZ): Ocorrencia[] {
  const achados: Ocorrencia[] = [];
  for (const arquivo of arquivos(dir)) {
    const linhas = readFileSync(arquivo, 'utf8').split('\n');
    linhas.forEach((texto, i) => {
      // Comentário não é código: a regra é sobre o que executa, e os arquivos
      // deste módulo explicam a fronteira em prosa — citando os nomes que a
      // varredura procura.
      const semComentario = texto.replace(/\/\/.*$/, '').replace(/^\s*\*.*$/, '');
      if (padrao.test(semComentario)) {
        achados.push({
          arquivo: arquivo.replace(MODULOS, '').replace(/\\/g, '/'),
          linha: i + 1,
          texto: texto.trim(),
        });
      }
    });
  }
  return achados;
}

describe('mail: a varredura enxerga o módulo', () => {
  it('acha os arquivos — senão os testes abaixo passariam vazios', () => {
    // Sem esta âncora, um erro no caminho transformaria tudo em "nenhum
    // arquivo, logo nenhuma violação": verde e sem valor nenhum.
    expect(arquivos(RAIZ).length).toBeGreaterThanOrEqual(5);
  });
});

describe('mail: compartilhado de verdade, não só no nome', () => {
  it('não importa nenhum módulo-irmão', () => {
    // Nem `licensing`, nem `clients`, nem `identity`. Ele não tem controller e
    // não tem guard: quem o consome traz o `tenantId` na chamada.
    //
    // A regex mira os IRMÃOS (`../../<modulo>/` a partir de qualquer
    // profundidade), não tudo que sobe um nível: `../domain/` e
    // `../application/` são o PRÓPRIO módulo, e `../../prisma/` é
    // infraestrutura compartilhada — proibi-los diria que este módulo não pode
    // falar consigo mesmo nem com o banco.
    expect(
      varrer(
        /from '(?:\.\.\/)+modules\/[a-z-]+\/|from '\.\.\/\.\.\/(?!prisma\/|shared\/)[a-z-]+\//,
      ),
    ).toEqual([]);
  });

  it('a assinatura pública não menciona licença', () => {
    // `SendInput` tem `licenseId?` — uma coluna opcional para o painel da
    // SPEC-040 — mas nada do DOMÍNIO de licenciamento entra aqui: nem edição,
    // nem chave, nem status. O `data` é `Record<string, unknown>` de propósito.
    const service = readFileSync(
      join(RAIZ, 'application', 'mail.service.ts'),
      'utf8',
    );
    const semComentarios = service.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    expect(semComentarios).not.toMatch(/LicenseStatus|LicEdition|licenseKey:/);
  });

  it('não lê nem escreve nas tabelas de outra frente', () => {
    const acessos = varrer(
      /prisma\.(license|licEdition|licProduct|licEvent|client|clientProject|contract|briefingLink)\b/,
    );
    expect(acessos).toEqual([]);
  });
});

describe('mail: quem escreve em `mail_deliveries` é o `mail`', () => {
  it('nenhum outro módulo toca a tabela', () => {
    // Escrever de fora pularia a fila: um registro de envio sem job é um
    // e-mail que nunca sai, com linha no banco dizendo que saiu. A leitura
    // também mora aqui (`MailService.list`), servida ao admin pelo controller
    // de quem tem a tela.
    const forasteiros: Ocorrencia[] = [];
    for (const modulo of readdirSync(MODULOS)) {
      if (modulo === 'mail') continue;
      const dir = join(MODULOS, modulo);
      if (!statSync(dir).isDirectory()) continue;
      forasteiros.push(...varrer(/prisma\.mailDelivery\b/, dir));
    }
    expect(forasteiros).toEqual([]);
  });
});

describe('mail: a chave em claro não fica para trás', () => {
  it('nenhum logger recebe o corpo, a chave ou o destinatário', () => {
    // Três vazamentos pelo mesmo caminho: a chave (garantia da SPEC-036), o
    // corpo (que a contém) e o e-mail do comprador (dado pessoal, que já tem
    // lugar no banco sob RLS).
    expect(varrer(/logger\.(log|warn|error|debug)\([^)]*\b(html|text|licenseKey|to)\b/)).toEqual(
      [],
    );
  });

  it('o corpo renderizado não é gravado no banco', () => {
    // A `MailDelivery` guarda `template` e `subject`, nunca `html`/`text`.
    // Guardar o corpo do `license_key` seria guardar a chave por outro nome —
    // e é por isso que reenviar não reenvia a chave.
    const service = readFileSync(join(RAIZ, 'application', 'mail.service.ts'), 'utf8');
    const worker = readFileSync(
      join(RAIZ, 'infrastructure', 'mail.worker.ts'),
      'utf8',
    );
    const semComentarios = (f: string) =>
      f.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

    for (const fonte of [semComentarios(service), semComentarios(worker)]) {
      // `html:` e `text:` só podem aparecer como argumento do provedor, nunca
      // dentro de um `data:` de escrita do Prisma.
      const escritas = fonte.match(/data:\s*\{[^}]*\b(html|text)\b/gs);
      expect(escritas).toBeNull();
    }
  });

  it('nenhuma coluna de `MailDelivery` guarda corpo', () => {
    // O schema é a fonte: se `html` ou `body` aparecer como campo, o corpo
    // passou a ter onde morar.
    const schema = readFileSync(
      join(RAIZ, '..', '..', '..', 'prisma', 'schema.prisma'),
      'utf8',
    );
    const modelo = schema.slice(
      schema.indexOf('model MailDelivery {'),
      schema.indexOf('model LicSettings {'),
    );
    expect(modelo).toMatch(/template\s+String/);
    expect(modelo).not.toMatch(/^\s{2}(html|body|text)\s+String/m);
  });
});
