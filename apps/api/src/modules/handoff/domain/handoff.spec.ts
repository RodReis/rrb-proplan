import { CanonicalModel } from '../../canonical/domain/canonical-model';
import { ConfidenceSignals } from '../../canonical/domain/confidence';
import {
  assembleHandoff,
  AssembleInput,
  renderHandoffMarkdown,
} from './handoff';

const math = (over: Partial<ConfidenceSignals> = {}): ConfidenceSignals => ({
  stalenessDays: 0,
  cobertura: 1,
  contradicao: 0,
  drift: 0,
  ...over,
});

const present = (value: unknown, ref: unknown, confidence = 0.9) => ({
  refused: false as const,
  value,
  provenance: 'fato' as const,
  provenanceRef: ref,
  confidence,
  math: math(),
});

const refused = () => ({
  refused: true as const,
  reason: 'ausente ou defasado',
  missing: { path: 'docs/ARCHITECTURE.md' },
  confidence: 0.1,
  math: math({ cobertura: 0.1 }),
});

const baseModel = (): CanonicalModel => ({
  entities: {
    architecture: {
      fields: {
        presence: present('Monolito modular NestJS', {
          path: 'docs/ARCHITECTURE.md',
          sha: 'abc123',
          date: '2026-07-10',
        }),
      },
    },
  },
});

const input = (over: Partial<AssembleInput> = {}): AssembleInput => ({
  model: baseModel(),
  generatedAt: '2026-07-15',
  docsScopeHash: 'hash-fixo',
  nextCard: { number: 51, url: 'https://x/51', title: 'Handoff' },
  backlog: [],
  ...over,
});

describe('assembleHandoff', () => {
  it('traz todos os blocos do MVP2 §6, nenhum omitido mesmo ausente', () => {
    const h = assembleHandoff(input());
    const titles = h.blocks.map((b) => b.title);
    // entidades canônicas ausentes viram bloco de recusa, não somem
    expect(titles).toContain('Projeto + objetivo');
    expect(titles).toContain('Decisões / ADRs');
    expect(titles).toContain('Restrições (o que não mexer)');
    expect(titles).toContain('Backlog + último estado');
    expect(titles).toContain('Próxima ação recomendada');
  });

  it('bloco abaixo do limiar (recusado no canônico) NÃO é omitido', () => {
    const model = baseModel();
    model.entities.decisions = { fields: { presence: refused() } };
    const h = assembleHandoff(input({ model }));
    const dec = h.blocks.find((b) => b.title === 'Decisões / ADRs');
    expect(dec).toBeDefined();
    expect(dec!.body.refused).toBe(true);
  });

  it('próxima ação sem card → recusa honesta, nunca chuta', () => {
    const h = assembleHandoff(input({ nextCard: null }));
    const next = h.blocks.find((b) => b.title === 'Próxima ação recomendada');
    expect(next!.body.refused).toBe(true);
  });

  it('backlog referencia issue por número+URL+título, sem corpo (ADR-017)', () => {
    const h = assembleHandoff(
      input({
        backlog: [
          {
            number: 7,
            url: 'https://github.com/x/7',
            title: 'Fatia 7',
            capturedAt: '2026-07-15',
          },
        ],
      }),
    );
    const bl = h.blocks.find((b) => b.title === 'Backlog + último estado')!;
    expect(bl.refs).toHaveLength(1);
    expect(bl.refs![0]).not.toHaveProperty('body');
    expect(bl.refs![0]).not.toHaveProperty('state');
  });

  it('não muta o modelo de entrada', () => {
    const m = baseModel();
    const snapshot = JSON.stringify(m);
    assembleHandoff(input({ model: m }));
    expect(JSON.stringify(m)).toBe(snapshot);
  });
});

describe('renderHandoffMarkdown', () => {
  it('cabeçalho de validade presente em todo export', () => {
    const md = renderHandoffMarkdown(assembleHandoff(input()));
    expect(md).toContain('docsScopeHash `hash-fixo`');
    expect(md).toContain('estado vivo está no GitHub');
    expect(md).toContain('gerado em 2026-07-15');
  });

  it('determinístico: mesmo input → bytes idênticos', () => {
    const a = renderHandoffMarkdown(assembleHandoff(input()));
    const b = renderHandoffMarkdown(assembleHandoff(input()));
    expect(a).toBe(b);
  });

  it('bloco recusado vira seção "não sei", nunca some do markdown', () => {
    const md = renderHandoffMarkdown(assembleHandoff(input({ nextCard: null })));
    expect(md).toContain('## Próxima ação recomendada');
    expect(md).toContain('não sei — ausente/defasado');
  });

  it('a marca a-revalidar da constraint (Fatia 10) nunca é omitida', () => {
    const model = baseModel();
    model.entities.constraints = {
      fields: {
        'nao-clonar-repo': present(
          { statement: 'Nunca clonar repositórios', paths: ['docs/ARCHITECTURE.md'] },
          { status: 'a-revalidar', date: '2026-07-01', sha: 'def456', paths: [] },
        ),
      },
    };
    const md = renderHandoffMarkdown(assembleHandoff(input({ model })));
    expect(md).toContain('Nunca clonar repositórios');
    expect(md).toContain('marca: a-revalidar');
  });

  it('sha vai ao rodapé de proveniência, não polui o corpo do bloco', () => {
    const md = renderHandoffMarkdown(assembleHandoff(input()));
    expect(md).toContain('### Proveniência (auditoria)');
    expect(md).toContain('sha `abc123`');
    // corpo do bloco arquitetura não imprime o sha inline
    const arqBody = md.split('## Arquitetura + módulos')[1].split('##')[0];
    expect(arqBody).not.toContain('abc123');
  });
});
