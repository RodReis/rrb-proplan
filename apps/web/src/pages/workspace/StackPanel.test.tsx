import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { StackBlock } from '../../lib/api';
import { StackPanel } from './StackPanel';

const base: StackBlock = {
  enabled: true,
  source: 'sbom',
  ecosystems: ['npm'],
  declared: ['npm'],
  verdict: 'concorda',
  packageCount: 12,
  sourceSha: 'abc1234def',
  // Meio-dia UTC de propósito: à meia-noite a data exibida muda com o fuso do
  // runner (UTC-3 renderiza o dia anterior) e o teste vira flaky por geografia.
  observedAt: '2026-07-25T12:00:00.000Z',
};

function renderPanel(over: Partial<StackBlock> = {}) {
  return render(<StackPanel projectId="p1" stack={{ ...base, ...over }} />);
}

describe('StackPanel — proveniência (ADR-012)', () => {
  it('marca a origem como detectada do manifest, não declarada nem IA', () => {
    renderPanel();
    expect(screen.getByText('detectado do manifest pelo GitHub')).toBeInTheDocument();
  });

  it('exibe o SHA de ancoragem abreviado', () => {
    renderPanel();
    expect(screen.getByText('abc1234')).toBeInTheDocument();
  });
});

describe('StackPanel — confronto (ADR-018: coroa nenhuma fonte)', () => {
  it('discordância mostra os DOIS lados, declarado e detectado', () => {
    renderPanel({ verdict: 'discorda', declared: ['pip'], ecosystems: ['npm'] });
    expect(screen.getByText('declarado na documentação')).toBeInTheDocument();
    expect(screen.getByText('detectado nos manifests')).toBeInTheDocument();
    expect(screen.getByText('pip (Python)')).toBeInTheDocument();
    expect(screen.getAllByText('npm (JavaScript/TypeScript)').length).toBeGreaterThan(0);
  });

  // A regra central da fatia: nenhum lado recebe rótulo de verdade.
  it('discordância NÃO rotula fonte como correta, errada ou confere', () => {
    renderPanel({ verdict: 'discorda', declared: ['pip'] });
    const text = document.body.textContent ?? '';
    expect(text).not.toMatch(/correto|errado|confere|incorreta/i);
    expect(screen.getByText(/não afirma qual está certa/i)).toBeInTheDocument();
  });

  it('concordância aparece como reforço, não como discordância', () => {
    renderPanel({ verdict: 'concorda' });
    expect(screen.getByText(/declara a mesma stack/i)).toBeInTheDocument();
    expect(screen.queryByText('declarado na documentação')).not.toBeInTheDocument();
  });

  it('doc sem declaração é informação neutra, sem alarme', () => {
    renderPanel({ verdict: 'nao_declarado', declared: [] });
    expect(screen.getByText(/não declara a stack/i)).toBeInTheDocument();
    const text = document.body.textContent ?? '';
    expect(text).not.toMatch(/🔴|discordam/);
  });
});

describe('StackPanel — fallback (nunca falha em silêncio)', () => {
  it('DG desabilitado mostra o estado E o como-habilitar', () => {
    renderPanel({ enabled: false, ecosystems: [], packageCount: 0 });
    expect(screen.getByText(/Dependency Graph não está habilitado/i)).toBeInTheDocument();
    expect(screen.getByText(/Settings → Security/)).toBeInTheDocument();
  });

  it('fallback carimba a data — distingue de "ainda não sincronizado"', () => {
    renderPanel({ enabled: false });
    expect(screen.getByText(/Verificado em 25\/07\/2026/)).toBeInTheDocument();
  });
});

describe('StackPanel — lista sob demanda', () => {
  it('não lista dependências no carregamento; só oferece o botão', () => {
    renderPanel({ packageCount: 12 });
    expect(screen.getByText('Ver as 12 dependências detectadas')).toBeInTheDocument();
  });

  it('sem pacotes, não oferece o botão', () => {
    renderPanel({ packageCount: 0 });
    expect(screen.queryByText(/dependências detectadas/)).not.toBeInTheDocument();
  });
});
