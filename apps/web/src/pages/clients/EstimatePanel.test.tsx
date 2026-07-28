import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  EffortBreakdownView,
  EstimateDetail,
  EstimateSettings,
  ScenarioView,
} from '../../lib/api';

const apiMock = vi.hoisted(() => ({
  getEffortBreakdown: vi.fn(),
  generateEffortBreakdown: vi.fn(),
  listEstimates: vi.fn(),
  getEstimate: vi.fn(),
  generateEstimate: vi.fn(),
  approveEstimate: vi.fn(),
  getEstimateSettings: vi.fn(),
  updateEstimateSettings: vi.fn(),
}));

vi.mock('../../lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/api')>();
  return { ...actual, ...apiMock };
});

const { EstimatePanel } = await import('./EstimatePanel');

/**
 * Casa o texto **completo do parágrafo**, ignorando as quebras que o `<strong>`
 * introduz.
 *
 * Necessário porque as frases que mais importam nesta tela são justamente as que
 * usam ênfase — *"aprovar a decomposição **não** move o card"*. Um matcher de
 * texto simples falharia nelas, e a saída óbvia seria remover o `<strong>` para
 * o teste passar: trocar a clareza da tela pela conveniência do teste, no
 * exato ponto em que a tela precisa ser clara.
 */
function textoDe(regex: RegExp) {
  return (_conteudo: string, elemento: Element | null) => {
    if (!elemento) return false;
    // Só o nó mais interno que casa, senão `<body>` casaria em tudo.
    const proprio = regex.test(elemento.textContent ?? '');
    const doFilho = Array.from(elemento.children).some((f) =>
      regex.test(f.textContent ?? ''),
    );
    return proprio && !doFilho;
  };
}

/**
 * Estimativa no painel (SPEC-033).
 *
 * O que estes testes protegem, em ordem de importância:
 *
 *   - **os dois "aprovar" não parecem o mesmo botão** (§7.1). Aprovar a
 *     decomposição é revisão de artefato e não move nada; aprovar a estimativa
 *     move o card. Se a tela os igualasse, a decisão do PI viraria ambígua na
 *     prática — e ninguém descobriria olhando o backend;
 *   - **a contingência aparece como linha própria** (§2.5), nunca embutida;
 *   - **sem câmbio, o custo de IA fica em USD e a tela DIZ que está fora do
 *     total** (§2.6) — senão o número parece apenas omitido;
 *   - **projeção calculada continua rotulada como projeção** (§2.8);
 *   - **quem não é `owner` vê os parâmetros sem campo editável** — campo que a
 *     API vai recusar é botão morto, e pior, um que parece ter salvado.
 */

const CENARIO: ScenarioView = {
  horasBrutas: '20.00',
  horas: '20.00',
  maoDeObraBrl: '4000.00',
  custosDiretosBrl: '0.00',
  subtotalBrl: '4000.00',
  contingenciaBrl: '600.00',
  totalBrl: '4600.00',
};

const SETTINGS: EstimateSettings = {
  hourlyRateBrl: '200',
  contingencyPercent: '15',
  exchangeRateUsdBrl: null,
  exchangeRateAt: null,
  canEdit: true,
};

const EFFORT_APROVADO: EffortBreakdownView = {
  canGenerate: true,
  state: 'ARTIFACTS_READY',
  artifact: {
    id: 'art-eff',
    kind: 'effort_breakdown',
    state: 'APPROVED',
    currentVersionId: 'av-1',
    versions: [
      {
        id: 'av-1',
        version: 1,
        author: 'ai',
        model: 'haiku',
        promptVersion: 'effort_breakdown@1',
        editedBy: null,
        parentVersionId: null,
        createdAt: '2026-07-28T12:00:00.000Z',
      },
    ],
  },
  run: null,
};

function estimativa(over: Partial<EstimateDetail> = {}): EstimateDetail {
  return {
    id: 'e-1',
    version: 1,
    clientProjectId: 'cp-1',
    effortVersionId: 'av-1',
    hourlyRateBrl: '200',
    contingencyPercent: '15',
    complexity: 'media',
    complexityFactor: '1.0000',
    exchangeRate: null,
    exchangeRateAt: null,
    directCosts: [],
    aiCostIncurredUsd: '0.04530000',
    aiCostProjected: { valueUsd: '0.06000000', isCalculated: false },
    scenarios: { otimista: CENARIO, provavel: CENARIO, pessimista: CENARIO },
    mvpBreakdown: [{ mvp: 'MVP1', tarefas: 2, horas: '20.00', custoBrl: '4000.00' }],
    approvedAt: null,
    approvedBy: null,
    createdAt: '2026-07-28T12:00:00.000Z',
    createdBy: 'u-1',
    ...over,
  };
}

function montar(over: {
  effort?: EffortBreakdownView;
  settings?: EstimateSettings;
  versoes?: Array<{ id: string; version: number; totalProvavelBrl: string | null; approvedAt: string | null }>;
  detalhe?: EstimateDetail;
} = {}) {
  apiMock.getEffortBreakdown.mockResolvedValue(over.effort ?? EFFORT_APROVADO);
  apiMock.getEstimateSettings.mockResolvedValue(over.settings ?? SETTINGS);
  apiMock.listEstimates.mockResolvedValue({
    estimates:
      over.versoes ??
      [{ id: 'e-1', version: 1, complexity: 'media', approvedAt: null, approvedBy: null, createdAt: '', createdBy: null, totalProvavelBrl: '4600.00' }],
  });
  apiMock.getEstimate.mockResolvedValue(over.detalhe ?? estimativa());

  return render(
    <EstimatePanel projectId="cp-1" projectTitle="Projeto EPG" onClose={() => {}} />,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('EstimatePanel: os dois "aprovar" não podem parecer o mesmo (§7.1)', () => {
  it('o botão que move o card diz que move o card', async () => {
    montar();
    const botao = await screen.findByRole('button', {
      name: /aprovar estimativa e avançar o card/i,
    });
    expect(botao).toBeInTheDocument();
  });

  it('a tela avisa que aprovar a DECOMPOSIÇÃO não move nada', async () => {
    // Sem esta frase, alguém aprova a decomposição, vê o card parado e conclui
    // que o sistema não funcionou.
    montar({
      effort: {
        ...EFFORT_APROVADO,
        artifact: { ...EFFORT_APROVADO.artifact, state: 'PENDING_REVIEW' },
      },
    });
    expect(
      await screen.findByText(textoDe(/aprovar a decomposição.*não.*move o card/i)),
    ).toBeInTheDocument();
  });

  it('explica a diferença ao lado do botão que move', async () => {
    montar();
    expect(
      await screen.findByText(/não confundir com aprovar a decomposição/i),
    ).toBeInTheDocument();
  });

  it('aprovar chama a rota da ESTIMATIVA, não a do artefato', async () => {
    apiMock.approveEstimate.mockResolvedValue({
      approved: true,
      cardMoved: true,
      alreadyApproved: false,
    });
    montar();
    await userEvent.click(
      await screen.findByRole('button', { name: /aprovar estimativa/i }),
    );
    await waitFor(() => expect(apiMock.approveEstimate).toHaveBeenCalledWith('e-1'));
  });
});

describe('EstimatePanel: a conta em tela', () => {
  it('mostra a contingência como linha própria, separada do total', async () => {
    // §2.5. Somá-la ao total "para simplificar" desfaz o que a spec exige.
    montar();
    expect(await screen.findAllByText('Contingência')).not.toHaveLength(0);
    expect(screen.getAllByText(/600,00/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/4\.600,00/).length).toBeGreaterThan(0);
  });

  it('mostra os 3 cenários', async () => {
    montar();
    expect(await screen.findByText('Otimista')).toBeInTheDocument();
    expect(screen.getByText('Provável')).toBeInTheDocument();
    expect(screen.getByText('Pessimista')).toBeInTheDocument();
  });

  it('mostra os parâmetros usados naquela versão', async () => {
    // Snapshot: a versão guarda o valor/hora da época, não o corrente.
    montar({ detalhe: estimativa({ hourlyRateBrl: '250', complexity: 'alta' }) });
    expect(await screen.findByText(/250,00/)).toBeInTheDocument();
    expect(screen.getByText(/Alta/)).toBeInTheDocument();
  });

  it('a decomposição em MVPs avisa que não inclui contingência', async () => {
    montar();
    expect(
      await screen.findByText(textoDe(/sem contingência.*é do orçamento, não do grupo/i)),
    ).toBeInTheDocument();
  });
});

describe('EstimatePanel: custo de IA (§2.6, §2.8)', () => {
  it('sem câmbio, avisa que o custo NÃO entra no total em BRL', async () => {
    // Senão o número parece apenas omitido, e o total parece incluir tudo.
    montar();
    expect(await screen.findByText(/NÃO entra no total em BRL/)).toBeInTheDocument();
  });

  it('diz que o consumido vem do ledger', async () => {
    // ADR-016: o ledger é a fonte do gasto; derivar do artefato é proibido.
    montar();
    expect(await screen.findByText(/Consumido \(do ledger\)/)).toBeInTheDocument();
  });

  it('projeção NÃO calculada é rotulada como histórico insuficiente', async () => {
    montar();
    expect(await screen.findByText(/histórico insuficiente/)).toBeInTheDocument();
  });

  it('projeção CALCULADA continua rotulada como projeção', async () => {
    // `isCalculated` diz COMO o número veio, não que deixou de ser estimativa.
    montar({
      detalhe: estimativa({
        aiCostProjected: { valueUsd: '0.10000000', isCalculated: true },
      }),
    });
    expect(await screen.findByText(/Previsto — projeção/)).toBeInTheDocument();
  });
});

describe('EstimatePanel: parâmetros só do owner', () => {
  it('owner vê campos editáveis', async () => {
    montar();
    await screen.findByText('Parâmetros do workspace');
    expect(screen.getAllByRole('spinbutton').length).toBeGreaterThan(0);
  });

  it('não-owner vê os números dos PARÂMETROS sem campo editável', async () => {
    // Campo que a API vai recusar é botão morto, e pior que morto: um que
    // parece ter salvado.
    //
    // A asserção mira os três campos de parâmetro por rótulo, e não "nenhum
    // input na tela": a projeção manual de custo de IA continua editável de
    // propósito — ela é entrada **daquela estimativa**, não configuração do
    // workspace, e qualquer membro que calcula precisa preenchê-la.
    montar({ settings: { ...SETTINGS, canEdit: false } });
    expect(await screen.findByText(/só o dono do workspace altera/i)).toBeInTheDocument();

    for (const rotulo of [/valor\/hora/i, /contingência/i, /câmbio/i]) {
      expect(screen.queryByLabelText(rotulo)).not.toBeInTheDocument();
    }
    // E a projeção segue lá, para quem não é dono também.
    expect(screen.getByRole('spinbutton')).toBeInTheDocument();
  });

  it('sem taxa informada, a tela explica a consequência', async () => {
    montar({ settings: { ...SETTINGS, canEdit: false } });
    expect(
      await screen.findByText(/fica fora do total em R\$/i),
    ).toBeInTheDocument();
  });
});

describe('EstimatePanel: gerar e recalcular', () => {
  it('sem os 4 artefatos aprovados, explica por que não dá para decompor', async () => {
    // Sem isso a pessoa vê um painel vazio e nenhuma explicação.
    montar({
      effort: {
        canGenerate: false,
        state: 'BRIEFING_SUBMITTED',
        artifact: { kind: 'effort_breakdown', state: null, versions: [] },
        run: null,
      },
      versoes: [],
    });
    expect(
      await screen.findByText(/4 artefatos precisam estar aprovados/i),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /gerar decomposição/i }),
    ).not.toBeInTheDocument();
  });

  it('com a decomposição aprovada, o botão de calcular aparece', async () => {
    montar({ versoes: [] });
    expect(
      await screen.findByRole('button', { name: /calcular estimativa/i }),
    ).toBeInTheDocument();
  });

  it('com versão existente, o botão avisa que RECALCULAR cria versão nova', async () => {
    // §2.10: reestimar nunca sobrescreve.
    montar();
    expect(
      await screen.findByRole('button', { name: /recalcular \(cria versão nova\)/i }),
    ).toBeInTheDocument();
    expect(screen.getByText(/não apaga a anterior/i)).toBeInTheDocument();
  });

  it('avisa que recalcular NÃO volta o card (§2.12)', async () => {
    montar();
    expect(await screen.findByText(textoDe(/o card.*não.*volta/i))).toBeInTheDocument();
  });

  it('decomposição não aprovada bloqueia o cálculo, com motivo', async () => {
    montar({
      effort: {
        ...EFFORT_APROVADO,
        artifact: { ...EFFORT_APROVADO.artifact, state: 'PENDING_REVIEW' },
      },
      versoes: [],
    });
    expect(
      await screen.findByText(/decomposição precisa estar aprovada antes de calcular/i),
    ).toBeInTheDocument();
  });

  it('a falha de uma ação aparece em tela, não em silêncio', async () => {
    apiMock.approveEstimate.mockRejectedValue(new Error('transição inválida'));
    montar();
    await userEvent.click(
      await screen.findByRole('button', { name: /aprovar estimativa/i }),
    );
    expect(await screen.findByText(/transição inválida/)).toBeInTheDocument();
  });
});

describe('EstimatePanel: estimativa já aprovada', () => {
  it('mostra quando foi aprovada e para onde o card foi', async () => {
    montar({
      detalhe: estimativa({
        approvedAt: '2026-07-28T13:00:00.000Z',
        approvedBy: 'u-1',
      }),
    });
    expect(await screen.findByText(/Contrato pendente/)).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /aprovar estimativa/i }),
    ).not.toBeInTheDocument();
  });
});
