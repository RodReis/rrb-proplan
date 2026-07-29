import {
  generateKey,
  hashKey,
  isWellFormedKey,
  normalizeKey,
  updatesUntil,
} from './license-key';

describe('SPEC-036: chave de licença', () => {
  describe('generateKey', () => {
    it('produz o formato `<prefixo>-XXXX-XXXX-XXXX-XXXX`', () => {
      expect(generateKey('WR')).toMatch(/^WR(-[2-9A-HJ-NP-Z]{4}){4}$/);
    });

    it('usa o prefixo do produto, não um fixo', () => {
      // MVP4 §4: o prefixo vem do `LicProduct`. Um valor fixo aqui faria o
      // segundo produto do tenant emitir chave com o prefixo do primeiro.
      expect(generateKey('PP').startsWith('PP-')).toBe(true);
    });

    it('nunca usa os caracteres ambíguos 0, O, 1 e I', () => {
      // A chave é DIGITADA por gente. Um comprador que lê `O` onde havia `0`
      // recebe 404 numa licença que existe e abre chamado de suporte.
      const amostra = Array.from({ length: 300 }, () => generateKey('WR')).join('');
      expect(amostra).not.toMatch(/[01OI]/);
    });

    it('não repete chave em 1000 gerações', () => {
      // Não prova o CSPRNG — prova que não há estado compartilhado nem semente
      // fixa, que é como uma geração "aleatória" costuma falhar na prática.
      const chaves = new Set(Array.from({ length: 1000 }, () => generateKey('WR')));
      expect(chaves.size).toBe(1000);
    });
  });

  describe('normalizeKey', () => {
    it.each([
      ['wr-ab23-cd45-ef67-gh89', 'WR-AB23-CD45-EF67-GH89'],
      ['  WR-AB23-CD45-EF67-GH89  ', 'WR-AB23-CD45-EF67-GH89'],
      ['Wr-Ab23-cD45-eF67-Gh89', 'WR-AB23-CD45-EF67-GH89'],
    ])('canoniza %s', (entrada, esperado) => {
      expect(normalizeKey(entrada)).toBe(esperado);
    });

    it('NÃO remove hífen — a chave tem uma forma válida só', () => {
      // Aceitar `WRAB23...` faria a chave ter mais de uma forma válida, e a
      // normalização viraria parte do formato em vez da higiene dele.
      expect(normalizeKey('WRAB23CD45EF67GH89')).toBe('WRAB23CD45EF67GH89');
    });
  });

  describe('hashKey', () => {
    it('é estável e devolve SHA-256 em hex', () => {
      const h = hashKey('WR-AB23-CD45-EF67-GH89');
      expect(h).toMatch(/^[0-9a-f]{64}$/);
      expect(hashKey('WR-AB23-CD45-EF67-GH89')).toBe(h);
    });

    it('a chave digitada em minúscula acha a MESMA licença', () => {
      // O modo de falhar mais caro desta fatia: `wr-...` e `WR-...` com hashes
      // diferentes fariam a segunda dar 404 numa licença que existe — e parece
      // erro do comprador, não do produto.
      expect(hashKey('wr-ab23-cd45-ef67-gh89')).toBe(
        hashKey('WR-AB23-CD45-EF67-GH89'),
      );
      expect(hashKey('  WR-AB23-CD45-EF67-GH89 ')).toBe(
        hashKey('WR-AB23-CD45-EF67-GH89'),
      );
    });

    it('chaves diferentes dão hashes diferentes', () => {
      expect(hashKey('WR-AB23-CD45-EF67-GH89')).not.toBe(
        hashKey('WR-AB23-CD45-EF67-GH88'),
      );
    });

    it('não devolve a chave em claro em lugar nenhum do resultado', () => {
      // A garantia central da fatia: o que persiste não pode conter o segredo.
      const chave = 'WR-AB23-CD45-EF67-GH89';
      expect(hashKey(chave)).not.toContain('AB23');
    });
  });

  describe('isWellFormedKey', () => {
    it('aceita o que o gerador produz', () => {
      for (let i = 0; i < 50; i += 1) {
        expect(isWellFormedKey(generateKey('WR'), 'WR')).toBe(true);
      }
    });

    it('aceita a chave digitada em minúscula', () => {
      expect(isWellFormedKey('wr-ab23-cd45-ef67-gh89', 'WR')).toBe(true);
    });

    it.each([
      ['string vazia', ''],
      ['só o prefixo', 'WR'],
      ['grupos de menos', 'WR-AB23-CD45-EF67'],
      ['grupos de mais', 'WR-AB23-CD45-EF67-GH89-JK23'],
      ['grupo curto', 'WR-AB2-CD45-EF67-GH89'],
      ['prefixo de outro produto', 'PP-AB23-CD45-EF67-GH89'],
      ['caractere ambíguo (zero)', 'WR-AB20-CD45-EF67-GH89'],
      ['caractere ambíguo (i maiúsculo)', 'WR-ABI3-CD45-EF67-GH89'],
      ['URL colada por engano', 'https://exemplo.com/x'],
    ])('recusa %s', (_caso, entrada) => {
      expect(isWellFormedKey(entrada, 'WR')).toBe(false);
    });
  });

  describe('updatesUntil', () => {
    it('soma os meses da edição à emissão', () => {
      expect(updatesUntil(new Date('2026-07-29T12:00:00Z'), 12)).toEqual(
        new Date('2027-07-29T12:00:00Z'),
      );
    });

    it('vira o ano sem conta de milissegundos', () => {
      expect(updatesUntil(new Date('2026-11-15T00:00:00Z'), 3)).toEqual(
        new Date('2027-02-15T00:00:00Z'),
      );
    });

    it('mês curto arredonda a favor do comprador', () => {
      // 31/01 + 1 mês cai em 03/03 (fevereiro não tem dia 31) — o dia a mais
      // fica com quem comprou, que é o lado certo de arredondar.
      const fim = updatesUntil(new Date('2026-01-31T00:00:00Z'), 1);
      expect(fim.toISOString().slice(0, 10)).toBe('2026-03-03');
    });

    it('não altera a data de origem', () => {
      const emissao = new Date('2026-07-29T12:00:00Z');
      updatesUntil(emissao, 12);
      expect(emissao.toISOString()).toBe('2026-07-29T12:00:00.000Z');
    });
  });
});
