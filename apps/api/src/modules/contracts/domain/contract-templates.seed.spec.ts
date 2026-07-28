/**
 * Os templates-exemplo (SPEC-034 §2.3).
 *
 * O que estes testes protegem: o seed é **texto**, e texto não quebra build. Um
 * placeholder com nome errado (`{{client_nome}}`) passaria por qualquer revisão
 * visual e só apareceria no contrato do cliente — como literal cru no meio de
 * uma cláusula, ou como erro de validação no 1º uso, dependendo de qual barreira
 * pegasse primeiro. Nenhuma das duas saídas é aceitável num documento que
 * alguém pode tratar como vinculante.
 */
import {
  CONTRACT_PLACEHOLDERS,
  CONTRACT_TEMPLATE_SEEDS,
} from '../../../../prisma/contract-templates.seed';

/** Todo `{{...}}` presente no corpo, sem repetição. */
function placeholdersDe(body: string): string[] {
  const encontrados = body.match(/\{\{([^}]*)\}\}/g) ?? [];
  return [...new Set(encontrados.map((p) => p.slice(2, -2)))];
}

describe('SPEC-034: templates-exemplo de contrato', () => {
  it('traz exatamente as três modalidades do MVP3 §3', () => {
    expect(CONTRACT_TEMPLATE_SEEDS.map((t) => t.modality)).toEqual([
      'desenvolvimento',
      'desenvolvimento_manutencao',
      'desenvolvimento_venda_codigo',
    ]);
  });

  it.each(CONTRACT_TEMPLATE_SEEDS.map((t) => [t.modality, t.body] as const))(
    '%s só usa placeholders conhecidos',
    (_modality, body) => {
      // Um placeholder desconhecido é erro de validação ao salvar (§2.4). Se o
      // próprio seed o contivesse, o produto nasceria com um template que ele
      // mesmo recusa — e a descoberta seria no 1º contrato.
      const desconhecidos = placeholdersDe(body).filter(
        (p) => !(CONTRACT_PLACEHOLDERS as readonly string[]).includes(p),
      );
      expect(desconhecidos).toEqual([]);
    },
  );

  it.each(CONTRACT_TEMPLATE_SEEDS.map((t) => [t.modality, t.body] as const))(
    '%s preenche as duas partes, o escopo, o valor e as horas',
    (_modality, body) => {
      // Contrato sem uma das partes identificadas, sem escopo ou sem valor é um
      // documento incompleto com aparência de contrato. Estes cinco são o mínimo
      // que faz o texto ser um contrato e não um rascunho.
      const usados = placeholdersDe(body);
      expect(usados).toEqual(
        expect.arrayContaining([
          'provider_name',
          'provider_document',
          'client_name',
          'client_document',
          'scope',
          'budget',
          'effort_hours',
        ]),
      );
    },
  );

  it('nenhum template promete duração em dias (§8.7)', () => {
    // A decisão 7 do PI saiu de ler o código: o `Estimate` entrega horas e
    // dinheiro, e o divisor de horas produtivas/dia não existe em fatia nenhuma.
    // Um `{{duration_days}}` esquecido aqui seria um placeholder impossível de
    // preencher dentro de texto jurídico já escrito em cima dele.
    for (const { body } of CONTRACT_TEMPLATE_SEEDS) {
      expect(body).not.toContain('duration_days');
      expect(body).not.toMatch(/\{\{[^}]*day[^}]*\}\}/i);
    }
  });

  it('a cláusula de propriedade intelectual difere entre as três modalidades', () => {
    // É a razão de haver três templates em vez de um com seção condicional
    // (§2.2). Se as três acabassem com o mesmo texto, a divisão perderia o
    // sentido e o contrato de cessão de código diria a coisa errada sobre
    // propriedade — validamente, e sem nada falhar.
    const clausulas = CONTRACT_TEMPLATE_SEEDS.map(({ body }) =>
      body.slice(body.indexOf('## 9.')),
    );
    expect(new Set(clausulas).size).toBe(3);
  });

  it('só a modalidade de venda cede a titularidade do código', () => {
    const porModalidade = new Map(
      CONTRACT_TEMPLATE_SEEDS.map((t) => [t.modality, t.body]),
    );
    expect(porModalidade.get('desenvolvimento_venda_codigo')).toContain('cede');
    // As outras duas concedem LICENÇA de uso. Trocar licença por cessão é a
    // diferença entre o cliente poder usar o software e ser dono dele.
    expect(porModalidade.get('desenvolvimento')).toContain('licença de uso');
    expect(porModalidade.get('desenvolvimento_manutencao')).toContain('licença de uso');
  });

  it('nenhum corpo é vazio — o CHECK do banco recusaria', () => {
    for (const { body } of CONTRACT_TEMPLATE_SEEDS) {
      expect(body.trim().length).toBeGreaterThan(0);
    }
  });
});
