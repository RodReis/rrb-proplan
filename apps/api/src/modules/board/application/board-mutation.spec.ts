import { ForbiddenException } from '@nestjs/common';
import { Role } from '@prisma/client';
import { BoardMutationService, MutationInput, closesIssue } from './board-mutation.service';

describe('closesIssue', () => {
  it('mover para finalized fecha a issue', () => {
    expect(closesIssue({ type: 'move_column', number: 1, toColumn: 'finalized' })).toBe(true);
  });
  it('mover para discarded fecha a issue', () => {
    expect(closesIssue({ type: 'move_column', number: 1, toColumn: 'discarded' })).toBe(true);
  });
  it('discard_card fecha a issue', () => {
    expect(closesIssue({ type: 'discard_card', number: 1 })).toBe(true);
  });
  it('mover para doing NÃO fecha', () => {
    expect(closesIssue({ type: 'move_column', number: 1, toColumn: 'doing' })).toBe(false);
  });
  it('mover para done (entregue, aguarda aceite) NÃO fecha', () => {
    // done = entregue, ainda aberto (ADR-011). Não é fechamento.
    expect(closesIssue({ type: 'move_column', number: 1, toColumn: 'done' })).toBe(false);
  });
  it('create_card e edit_card não fecham', () => {
    expect(closesIssue({ type: 'create_card', title: 't', column: 'todo' })).toBe(false);
    expect(closesIssue({ type: 'edit_card', number: 1, title: 't' })).toBe(false);
  });
});

describe('BoardMutationService.enqueue: gate owner na finalização', () => {
  function makeService() {
    const project = { id: 'p1', installationStatus: 'active', tenantId: 't1' };
    const prisma = {
      project: { findFirst: jest.fn().mockResolvedValue(project) },
      boardMutation: { create: jest.fn().mockResolvedValue({ id: 'm1' }) },
    };
    const queue = { add: jest.fn().mockResolvedValue(undefined) };
    const svc = new BoardMutationService(prisma as never, queue as never);
    return { svc, prisma, queue };
  }

  const finalize: MutationInput = { type: 'move_column', number: 1, toColumn: 'finalized' };
  const move: MutationInput = { type: 'move_column', number: 1, toColumn: 'doing' };

  it('owner finaliza com sucesso (enfileira)', async () => {
    const { svc, queue } = makeService();
    await expect(svc.enqueue('u1', 'p1', finalize, 'owner' as Role)).resolves.toEqual({
      mutationId: 'm1',
    });
    expect(queue.add).toHaveBeenCalled();
  });

  it('member tentar finalizar → 403, NÃO enfileira', async () => {
    const { svc, queue } = makeService();
    await expect(svc.enqueue('u1', 'p1', finalize, 'member' as Role)).rejects.toThrow(
      ForbiddenException,
    );
    expect(queue.add).not.toHaveBeenCalled();
  });

  it('viewer tentar finalizar → 403', async () => {
    const { svc } = makeService();
    await expect(svc.enqueue('u1', 'p1', finalize, 'viewer' as Role)).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('member move card normal (não-terminal) com sucesso', async () => {
    const { svc, queue } = makeService();
    await expect(svc.enqueue('u1', 'p1', move, 'member' as Role)).resolves.toEqual({
      mutationId: 'm1',
    });
    expect(queue.add).toHaveBeenCalled();
  });

  it('o gate roda ANTES de tocar o banco (nenhuma leitura de projeto no caminho barrado)', async () => {
    const { svc, prisma } = makeService();
    await expect(svc.enqueue('u1', 'p1', finalize, 'member' as Role)).rejects.toThrow();
    expect(prisma.project.findFirst).not.toHaveBeenCalled();
  });
});
