import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { Freshness } from '../../lib/api';
import { OverviewSignals } from './OverviewSignals';

const fresh: Freshness = {
  lastDocsCommitAt: new Date().toISOString(),
  lastCodeCommitAt: new Date().toISOString(),
  thresholdDays: 14,
  stale: false,
};

function renderSignals(over: Partial<Parameters<typeof OverviewSignals>[0]> = {}) {
  return render(
    <OverviewSignals
      freshness={fresh}
      awaitingAcceptance={0}
      lastSyncAt={new Date().toISOString()}
      deployVerdict="concordam"
      {...over}
    />,
  );
}

describe('OverviewSignals', () => {
  it('mostra os 4 sinais', () => {
    renderSignals();
    expect(screen.getByText('Docs · código')).toBeInTheDocument();
    expect(screen.getByText('Aguardando seu aceite')).toBeInTheDocument();
    expect(screen.getByText('Última sincronização')).toBeInTheDocument();
    expect(screen.getByText('Drift de deploy')).toBeInTheDocument();
  });

  // Ausência é informação (ADR-014): sem dado o sinal diz que não sabe.
  // Fingir "0 entregas" quando o board não carregou seria mentir sobre o aceite.
  it('diz que não sabe em vez de fingir zero quando falta dado', () => {
    renderSignals({ freshness: null, awaitingAcceptance: null, deployVerdict: null });

    expect(screen.getAllByText('—')).toHaveLength(3);
    expect(screen.getByText('board indisponível')).toBeInTheDocument();
    expect(screen.getByText('ainda não coletado')).toBeInTheDocument();
    expect(screen.queryByText('0 entregas')).not.toBeInTheDocument();
  });

  it('distingue coluna Feito vazia de entregas aguardando aceite', () => {
    const { rerender } = renderSignals({ awaitingAcceptance: 0 });
    expect(screen.getByText('nada')).toBeInTheDocument();
    expect(screen.getByText('coluna Feito vazia')).toBeInTheDocument();

    rerender(
      <OverviewSignals
        freshness={fresh}
        awaitingAcceptance={3}
        lastSyncAt={new Date().toISOString()}
        deployVerdict="concordam"
      />,
    );
    expect(screen.getByText('3 entregas')).toBeInTheDocument();
    expect(screen.getByText('entregue, aguardando seu aceite')).toBeInTheDocument();
  });

  it('singulariza uma entrega', () => {
    renderSignals({ awaitingAcceptance: 1 });
    expect(screen.getByText('1 entrega')).toBeInTheDocument();
  });

  // O frescor alerta em âmbar e nunca bloqueia (ADR-010) — o texto tem que
  // dizer o limiar, senão o alerta é opaco.
  it('nomeia o limiar quando a doc está defasada', () => {
    renderSignals({ freshness: { ...fresh, stale: true, thresholdDays: 14 } });
    expect(
      screen.getByText('código à frente dos docs por mais de 14 d'),
    ).toBeInTheDocument();
  });

  it('traduz cada veredito de deploy', () => {
    const casos = [
      ['concordam', 'nenhum'],
      ['discordam', 'divergente'],
      ['so_github_side', 'só no GitHub'],
      ['omissa', 'sem doc'],
      ['silencio', 'silêncio'],
    ] as const;

    for (const [verdict, esperado] of casos) {
      const { unmount } = renderSignals({ deployVerdict: verdict });
      expect(screen.getByText(esperado)).toBeInTheDocument();
      unmount();
    }
  });

  it('não afirma sincronização quando nunca houve', () => {
    renderSignals({ lastSyncAt: null });
    expect(screen.getByText('nunca')).toBeInTheDocument();
  });
});
