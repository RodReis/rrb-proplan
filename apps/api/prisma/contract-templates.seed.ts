/**
 * Templates-EXEMPLO de contrato, um por modalidade (SPEC-034 §2.3, decisão 2 do
 * PI em §8.2).
 *
 * ## Por que existe seed, e por que ele é deliberadamente insuficiente
 *
 * O seed existe para a fatia ser utilizável no dia 1: template em branco faria
 * o prestador encarar um editor vazio e um contrato para escrever do zero.
 *
 * O risco que ele cria é o oposto — o texto ser usado **como veio**, com o
 * ProPlan virando fonte de minuta jurídica sem advogado por trás (§7.3). Duas
 * barreiras respondem a isso, e nenhuma delas está neste arquivo por acaso:
 *
 * 1. **`isSeedExample = true`** na linha do template. O 1º contrato de uma
 *    modalidade exige uma versão salva pelo prestador — o produto não emite
 *    contrato com texto que o dono nunca leu. A trava é fraca de propósito:
 *    exige **uma** edição, não revisão de verdade. Ela não garante que o texto
 *    foi lido; garante que o dono passou pela tela e assumiu o texto uma vez.
 * 2. **Disclaimer no rodapé do documento renderizado** (§2.12), não só na tela
 *    de edição — viaja junto do que o cliente lê, que é o lugar certo.
 *
 * ## Sobre os placeholders
 *
 * São substituição **escapada** na renderização (§2.4), nunca engine que avalie
 * expressão. `{{effort_hours}}` e não `{{duration_days}}`: o `Estimate`
 * implementado entrega horas e dinheiro, e o divisor de horas produtivas por dia
 * não existe em fatia nenhuma do MVP3 (§8.7).
 */

/** Modalidades do MVP3 §3 — o enum `ContractModality` no banco. */
export type ContractModalitySeed =
  | 'desenvolvimento'
  | 'desenvolvimento_manutencao'
  | 'desenvolvimento_venda_codigo';

/**
 * Placeholders aceitos (§2.4). Um desconhecido é **erro de validação ao salvar
 * o template** — nunca texto cru vazando para o contrato do cliente.
 *
 * Exportado daqui porque o seed é o primeiro consumidor; o validador do PR-2
 * importa a mesma lista, para que não existam duas verdades sobre o que é
 * placeholder válido.
 */
export const CONTRACT_PLACEHOLDERS = [
  'provider_name',
  'provider_document',
  'provider_address',
  'client_name',
  'client_document',
  'client_address',
  'scope',
  'budget',
  'effort_hours',
  'payment_terms',
  'date',
  'modality',
] as const;

export type ContractPlaceholder = (typeof CONTRACT_PLACEHOLDERS)[number];

/**
 * Cláusulas comuns às três modalidades. Extraídas porque repetir o texto três
 * vezes faria uma correção precisar acontecer em três lugares — e a que
 * ficasse para trás só apareceria num contrato já enviado.
 */
const PARTES = `## 1. Das partes

**CONTRATADA:** {{provider_name}}, inscrita sob o nº {{provider_document}}, com
endereço em {{provider_address}}.

**CONTRATANTE:** {{client_name}}, inscrito(a) sob o nº {{client_document}}, com
endereço em {{client_address}}.`;

const ESCOPO = `## 2. Do objeto

O presente instrumento tem por objeto a prestação de serviços de desenvolvimento
de software na modalidade **{{modality}}**, conforme o escopo abaixo:

{{scope}}

Itens não listados acima não integram o objeto deste contrato e, caso
solicitados, serão orçados em separado.`;

const VALOR = `## 3. Do valor e das condições de pagamento

O valor total dos serviços é de **{{budget}}**, correspondente a uma estimativa
de **{{effort_hours}} horas** de trabalho.

Condições de pagamento: {{payment_terms}}

A estimativa de horas reflete o escopo descrito na cláusula 2. Alterações de
escopo podem alterar o esforço e, consequentemente, o valor — sempre mediante
acordo prévio entre as partes.`;

const PRAZO = `## 4. Do prazo

O prazo de execução será acordado entre as partes a partir da data de início dos
trabalhos, considerando a estimativa de esforço da cláusula 3.`;

const OBRIGACOES = `## 5. Das obrigações

A CONTRATADA compromete-se a executar os serviços com diligência técnica,
mantendo a CONTRATANTE informada sobre o andamento.

A CONTRATANTE compromete-se a fornecer, em tempo hábil, as informações, acessos
e aprovações necessários à execução dos serviços. Atrasos decorrentes de
pendências da CONTRATANTE não são imputáveis à CONTRATADA.`;

const CONFIDENCIALIDADE = `## 6. Da confidencialidade

As partes obrigam-se a manter sigilo sobre informações a que tiverem acesso em
razão deste contrato, salvo quando a divulgação for exigida por lei ou
autoridade competente.`;

const RESCISAO = `## 7. Da rescisão

Este contrato pode ser rescindido por qualquer das partes mediante comunicação
prévia por escrito. Os serviços já executados até a data da rescisão são
devidos.`;

const FORO = `## 8. Do foro

Fica eleito o foro da comarca do domicílio da CONTRATADA para dirimir eventuais
controvérsias oriundas deste contrato.

{{date}}`;

/**
 * A cláusula que **diferencia** as três modalidades — e a razão de haver três
 * templates em vez de um com seção condicional (§2.2, decisão do PI em #149).
 *
 * Condicional dentro de texto jurídico é o pior lugar possível para um `if`:
 * quem lê o template não consegue ver qual versão o cliente recebeu, e um erro
 * na condição produz um contrato válido dizendo a coisa errada sobre
 * propriedade de código.
 */
const PROPRIEDADE: Record<ContractModalitySeed, string> = {
  desenvolvimento: `## 9. Da propriedade intelectual

O código-fonte desenvolvido permanece de propriedade da CONTRATADA, sendo
concedida à CONTRATANTE licença de uso do software entregue, em caráter
não exclusivo e por prazo indeterminado.`,

  desenvolvimento_manutencao: `## 9. Da propriedade intelectual e da manutenção

O código-fonte desenvolvido permanece de propriedade da CONTRATADA, sendo
concedida à CONTRATANTE licença de uso do software entregue.

Após a entrega, a CONTRATADA prestará serviços de manutenção corretiva e
evolutiva, cujas condições, periodicidade e valores constam da cláusula 3 ou de
termo aditivo específico.`,

  desenvolvimento_venda_codigo: `## 9. Da cessão do código-fonte

Mediante a quitação integral do valor previsto na cláusula 3, a CONTRATADA cede
à CONTRATANTE a titularidade do código-fonte desenvolvido no âmbito deste
contrato, em caráter definitivo e irrevogável.

A cessão não alcança componentes de terceiros, bibliotecas de código aberto e
ferramentas preexistentes da CONTRATADA, que permanecem sob suas respectivas
licenças.`,
};

const TITULO: Record<ContractModalitySeed, string> = {
  desenvolvimento: 'Contrato de prestação de serviços de desenvolvimento de software',
  desenvolvimento_manutencao:
    'Contrato de prestação de serviços de desenvolvimento e manutenção de software',
  desenvolvimento_venda_codigo:
    'Contrato de desenvolvimento de software com cessão de código-fonte',
};

function montar(modality: ContractModalitySeed): string {
  return [
    `# ${TITULO[modality]}`,
    PARTES,
    ESCOPO,
    VALOR,
    PRAZO,
    OBRIGACOES,
    CONFIDENCIALIDADE,
    RESCISAO,
    PROPRIEDADE[modality],
    FORO,
  ].join('\n\n');
}

export const CONTRACT_TEMPLATE_SEEDS: ReadonlyArray<{
  modality: ContractModalitySeed;
  body: string;
}> = [
  { modality: 'desenvolvimento', body: montar('desenvolvimento') },
  { modality: 'desenvolvimento_manutencao', body: montar('desenvolvimento_manutencao') },
  {
    modality: 'desenvolvimento_venda_codigo',
    body: montar('desenvolvimento_venda_codigo'),
  },
];
