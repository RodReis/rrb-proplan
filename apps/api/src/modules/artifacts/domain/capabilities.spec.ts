import {
  CAPABILITIES,
  InvalidArtifactError,
  buildUserMessage,
} from './capabilities';
import { ARTIFACT_KINDS } from './artifact-kind';

const capOf = (kind: string) => CAPABILITIES.find((c) => c.kind === kind)!;

describe('CAPABILITIES: as 4 geradoras (SPEC-032 §2.3)', () => {
  it('cobre exatamente os 4 kinds, na ordem de execução', () => {
    expect(CAPABILITIES.map((c) => c.kind)).toEqual([...ARTIFACT_KINDS]);
  });

  it('cada capacidade consome só as anteriores a ela', () => {
    // A ordem é contrato: se `scope` declarasse consumir `requirements`, o
    // pipeline sequencial passaria `undefined` e o prompt sairia sem a parte
    // que o texto promete.
    CAPABILITIES.forEach((cap, i) => {
      const anteriores = CAPABILITIES.slice(0, i).map((c) => c.kind);
      cap.consumes.forEach((dep) => expect(anteriores).toContain(dep));
    });
  });

  it('cada capacidade tem promptVersion própria', () => {
    // Global seria pior: corrigir o `scope` invalidaria o `normalize`, que
    // ninguém mexeu, e regeneraria (pagando) artefato idêntico.
    const versoes = CAPABILITIES.map((c) => c.promptVersion);
    expect(new Set(versoes).size).toBe(CAPABILITIES.length);
  });

  it('todo prompt proíbe estimar horas, prazo ou preço', () => {
    // ADR-012 e MVP3 §9: o LLM decompõe, o código calcula. Um modelo que
    // "estima 40 horas" produz número plausível e não auditável, e estimativa é
    // da SPEC-033, onde a conta é determinística.
    CAPABILITIES.forEach((cap) => {
      expect(cap.system).toMatch(/NÃO estime horas, prazos ou preços/);
    });
  });
});

describe('parse: resposta que não valida nunca vira artefato (§2.5)', () => {
  it('aceita JSON cercado em ```json e com prosa em volta', () => {
    // Modelo não obedece "responda só JSON" de forma confiável. Recusar por
    // causa da cortesia gastaria um retry que também poderia vir com cortesia.
    const texto =
      'Claro! Aqui está:\n```json\n' +
      JSON.stringify({
        resumo: 'r',
        objetivo: 'o',
        publico: 'p',
        pontosNaoInformados: [],
      }) +
      '\n```\nEspero ter ajudado.';
    expect(capOf('normalize').parse(texto)).toMatchObject({ resumo: 'r' });
  });

  it('recusa texto sem objeto JSON', () => {
    expect(() => capOf('normalize').parse('desculpe, não posso')).toThrow(
      InvalidArtifactError,
    );
  });

  it('recusa JSON malformado', () => {
    expect(() => capOf('normalize').parse('{"resumo": ')).toThrow(InvalidArtifactError);
  });

  it('recusa campo obrigatório ausente', () => {
    const texto = JSON.stringify({ objetivo: 'o', publico: 'p', pontosNaoInformados: [] });
    expect(() => capOf('normalize').parse(texto)).toThrow(/resumo/);
  });

  it('recusa campo obrigatório vazio', () => {
    // String vazia passaria num `typeof === 'string'` e viraria artefato com
    // seção em branco — defeito que só aparece para quem lê.
    const texto = JSON.stringify({
      resumo: '   ',
      objetivo: 'o',
      publico: 'p',
      pontosNaoInformados: [],
    });
    expect(() => capOf('normalize').parse(texto)).toThrow(/resumo/);
  });

  it('recusa lista com item vazio', () => {
    const texto = JSON.stringify({
      entregaveis: ['site', ''],
      foraDeEscopo: [],
      premissas: [],
      riscos: [],
    });
    expect(() => capOf('scope').parse(texto)).toThrow(/entregaveis/);
  });

  it('aceita lista vazia onde vazio é RESULTADO, não falha', () => {
    // Um briefing completo não tem pontos faltando. Exigir ao menos um item
    // obrigaria o modelo a inventar uma lacuna para satisfazer o schema.
    const texto = JSON.stringify({
      resumo: 'r',
      objetivo: 'o',
      publico: 'p',
      pontosNaoInformados: [],
    });
    expect(capOf('normalize').parse(texto)).toMatchObject({ pontosNaoInformados: [] });
  });

  it('scope exige ao menos um entregável', () => {
    const texto = JSON.stringify({
      entregaveis: [],
      foraDeEscopo: [],
      premissas: [],
      riscos: [],
    });
    expect(() => capOf('scope').parse(texto)).toThrow(/entregaveis/);
  });
});

describe('requirements: a prioridade é consumida pela SPEC-033', () => {
  const req = (prioridade: string) =>
    JSON.stringify({
      requisitos: [{ titulo: 't', descricao: 'd', prioridade }],
    });

  it.each(['essencial', 'importante', 'desejavel'])('aceita "%s"', (p) => {
    expect(capOf('requirements').parse(req(p))).toMatchObject({
      requisitos: [{ prioridade: p }],
    });
  });

  it('recusa prioridade fora da lista, nomeando o valor recebido', () => {
    // "alta" e "média" são o que um modelo produz naturalmente. Passariam como
    // texto e quebrariam na SPEC-033, longe daqui — barrar na origem é o que
    // impede o defeito de viajar.
    expect(() => capOf('requirements').parse(req('alta'))).toThrow(/alta/);
  });

  it('recusa lista de requisitos vazia', () => {
    expect(() => capOf('requirements').parse('{"requisitos": []}')).toThrow(
      /requisitos/,
    );
  });

  it('nomeia qual requisito falhou', () => {
    const texto = JSON.stringify({
      requisitos: [
        { titulo: 'ok', descricao: 'd', prioridade: 'essencial' },
        { titulo: 'ruim', descricao: 'd', prioridade: 'urgente' },
      ],
    });
    expect(() => capOf('requirements').parse(texto)).toThrow(/requisito 2/);
  });
});

describe('buildUserMessage: monta o insumo da capacidade', () => {
  const answers = { 1: { produto: 'site' } };

  it('a primeira da cadeia recebe só o briefing', () => {
    const msg = buildUserMessage(capOf('normalize'), answers, {});
    expect(msg).toContain('Briefing do cliente');
    expect(msg).not.toContain('## normalize');
  });

  it('inclui as saídas que a capacidade declara consumir', () => {
    const msg = buildUserMessage(capOf('scope'), answers, {
      normalize: { resumo: 'r' },
    });
    expect(msg).toContain('## normalize');
    expect(msg).toContain('"resumo": "r"');
  });

  it('não inclui saída que a capacidade NÃO declara consumir', () => {
    // `normalize` não lê `scope`. Vazar a saída de uma capacidade posterior no
    // prompt de uma anterior seria contaminar o insumo — e o `inputHash` já
    // teria sido calculado sem ela.
    const msg = buildUserMessage(capOf('normalize'), answers, {
      scope: { entregaveis: ['x'] },
    });
    expect(msg).not.toContain('entregaveis');
  });
});
