import { McpToolsService } from './mcp-tools.service';
import { Handoff } from '../../handoff/domain/handoff';

/**
 * Prova o INVARIANTE central da SPEC-016 no nível do adaptador (critério §1 e
 * §2): sem evidência ⇒ recusa, nunca answer; a marca `a-revalidar` de asserção
 * nunca some; nenhuma tool reproduz corpo de issue. Services mockados — o
 * julgamento real é dos domínios de 9/10/5/6, testado lá.
 */

const PROJECT = { id: 'p1', userId: 'u1' };

function makeService(over: {
  handoff?: Partial<Handoff>;
  assertions?: any[];
  board?: any;
  model?: any;
  threshold?: number;
}) {
  const prisma = {
    project: { findFirst: jest.fn().mockResolvedValue(PROJECT) },
  } as any;
  const canonical = {
    getCanonicalModel: jest.fn().mockResolvedValue(over.model ?? { entities: {} }),
  } as any;
  const board = {
    getBoard: jest.fn().mockResolvedValue(
      over.board ?? { mode: 'active', needsIssueImport: false, columns: [] },
    ),
  } as any;
  const handoff = {
    assemble: jest.fn().mockResolvedValue(over.handoff ?? { header: {}, blocks: [] }),
  } as any;
  const context = {
    list: jest.fn().mockResolvedValue(over.assertions ?? []),
  } as any;
  const settings = {
    canonicalThresholdOf: jest.fn().mockResolvedValue(over.threshold ?? 0.4),
  } as any;
  return new McpToolsService(prisma, canonical, board, handoff, context, settings);
}

const presentBlock = {
  key: 'project.presence',
  title: 'Projeto',
  body: {
    refused: false,
    value: 'um painel de gestão',
    provenance: 'fato',
    provenanceRef: { path: 'README.md', sha: 'abc', date: '2026-05-01' },
    confidence: 0.9,
    math: { stalenessDays: 1, cobertura: 1, contradicao: 0, drift: 0 },
  },
};

describe('McpToolsService — contrato de evidência (SPEC-016)', () => {
  it('get_project_state sem blocos presentes → refusal, nunca answer', async () => {
    const svc = makeService({ handoff: { blocks: [] } });
    const r = await svc.getProjectState('o', 'r');
    expect(r.answer).toBeNull();
    expect(r.refusal).not.toBeNull();
  });

  it('get_project_state com bloco presente → answer com evidência', async () => {
    const svc = makeService({ handoff: { blocks: [presentBlock as any] } });
    const r = await svc.getProjectState('o', 'r');
    expect(r.answer).toContain('Projeto');
    expect(r.evidence.length).toBeGreaterThan(0);
    expect(r.refusal).toBeNull();
  });

  it('get_constraints sem asserções → refusal', async () => {
    const svc = makeService({ assertions: [] });
    const r = await svc.getConstraints('o', 'r');
    expect(r.refusal).not.toBeNull();
  });

  it('get_constraints com asserção a-revalidar → marca SEMPRE presente (§2)', async () => {
    const svc = makeService({
      assertions: [
        {
          statement: 'não trocar o auth',
          paths: ['docs/CONTEXT.md'],
          author: 'rodrigo',
          assertedAt: '2026-06-10',
          assertedSha: 'd4e5f6',
          status: 'a-revalidar',
          body: '',
        },
      ],
    });
    const r = await svc.getConstraints('o', 'r');
    expect(r.answer).not.toBeNull();
    expect(r.evidence[0].status).toBe('a-revalidar');
    expect(r.answer).toContain('a-revalidar');
  });

  it('get_next_task não reproduz corpo — referencia número+URL (§3)', async () => {
    const svc = makeService({
      board: {
        mode: 'active',
        needsIssueImport: false,
        columns: [
          {
            column: 'todo',
            cards: [{ number: 42, title: 'fatia X', htmlUrl: 'https://github.com/o/r/issues/42' }],
          },
        ],
      },
      model: {
        entities: {
          project: {
            fields: {
              presence: {
                refused: false,
                value: 'x',
                provenance: 'fato',
                provenanceRef: {},
                confidence: 0.9,
                math: {},
              },
            },
          },
        },
      },
    });
    const r = await svc.getNextTask('o', 'r');
    expect(r.answer).toContain('#42');
    expect(r.answer).toContain('/issues/42');
  });

  it('get_next_task abaixo do limiar → refusal, não chuta', async () => {
    const svc = makeService({
      threshold: 0.8,
      board: {
        mode: 'active',
        needsIssueImport: false,
        columns: [{ column: 'todo', cards: [{ number: 1, title: 't', htmlUrl: 'u' }] }],
      },
      model: {
        entities: {
          project: { fields: { presence: { refused: false, value: 'x', provenance: 'fato', provenanceRef: {}, confidence: 0.3, math: {} } } },
        },
      },
    });
    const r = await svc.getNextTask('o', 'r');
    expect(r.answer).toBeNull();
    expect(r.refusal?.reason).toContain('limiar');
  });

  it('find_blockers sem blocker → refusal (sem evidência)', async () => {
    const svc = makeService({ assertions: [], model: { entities: {} } });
    const r = await svc.findBlockers('o', 'r');
    expect(r.refusal).not.toBeNull();
  });
});
