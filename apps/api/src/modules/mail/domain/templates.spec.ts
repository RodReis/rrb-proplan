import { licenseKey, licenseRevoked, render } from './templates';

/**
 * Os templates (SPEC-038). Funções puras — o teste é barato e a regressão que
 * ele pega é cara: e-mail malformado só aparece na caixa de quem comprou.
 */
describe('template `license_key`', () => {
  const base = {
    customerName: 'Maria Silva',
    licenseKey: 'WR-AB12-CD34-EF56-GH78',
    productName: 'War Room',
    editionName: 'Com código-fonte',
  };

  it('põe a chave nas duas versões, HTML e texto', () => {
    const { html, text } = licenseKey(base);

    // As duas, não uma: cliente que bloqueia HTML mostraria uma mensagem sem a
    // chave — que é a única coisa que este e-mail existe para entregar.
    expect(html).toContain('WR-AB12-CD34-EF56-GH78');
    expect(text).toContain('WR-AB12-CD34-EF56-GH78');
  });

  it('diz que a chave não pode ser reenviada', () => {
    // Não é texto decorativo: é a consequência de não persistir a chave
    // (SPEC-036). Quem apaga o e-mail sem copiar precisa saber, na hora, que a
    // saída é emitir outra — descobrir isso depois vira chamado de suporte.
    const { text } = licenseKey(base);
    expect(text).toMatch(/não armazenamos a chave/i);
    expect(text).toMatch(/não conseguimos reenviá-la/i);
  });

  it('funciona sem o nome do comprador', () => {
    // A plataforma nem sempre informa. `Olá, null!` é o defeito que este teste
    // impede de chegar na caixa de entrada.
    const { html, text } = licenseKey({ ...base, customerName: null });
    expect(text).toMatch(/^Olá!/);
    expect(html).not.toContain('null');
  });

  it('escapa HTML vindo do nome do comprador', () => {
    // Nome vem da plataforma de pagamento: entrada externa. Sem escapar, a tag
    // viaja dentro do nosso e-mail.
    const { html } = licenseKey({ ...base, customerName: '<script>alert(1)</script>' });
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('usa estilo inline, não bloco `<style>`', () => {
    // Gmail remove `<style>` do `<head>`: um e-mail que depende dele chega sem
    // formatação nenhuma no cliente mais usado do mundo.
    const { html } = licenseKey(base);
    expect(html).toContain('style="');
    expect(html).not.toContain('<style');
  });

  it('nomeia o produto no assunto', () => {
    // O assunto é o que o comprador vê na lista antes de abrir — e é o que ele
    // vai buscar meses depois, quando formatar o PC.
    expect(licenseKey(base).subject).toContain('War Room');
  });
});

describe('template `license_revoked`', () => {
  const base = {
    customerName: 'João',
    productName: 'War Room',
    reason: 'reembolso solicitado',
  };

  it('informa sem acusar, e abre caminho de contato', () => {
    // Chargeback pode ser fraude de terceiro no cartão do próprio comprador:
    // tratar o cliente como caloteiro erra em cima de quem já foi vítima.
    const { text } = licenseRevoked(base);
    expect(text).toContain('reembolso solicitado');
    expect(text).toMatch(/engano/i);
  });

  it('escapa o motivo, que também vem de fora', () => {
    const { html } = licenseRevoked({ ...base, reason: '<b>fraude</b>' });
    expect(html).not.toContain('<b>fraude</b>');
  });
});

describe('render', () => {
  it('despacha pelo nome do template', () => {
    // É o que o worker chama: ele tem o NOME em mãos, não a função.
    expect(render('license_key', { ...chave }).subject).toContain('Sua chave');
    expect(
      render('license_revoked', {
        customerName: null,
        productName: 'War Room',
        reason: 'chargeback',
      }).subject,
    ).toContain('desativada');
  });
});

const chave = {
  customerName: null,
  licenseKey: 'WR-AB12-CD34-EF56-GH78',
  productName: 'War Room',
  editionName: 'Sem código-fonte',
};
