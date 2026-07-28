import {
  CONTRACT_PLACEHOLDERS,
  describeIssues,
  extractPlaceholders,
  validatePlaceholders,
} from './placeholders';

describe('SPEC-034 §2.4: placeholders de template', () => {
  it('aceita um corpo com placeholders conhecidos', () => {
    expect(validatePlaceholders('Contrato de {{client_name}} por {{budget}}')).toEqual([]);
  });

  it('aceita corpo sem nenhum placeholder', () => {
    // Texto fixo é template válido: nem toda cláusula tem variável.
    expect(validatePlaceholders('Cláusula sem variável.')).toEqual([]);
  });

  it('recusa placeholder desconhecido, nomeando qual', () => {
    const issues = validatePlaceholders('Olá {{client_nome}}');
    expect(issues).toEqual([{ raw: 'client_nome', reason: 'desconhecido' }]);
    // O nome tem de chegar à mensagem: sem ele, a pessoa procura num texto de
    // 2.400 caracteres qual dos `{{...}}` está errado.
    expect(describeIssues(issues)).toContain('{{client_nome}}');
  });

  it('devolve TODOS os problemas, não só o primeiro', () => {
    // Corrigir um por vez, com um PATCH e um recarregamento a cada volta, é o
    // que faz alguém desistir e colar o texto de volta sem os placeholders.
    const issues = validatePlaceholders('{{errado_um}} e {{errado_dois}}');
    expect(issues.map((i) => i.raw)).toEqual(['errado_um', 'errado_dois']);
  });

  it('não repete o mesmo placeholder errado duas vezes na lista', () => {
    const issues = validatePlaceholders('{{x}} no início e {{x}} no fim');
    expect(issues).toHaveLength(1);
  });

  it('aceita espaço em volta do nome — digitação natural', () => {
    expect(validatePlaceholders('Olá {{ client_name }}')).toEqual([]);
  });

  it('recusa espaço NO MEIO do nome como malformado', () => {
    // `{{client name}}` é o erro de digitação mais provável, e não existe
    // placeholder com esse nome. A distinção de `desconhecido` existe só para
    // dar uma mensagem melhor.
    expect(validatePlaceholders('Olá {{client name}}')).toEqual([
      { raw: 'client name', reason: 'malformado' },
    ]);
  });

  it('recusa placeholder vazio', () => {
    expect(validatePlaceholders('Olá {{}}')).toEqual([
      { raw: '', reason: 'malformado' },
    ]);
  });

  it('encontra o placeholder malformado em vez de ignorá-lo', () => {
    // Esta é a razão de a regex ser permissiva. Se ela casasse só com o bem
    // formado, `{{client name}}` não seria ENCONTRADO — e o que a validação não
    // vê, ela aprova. O literal cru reapareceria no contrato do cliente.
    expect(extractPlaceholders('{{client name}}')).toEqual(['client name']);
  });

  it('todos os placeholders da spec §2.4 são aceitos', () => {
    const corpo = CONTRACT_PLACEHOLDERS.map((p) => `{{${p}}}`).join(' ');
    expect(validatePlaceholders(corpo)).toEqual([]);
  });

  it('não aceita duration_days — a emenda §8.7 tirou dias do contrato', () => {
    // O `Estimate` entrega horas e dinheiro; dias não existem em fatia nenhuma
    // do MVP3. Um template com `{{duration_days}}` teria de ser recusado ao
    // salvar, não descoberto na emissão.
    expect(validatePlaceholders('{{duration_days}}')).toEqual([
      { raw: 'duration_days', reason: 'desconhecido' },
    ]);
  });

  it('chave simples não é placeholder', () => {
    // `{ }` aparece em texto normal (e em JSON colado). Só `{{ }}` é
    // substituição — senão qualquer chave num contrato viraria erro de
    // validação.
    expect(validatePlaceholders('O valor de {x} é fixo')).toEqual([]);
  });
});
