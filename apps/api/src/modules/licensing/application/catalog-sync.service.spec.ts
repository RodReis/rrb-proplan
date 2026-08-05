import { ConflictException } from '@nestjs/common';
import { CatalogSyncService, NUNCA_SINCRONIZOU } from './catalog-sync.service';
import type { PrismaService } from '../../../prisma/prisma.service';
import type { CryptoService } from '../../identity/infrastructure/crypto.service';
import type { KiwifyCatalogClient } from '../infrastructure/kiwify-catalog.client';

/**
 * O sync do catálogo (SPEC-047).
 *
 * O que se testa aqui é o que a spec trata como critério de aceite, e todos os
 * casos são sobre **o que a tela vai afirmar**: falha da Kiwify não pode zerar a
 * lista (afirmaria "não falta de-para nenhum", mentira tranquilizadora), tenant
 * sem credencial não pode virar erro vermelho, e o secret tem de ser decifrado
 * antes de sair daqui.
 */
const CREDENCIAIS_OK = {
  kiwifyClientId: 'cli-1',
  kiwifyClientSecret: 'cifrado(seg)',
  kiwifyAccountId: 'acc-1',
};

function montar(over: {
  settings?: unknown;
  snapshot?: unknown;
  token?: jest.Mock;
  catalogo?: jest.Mock;
} = {}) {
  const upsert = jest.fn().mockResolvedValue({});
  const update = jest.fn().mockResolvedValue({});
  const create = jest.fn().mockResolvedValue({});
  const sqlCapturado: string[] = [];

  const prisma = {
    licSettings: {
      findUnique: jest.fn().mockResolvedValue(
        over.settings === undefined ? CREDENCIAIS_OK : over.settings,
      ),
      // Dobrado para o teste provar que **não** é chamado — ver o describe de
      // `tenantsConfigurados` no fim do arquivo.
      findMany: jest.fn().mockResolvedValue([{ tenantId: 't-1' }]),
    },
    $queryRaw: jest.fn(async (frag: TemplateStringsArray) => {
      sqlCapturado.push(frag.join('?'));
      return [{ tenant_id: 't-1' }];
    }),
    licCatalogSnapshot: {
      findUnique: jest.fn().mockResolvedValue(over.snapshot ?? null),
      upsert,
      update,
      create,
    },
  } as unknown as PrismaService;

  const crypto = {
    decrypt: (v: string) => v.replace(/^cifrado\((.*)\)$/, '$1'),
  } as unknown as CryptoService;

  const kiwify = {
    token: over.token ?? jest.fn().mockResolvedValue({ accessToken: 'tok', ttlSegundos: 3600 }),
    catalogo:
      over.catalogo ??
      jest.fn().mockResolvedValue([
        { id: 'p1', name: 'War Room', status: 'active', offers: [{ id: 'o1', name: 'Sem fonte' }] },
      ]),
  } as unknown as KiwifyCatalogClient;

  return {
    service: new CatalogSyncService(prisma, crypto, kiwify),
    prisma,
    kiwify,
    upsert,
    update,
    create,
    get sqlEnumeracao() {
      return sqlCapturado.join(' | ');
    },
  };
}

describe('CatalogSyncService', () => {
  describe('sincronizar', () => {
    it('grava o retrato e limpa o erro anterior', async () => {
      const { service, upsert } = montar();

      await expect(service.sincronizar('t-1')).resolves.toEqual({ ok: true, erro: null });

      const args = upsert.mock.calls[0][0];
      expect(args.where).toEqual({ tenantId: 't-1' });
      expect(args.update.fetchError).toBeNull();
      expect(args.update.payload).toEqual({
        produtos: [{ id: 'p1', name: 'War Room', offers: [{ id: 'o1', name: 'Sem fonte' }] }],
      });
    });

    /**
     * O secret sai decifrado **daqui e de nenhum outro lugar** — o client o
     * recebe em claro e não o registra em log.
     */
    it('decifra o secret antes de passar ao client', async () => {
      const token = jest.fn().mockResolvedValue({ accessToken: 'tok', ttlSegundos: 60 });
      const { service } = montar({ token });

      await service.sincronizar('t-1');

      expect(token).toHaveBeenCalledWith({
        clientId: 'cli-1',
        clientSecret: 'seg',
        accountId: 'acc-1',
      });
    });

    /**
     * **Sem credenciais é silêncio, não erro.** Gravar `fetchError` aqui encheria
     * a tela de vermelho para quem nunca pediu esta funcionalidade.
     */
    it('tenant sem credenciais é pulado sem gravar nada', async () => {
      const { service, upsert, create, update } = montar({
        settings: { kiwifyClientId: null, kiwifyClientSecret: null, kiwifyAccountId: null },
      });

      await expect(service.sincronizar('t-1')).resolves.toEqual({ ok: false, erro: null });

      expect(upsert).not.toHaveBeenCalled();
      expect(create).not.toHaveBeenCalled();
      expect(update).not.toHaveBeenCalled();
    });

    it('duas das três credenciais também é pulado', async () => {
      const { service, upsert } = montar({
        settings: { ...CREDENCIAIS_OK, kiwifyClientSecret: null },
      });

      await expect(service.sincronizar('t-1')).resolves.toEqual({ ok: false, erro: null });
      expect(upsert).not.toHaveBeenCalled();
    });

    /**
     * **O critério de aceite da falha**: o retrato anterior é preservado. Zerar a
     * lista porque a Kiwify caiu faria a aba afirmar *"não falta de-para
     * nenhum"* — e essa é a pior classe de erro nesta área.
     */
    it('falha da Kiwify grava fetchError SEM tocar no payload nem no fetchedAt', async () => {
      const { service, update, upsert } = montar({
        snapshot: { id: 'snap-1' },
        token: jest.fn().mockRejectedValue(new Error('Kiwify recusou as credenciais (401)')),
      });

      const r = await service.sincronizar('t-1');

      expect(r.ok).toBe(false);
      expect(r.erro).toContain('401');
      // `update` só do erro — nada de payload, nada de fetchedAt.
      expect(update).toHaveBeenCalledWith({
        where: { tenantId: 't-1' },
        data: { fetchError: expect.stringContaining('401') },
      });
      expect(upsert).not.toHaveBeenCalled();
    });

    /**
     * Primeira tentativa do tenant, e ela falhou: a linha nasce só para carregar
     * o motivo. Sem ela, quem configurou credencial errada veria "nunca
     * sincronizou" e clicaria de novo em vez de conferir a credencial.
     */
    it('primeira falha, sem snapshot: cria a linha com o motivo e a época', async () => {
      const { service, create } = montar({
        snapshot: null,
        catalogo: jest.fn().mockRejectedValue(new Error('Kiwify respondeu 429')),
      });

      await service.sincronizar('t-1');

      const { data } = create.mock.calls[0][0];
      expect(data.fetchError).toContain('429');
      expect(data.payload).toEqual({ produtos: [] });
      // A época — a leitura a traduz de volta para `fetchedAt: null`.
      expect(data.fetchedAt).toEqual(NUNCA_SINCRONIZOU);
    });

    it('nunca lança por falha da Kiwify — o job de um tenant não derruba os outros', async () => {
      const { service } = montar({
        token: jest.fn().mockRejectedValue(new Error('rede caiu')),
      });

      await expect(service.sincronizar('t-1')).resolves.toBeDefined();
    });
  });

  describe('sincronizarAgora', () => {
    /**
     * A tela desabilita o botão, mas **a rota não pode depender disso**: quem
     * chama a API direto merece a recusa explícita, não um "ok" que não
     * sincronizou nada.
     */
    it('sem credenciais, recusa com 409 em vez de fingir que sincronizou', async () => {
      const { service } = montar({
        settings: { kiwifyClientId: null, kiwifyClientSecret: null, kiwifyAccountId: null },
      });

      await expect(service.sincronizarAgora('t-1')).rejects.toBeInstanceOf(ConflictException);
    });

    it('com credenciais, executa o mesmo fluxo do job', async () => {
      const { service, upsert } = montar();

      await service.sincronizarAgora('t-1');

      expect(upsert).toHaveBeenCalled();
    });

    /**
     * Falha da Kiwify **não** vira erro HTTP: ela vira `fetchError` no corpo, ao
     * lado do retrato anterior. Um `502` aqui diria "o ProPlan quebrou" sobre um
     * problema que é da plataforma ou da credencial.
     */
    it('falha da Kiwify não propaga como exceção pela rota', async () => {
      const { service } = montar({
        snapshot: { id: 'snap-1' },
        token: jest.fn().mockRejectedValue(new Error('502 da Kiwify')),
      });

      await expect(service.sincronizarAgora('t-1')).resolves.toBeUndefined();
    });
  });

  describe('tenantsConfigurados', () => {
    /**
     * **Este teste é o cadáver do defeito, e vale ler como aviso.**
     *
     * Ele existia antes, afirmava o `where` do `licSettings.findMany` e passava
     * — enquanto em produção a consulta devolvia **zero linhas** desde que o job
     * foi ligado: `proplan_app` é `NOBYPASSRLS` e a enumeração roda fora de
     * `runInTenantContext`. **Mock de Prisma não tem RLS**, então ele provava a
     * intenção da consulta, nunca o efeito dela.
     *
     * Agora afirma a FORMA — que a enumeração passa pela função
     * `SECURITY DEFINER` (ADR-030). O EFEITO é do
     * `licensing-tenant-enumeration.int-spec.ts`, contra Postgres real, que é o
     * único lugar onde este defeito era detectável.
     */
    it('enumera pela função `SECURITY DEFINER`, nunca por leitura direta', async () => {
      const c = montar();

      await expect(c.service.tenantsConfigurados()).resolves.toEqual(['t-1']);

      expect(c.sqlEnumeracao).toMatch(/lic_tenants_with_kiwify_credentials\(\)/);
      expect(c.prisma.licSettings.findMany).not.toHaveBeenCalled();
    });
  });
});
