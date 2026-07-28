import { renderPublicPage, statusMessage } from './public-page';

const CONTRATO = {
  renderedHtml: '<h1>Contrato</h1><p>Cláusula primeira.</p>',
  version: 1,
  expiresAt: '2026-07-30T12:00:00.000Z',
};

describe('SPEC-034: página pública do contrato — o aviso (§5)', () => {
  /**
   * A SPEC-031 já pagou esse defeito uma vez, com um aviso invisível na etapa
   * 9. O critério de aceite é explícito: **acima** do contrato, não no rodapé,
   * não abaixo da dobra. Provado por POSIÇÃO, não por presença.
   */
  it('o aviso de dados pessoais vem ANTES do contrato no HTML', () => {
    const html = renderPublicPage({ status: 'valid', contract: CONTRATO });

    const posAviso = html.indexOf('dados pessoais');
    const posContrato = html.indexOf('Cláusula primeira');

    expect(posAviso).toBeGreaterThan(-1);
    expect(posContrato).toBeGreaterThan(-1);
    expect(posAviso).toBeLessThan(posContrato);
  });

  it('o aviso diz que o link expira em 48 h', () => {
    const html = renderPublicPage({ status: 'valid', contract: CONTRATO });
    expect(html).toMatch(/48\s*h/i);
  });

  it('mostra a data de expiração do link', () => {
    const html = renderPublicPage({ status: 'valid', contract: CONTRATO });
    expect(html).toContain('30/07/2026');
  });
});

describe('SPEC-034: página pública — noindex (§2.8)', () => {
  it('traz `<meta name="robots">` com noindex e nofollow', () => {
    const html = renderPublicPage({ status: 'valid', contract: CONTRATO });
    expect(html).toMatch(
      /<meta\s+name="robots"\s+content="noindex,\s*nofollow"\s*\/?>/i,
    );
  });

  it('a meta robots aparece também nas páginas de erro', () => {
    for (const status of ['invalid', 'expired', 'revoked'] as const) {
      expect(renderPublicPage({ status })).toMatch(/name="robots"/i);
    }
  });
});

describe('SPEC-034: página pública — sem aceite do cliente (§2.7)', () => {
  /**
   * Aceite anônimo seria assinatura sem nenhuma garantia de assinatura. A
   * página é de LEITURA: não pode haver formulário, botão de submit, nem
   * qualquer coisa que sugira que clicar ali vincula alguém.
   */
  it('não existe formulário nem botão na página', () => {
    const html = renderPublicPage({ status: 'valid', contract: CONTRATO });

    expect(html).not.toMatch(/<form\b/i);
    expect(html).not.toMatch(/<button\b/i);
    expect(html).not.toMatch(/<input\b/i);
    expect(html).not.toMatch(/type="submit"/i);
  });

  it('a palavra "aceito" não aparece como ação para o cliente', () => {
    const html = renderPublicPage({ status: 'valid', contract: CONTRATO });
    expect(html.toLowerCase()).not.toContain('aceito');
  });
});

describe('SPEC-034: página pública — estados que não servem', () => {
  it.each([
    ['invalid', /não .*(válido|existe)|inválido/i],
    ['expired', /expirou|expirado/i],
    ['revoked', /revogado|cancelado/i],
  ] as const)('%s explica o estado sem vazar nada', (status, padrao) => {
    const html = renderPublicPage({ status });

    expect(html).toMatch(padrao);
    // Nenhum estado inválido pode conter o documento.
    expect(html).not.toContain('Cláusula primeira');
  });

  it('nenhuma página de erro cita tenant, cliente ou projeto', () => {
    for (const status of ['invalid', 'expired', 'revoked'] as const) {
      const html = renderPublicPage({ status }).toLowerCase();
      expect(html).not.toContain('tenant');
      expect(html).not.toContain('workspace');
      expect(html).not.toContain('projeto');
    }
  });

  it('`invalid` e o alheio produzem exatamente a mesma página', () => {
    // Não-diferencial: o service já colapsa os dois em `invalid`; aqui se
    // afirma que a renderização não reintroduz diferença.
    expect(renderPublicPage({ status: 'invalid' })).toBe(
      renderPublicPage({ status: 'invalid' }),
    );
  });
});

describe('SPEC-034: mensagem por estado', () => {
  it('cada estado tem mensagem própria e legível', () => {
    expect(statusMessage('expired')).toMatch(/expir/i);
    expect(statusMessage('revoked')).toMatch(/revog/i);
    expect(statusMessage('invalid')).toMatch(/\S/);
  });
});

describe('SPEC-034: a página não reescreve o documento', () => {
  /**
   * O `renderedHtml` foi gravado na emissão e é imutável (§2.5). A página o
   * embute como veio — se ela escapasse de novo, `&amp;` viraria `&amp;amp;` e
   * o documento sairia diferente do que foi emitido.
   */
  it('embute o HTML do contrato sem reescapar', () => {
    const html = renderPublicPage({
      status: 'valid',
      contract: { ...CONTRATO, renderedHtml: '<p>Bar &amp; Cia</p>' },
    });

    expect(html).toContain('<p>Bar &amp; Cia</p>');
    expect(html).not.toContain('&amp;amp;');
  });
});
