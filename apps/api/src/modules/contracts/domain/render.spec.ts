import {
  CONTRACT_DISCLAIMER,
  escapeHtml,
  markupToHtml,
  renderContract,
  substitute,
  type RenderValues,
} from './render';

const VALORES: RenderValues = {
  provider_name: 'Acme Ltda',
  provider_document: '12.345.678/0001-90',
  provider_address: 'Rua A, 100',
  client_name: 'Cliente Fulano',
  client_document: '123.456.789-00',
  client_address: 'Rua B, 200',
  scope: '- Entrega 1',
  budget: 'R$ 10.000,00',
  effort_hours: '120',
  payment_terms: '50% na assinatura',
  date: '28 de julho de 2026',
  modality: 'desenvolvimento de software',
};

describe('escapeHtml', () => {
  it('escapa os cinco caracteres que viram tag ou atributo', () => {
    expect(escapeHtml(`<a href="x" title='y'>& fim</a>`)).toBe(
      '&lt;a href=&quot;x&quot; title=&#39;y&#39;&gt;&amp; fim&lt;/a&gt;',
    );
  });

  it('escapa o & primeiro — senão as entidades saem duplicadas', () => {
    // Se `&` fosse escapado depois de `<`, o `&lt;` gerado viraria `&amp;lt;`
    // e o cliente leria a entidade crua no documento.
    expect(escapeHtml('<')).toBe('&lt;');
  });
});

describe('substitute', () => {
  it('troca o placeholder pelo valor', () => {
    expect(substitute('Olá {{client_name}}.', VALORES)).toBe('Olá Cliente Fulano.');
  });

  it('aceita espaços em volta do nome — digitação natural', () => {
    expect(substitute('{{ client_name }}', VALORES)).toBe('Cliente Fulano');
  });

  it('troca todas as ocorrências, não a primeira', () => {
    expect(substitute('{{budget}} e {{budget}}', VALORES)).toBe(
      'R$ 10.000,00 e R$ 10.000,00',
    );
  });

  it('placeholder sem valor vira vazio, nunca o literal cru', () => {
    // O desconhecido já foi recusado ao salvar (§2.4). O que chega aqui sem
    // valor é campo opcional em branco — e `{{payment_terms}}` aparecendo cru
    // no contrato do cliente é pior que uma linha vazia.
    const semTermos = { ...VALORES, payment_terms: '' };
    expect(substitute('Pagamento: {{payment_terms}}.', semTermos)).toBe('Pagamento: .');
  });
});

describe('markupToHtml', () => {
  it('converte títulos, negrito, listas e parágrafos', () => {
    const html = markupToHtml('# Título\n\n## Seção\n\nUm **texto**.\n\n- a\n- b');
    expect(html).toContain('<h1>Título</h1>');
    expect(html).toContain('<h2>Seção</h2>');
    expect(html).toContain('<p>Um <strong>texto</strong>.</p>');
    expect(html).toContain('<ul><li>a</li><li>b</li></ul>');
  });

  it('quebra simples dentro do parágrafo vira espaço', () => {
    expect(markupToHtml('linha um\nlinha dois')).toBe('<p>linha um linha dois</p>');
  });

  it('bloco vazio não vira parágrafo vazio', () => {
    expect(markupToHtml('a\n\n\n\nb')).toBe('<p>a</p>\n<p>b</p>');
  });
});

describe('renderContract — o critério de aceite do §5', () => {
  it('um cliente chamado <script> aparece como TEXTO, não executa', () => {
    const html = renderContract('# {{client_name}}', {
      ...VALORES,
      client_name: '<script>alert(1)</script>',
    });

    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).not.toContain('<script>');
  });

  it('HTML digitado no CORPO do template também é escapado', () => {
    // O template é editável pelo dono do workspace; a página pública não é
    // lugar para o que ele digitar virar tag.
    const html = renderContract('<img src=x onerror=alert(1)>', VALORES);
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;img');
  });

  it('valor com & não é reescapado — escapa antes de substituir', () => {
    // `Bar & Cia` viraria `Bar &amp;amp; Cia` se o corpo fosse escapado depois
    // da substituição: o `&amp;` gerado seria escapado de novo.
    const html = renderContract('{{client_name}}', { ...VALORES, client_name: 'Bar & Cia' });
    expect(html).toContain('Bar &amp; Cia');
    expect(html).not.toContain('&amp;amp;');
  });

  it('as únicas tags do documento nasceram do conversor de marcação', () => {
    const html = renderContract('## {{client_name}}', {
      ...VALORES,
      client_name: '<b>x</b>',
    });
    const tags = [...html.matchAll(/<\/?([a-z]+\d*)/g)].map((m) => m[1]);
    expect(new Set(tags)).toEqual(new Set(['article', 'h2', 'footer', 'p']));
  });

  it('marcação dentro de um VALOR não formata — só o template marca', () => {
    // Os `**` do valor viram entidade (`&#42;`), que o browser mostra como
    // asterisco: o cliente lê exatamente o que foi digitado, e o negrito não
    // vaza para o resto da cláusula.
    const html = renderContract('{{client_name}}', {
      ...VALORES,
      client_name: '**não é negrito**',
    });
    expect(html).not.toContain('<strong>');
    expect(html).toContain('&#42;&#42;não é negrito&#42;&#42;');
  });

  it('valor iniciado por # não vira título do documento', () => {
    const html = renderContract('{{client_name}}', {
      ...VALORES,
      client_name: '# Cliente',
    });
    expect(html).not.toContain('<h1>');
    expect(html).toContain('<p>');
  });

  it('{{scope}} é a exceção: entra com marcação e vira lista', () => {
    // Único placeholder que carrega marcação própria (`MARKUP_PLACEHOLDERS`),
    // porque o `scopeToMarkup` já escapou item por item.
    const html = renderContract('{{scope}}', {
      ...VALORES,
      scope: '**Entregáveis**\n\n- API\n- Painel',
    });
    expect(html).toContain('<strong>Entregáveis</strong>');
    expect(html).toContain('<ul><li>API</li><li>Painel</li></ul>');
  });

  it('o disclaimer vai no documento renderizado, no rodapé (§2.12)', () => {
    const html = renderContract('# Contrato', VALORES);
    expect(html).toContain(CONTRACT_DISCLAIMER);
    expect(html.indexOf(CONTRACT_DISCLAIMER)).toBeGreaterThan(html.indexOf('<h1>'));
  });
});
