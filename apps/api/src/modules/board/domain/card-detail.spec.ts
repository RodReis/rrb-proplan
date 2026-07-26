import type {
  GithubIssueDetail,
  GithubTimelineEvent,
} from '../infrastructure/github-issues.client';
import { mapTimeline, toCardDetail } from './card-detail';

function issue(over: Partial<GithubIssueDetail> = {}): GithubIssueDetail {
  return {
    number: 128,
    title: '[SPEC-030] Painel de detalhe do card',
    state: 'open',
    html_url: 'https://github.com/RodReis/rrb-proplan/issues/128',
    body: '## O problema\n\nClicar num card abre um formulário.',
    user: { login: 'RodReis', avatar_url: 'https://avatars/rodreis' },
    assignees: [{ login: 'RodReis', avatar_url: 'https://avatars/rodreis' }],
    labels: [{ name: 'proplan:doing', color: '0e8a16' }],
    created_at: '2026-07-25T20:19:42Z',
    updated_at: '2026-07-26T10:00:00Z',
    closed_at: null,
    ...over,
  };
}

const FETCHED = new Date('2026-07-26T21:00:00Z');

describe('mapTimeline', () => {
  it('mapeia os 8 tipos do contrato e descarta o resto', () => {
    const raw: GithubTimelineEvent[] = [
      { event: 'opened', created_at: '2026-07-25T20:19:42Z' },
      { event: 'commented', created_at: '2026-07-25T20:20:00Z' }, // fora: é conversa
      { event: 'cross-referenced', created_at: '2026-07-25T20:21:00Z' }, // fora
      { event: 'mentioned', created_at: '2026-07-25T20:22:00Z' }, // fora
      { event: 'subscribed', created_at: '2026-07-25T20:23:00Z' }, // fora
      {
        event: 'labeled',
        created_at: '2026-07-25T20:24:00Z',
        label: { name: 'proplan:doing', color: '0e8a16' },
      },
      { event: 'closed', created_at: '2026-07-25T20:25:00Z' },
      { event: 'reopened', created_at: '2026-07-25T20:26:00Z' },
    ];

    expect(mapTimeline(raw).map((e) => e.type)).toEqual([
      'opened',
      'labeled',
      'closed',
      'reopened',
    ]);
  });

  it('carrega ator, label, assignee e rename quando presentes', () => {
    const events = mapTimeline([
      {
        event: 'labeled',
        actor: { login: 'RodReis', avatar_url: 'https://avatars/r' },
        created_at: '2026-07-25T20:00:00Z',
        label: { name: 'prio:alta', color: 'b60205' },
      },
      {
        event: 'assigned',
        created_at: '2026-07-25T20:01:00Z',
        assignee: { login: 'RodReis' },
      },
      {
        event: 'renamed',
        created_at: '2026-07-25T20:02:00Z',
        rename: { from: 'antigo', to: 'novo' },
      },
    ]);

    expect(events[0]).toMatchObject({
      type: 'labeled',
      actor: { login: 'RodReis', avatarUrl: 'https://avatars/r' },
      label: { name: 'prio:alta', color: 'b60205' },
    });
    expect(events[1].assignee).toEqual({ login: 'RodReis' });
    expect(events[2].rename).toEqual({ from: 'antigo', to: 'novo' });
  });

  it('ator ausente vira null — ação do sistema ou conta removida não quebra a trilha', () => {
    const events = mapTimeline([
      { event: 'closed', created_at: '2026-07-25T20:00:00Z', actor: null },
      { event: 'reopened', created_at: '2026-07-25T20:01:00Z' },
    ]);
    expect(events.map((e) => e.actor)).toEqual([null, null]);
  });

  it('descarta evento sem created_at — sem carimbo não há como ordenar nem exibir', () => {
    const events = mapTimeline([
      { event: 'opened' },
      { event: 'closed', created_at: '2026-07-25T20:00:00Z' },
    ]);
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('closed');
  });

  it('descarta labeled/unlabeled sem label — "rotulou com nada" é inútil na trilha', () => {
    const events = mapTimeline([
      { event: 'labeled', created_at: '2026-07-25T20:00:00Z' },
      { event: 'unlabeled', created_at: '2026-07-25T20:01:00Z' },
      {
        event: 'labeled',
        created_at: '2026-07-25T20:02:00Z',
        label: { name: 'ok', color: 'fff' },
      },
    ]);
    expect(events).toHaveLength(1);
    expect(events[0].label).toEqual({ name: 'ok', color: 'fff' });
  });

  it('ordena cronologicamente mesmo se o GitHub devolver fora de ordem', () => {
    const events = mapTimeline([
      { event: 'closed', created_at: '2026-07-25T20:05:00Z' },
      { event: 'opened', created_at: '2026-07-25T20:00:00Z' },
      { event: 'reopened', created_at: '2026-07-25T20:10:00Z' },
    ]);
    expect(events.map((e) => e.type)).toEqual(['opened', 'closed', 'reopened']);
  });

  it('timeline vazia devolve lista vazia, não erro', () => {
    expect(mapTimeline([])).toEqual([]);
  });

  it('preserva as labels proplan:* — elas SÃO o histórico de coluna (SPEC-030)', () => {
    const events = mapTimeline([
      {
        event: 'labeled',
        created_at: '2026-07-25T20:00:00Z',
        label: { name: 'proplan:todo', color: 'fbca04' },
      },
      {
        event: 'unlabeled',
        created_at: '2026-07-25T20:01:00Z',
        label: { name: 'proplan:todo', color: 'fbca04' },
      },
      {
        event: 'labeled',
        created_at: '2026-07-25T20:02:00Z',
        label: { name: 'proplan:doing', color: '0e8a16' },
      },
    ]);

    // Três eventos crus, não um sintético "moveu de todo para doing".
    expect(events).toHaveLength(3);
    expect(events.map((e) => e.label?.name)).toEqual([
      'proplan:todo',
      'proplan:todo',
      'proplan:doing',
    ]);
  });
});

describe('toCardDetail', () => {
  it('traduz o payload do GitHub para o contrato da API', () => {
    const detail = toCardDetail(issue(), [], FETCHED);

    expect(detail).toMatchObject({
      number: 128,
      state: 'open',
      htmlUrl: 'https://github.com/RodReis/rrb-proplan/issues/128',
      author: { login: 'RodReis', avatarUrl: 'https://avatars/rodreis' },
      assignees: [{ login: 'RodReis', avatarUrl: 'https://avatars/rodreis' }],
      labels: [{ name: 'proplan:doing', color: '0e8a16' }],
      closedAt: null,
      fetchedAt: '2026-07-26T21:00:00.000Z',
    });
  });

  it('corpo vazio ou só espaço vira null — a UI mostra "sem descrição" num caso só', () => {
    expect(toCardDetail(issue({ body: '' }), [], FETCHED).body).toBeNull();
    expect(toCardDetail(issue({ body: '   \n\t ' }), [], FETCHED).body).toBeNull();
    expect(toCardDetail(issue({ body: null }), [], FETCHED).body).toBeNull();
  });

  it('preserva o markdown cru do corpo — quem renderiza é a tela', () => {
    const body = '## Título\n\n- [ ] item\n\n`código`\n\n| a | b |\n|---|---|';
    expect(toCardDetail(issue({ body }), [], FETCHED).body).toBe(body);
  });

  it('autor ausente vira null sem quebrar', () => {
    expect(toCardDetail(issue({ user: null }), [], FETCHED).author).toBeNull();
  });

  it('assignees e labels ausentes viram lista vazia', () => {
    const detail = toCardDetail(
      issue({ assignees: undefined as never, labels: undefined as never }),
      [],
      FETCHED,
    );
    expect(detail.assignees).toEqual([]);
    expect(detail.labels).toEqual([]);
  });

  it('issue fechada carrega closedAt', () => {
    const detail = toCardDetail(
      issue({ state: 'closed', closed_at: '2026-07-26T12:00:00Z' }),
      [],
      FETCHED,
    );
    expect(detail.state).toBe('closed');
    expect(detail.closedAt).toBe('2026-07-26T12:00:00Z');
  });

  it('fetchedAt vem do parâmetro, não de new Date() interno', () => {
    const outra = new Date('2020-01-01T00:00:00Z');
    expect(toCardDetail(issue(), [], outra).fetchedAt).toBe('2020-01-01T00:00:00.000Z');
  });
});
