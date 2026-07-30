import {
  licenseKey,
  licenseRevoked,
  render,
  sourceUsernameConfirmed,
  sourceUsernameRequest,
} from './templates';

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

describe('template `source_username_request` (SPEC-039)', () => {
  const pedido = {
    customerName: 'Rodrigo',
    productName: 'War Room',
    editionName: 'Com código-fonte',
    url: 'http://localhost:5180/s/tok-abc',
  };

  it('leva o link no HTML e no texto', () => {
    const { html, text } = sourceUsernameRequest(pedido);

    // Este e-mail sem clique não faz nada: o comprador fica na lista de
    // pendências do admin. Cliente que estiliza mal o botão deixaria a ação
    // invisível, e a URL crua é o caminho de volta.
    expect(html).toContain(pedido.url);
    expect(text).toContain(pedido.url);
  });

  it('o link aparece duas vezes no HTML — botão e URL legível', () => {
    const { html } = sourceUsernameRequest(pedido);

    expect(html.split(pedido.url).length - 1).toBeGreaterThanOrEqual(2);
  });

  it('diz que o link é de uso único', () => {
    expect(sourceUsernameRequest(pedido).text).toMatch(/uma única vez/i);
  });

  it('NÃO promete prazo — o link não tem', () => {
    const { html, text } = sourceUsernameRequest(pedido);

    // Decisão PI #3: o link vale até ser usado. Escrever "expira em X dias"
    // inventaria uma regra que o código não tem, e mandaria o comprador correr
    // sem motivo.
    expect(text).not.toMatch(/expira|vence|prazo|\d+\s*dias/i);
    expect(html).not.toMatch(/expira|vence|prazo|\d+\s*dias/i);
  });

  it('declara a finalidade do dado (LGPD)', () => {
    // O username do GitHub é dado pessoal. O texto diz para que serve, em uma
    // frase — é o que a §Notas técnicas exige da página e do e-mail.
    expect(sourceUsernameRequest(pedido).text).toMatch(/convite ao repositório/i);
  });

  it('escapa HTML do nome e da URL', () => {
    const { html } = sourceUsernameRequest({
      ...pedido,
      customerName: '<script>x</script>',
      url: 'http://x/s/a"onmouseover="alert(1)',
    });

    expect(html).not.toContain('<script>');
    // A URL entra em atributo `href`: sem escapar a aspa, o valor fecha o
    // atributo e o resto vira HTML nosso.
    expect(html).not.toContain('"onmouseover="');
  });
});

describe('template `source_username_confirmed` (SPEC-039)', () => {
  const confirmado = {
    customerName: 'Rodrigo',
    productName: 'War Room',
    githubUsername: 'RodReis',
    inviteAt: '2026-08-07T00:00:00.000Z',
  };

  it('nomeia o login no assunto e no corpo', () => {
    const m = sourceUsernameConfirmed(confirmado);

    // A razão de este e-mail existir. Se o comprador confirmou o login de um
    // estranho sem olhar, é aqui que ele percebe — e o assunto é o que ele lê
    // sem abrir.
    expect(m.subject).toContain('@RodReis');
    expect(m.text).toContain('@RodReis');
    expect(m.html).toContain('@RodReis');
  });

  it('convida à correção, não é só recibo', () => {
    // Sem esta frase o e-mail é uma formalidade — e formalidade não impede que
    // um estranho entre no repositório privado.
    expect(sourceUsernameConfirmed(confirmado).text).toMatch(/não é o seu usuário/i);
  });

  it('diz a data prevista em pt-BR', () => {
    expect(sourceUsernameConfirmed(confirmado).text).toContain('07/08/2026');
  });

  it('sem data agendada diz "em breve", não uma data inventada', () => {
    const m = sourceUsernameConfirmed({ ...confirmado, inviteAt: null });

    // `null` acontece quando a licença ainda não tem `sourceInviteAt`. Formatar
    // `null` produziria "31/12/1969" — e o comprador leria isso como erro nosso.
    expect(m.text).toMatch(/em breve/i);
    expect(m.text).not.toMatch(/1969|NaN|Invalid/);
  });

  it('escapa HTML do login', () => {
    const { html } = sourceUsernameConfirmed({
      ...confirmado,
      githubUsername: '<img src=x onerror=1>',
    });

    expect(html).not.toContain('<img');
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

  it('despacha os dois templates da SPEC-039', () => {
    // Template novo sem entrada no `render` é a falha muda desta função: o
    // `MailService.send` chamaria `render` e o `switch` cairia em `undefined`,
    // quebrando na leitura do `subject` — depois de a compra já ter acontecido.
    expect(
      render('source_username_request', {
        customerName: null,
        productName: 'War Room',
        editionName: 'Com código-fonte',
        url: 'http://x/s/t',
      }).subject,
    ).toMatch(/código-fonte/i);

    expect(
      render('source_username_confirmed', {
        customerName: null,
        productName: 'War Room',
        githubUsername: 'RodReis',
        inviteAt: null,
      }).subject,
    ).toContain('@RodReis');
  });
});

const chave = {
  customerName: null,
  licenseKey: 'WR-AB12-CD34-EF56-GH78',
  productName: 'War Room',
  editionName: 'Sem código-fonte',
};
