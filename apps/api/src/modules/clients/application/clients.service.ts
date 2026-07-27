import {
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ClientProjectState, Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import {
  COLUMN_OF,
  FUNNEL_COLUMNS,
  type FunnelColumn,
  canTransition,
  isFunnelColumn,
  stateForColumnMove,
} from '../domain/funnel';

export interface ClientInput {
  name: string;
  cpf?: string | null;
  company?: string | null;
  cnpj?: string | null;
  email?: string | null;
  phone?: string | null;
  whatsapp?: string | null;
  zipCode?: string | null;
  street?: string | null;
  district?: string | null;
  city?: string | null;
  state?: string | null;
  notes?: string | null;
}

export interface ClientProjectInput {
  title: string;
  description?: string | null;
}

/** Alvo de uma transição: estado explícito (API) ou coluna (drag-and-drop). */
export interface TransitionInput {
  to?: ClientProjectState;
  column?: string;
}

/**
 * Casos de uso da Frente Clientes (SPEC-029, Fatia 19).
 *
 * As rotas são `/t/:tenant/...`, então o `TenantContextInterceptor` já abriu o
 * `withTenant` e o Proxy do PrismaService roteia `this.prisma.<model>` para o
 * `tx` com contexto — como no board e no activity. Nenhum método aqui abre
 * contexto próprio: fazer isso numa rota escopada abriria transação aninhada.
 * (A exceção do `catalog` é para rota GLOBAL, que não é o caso desta frente.)
 *
 * O `tenantId` vem do `TenantGuard` (derivado da membership), nunca do corpo da
 * request — regra 1 do ADR-020.
 */
@Injectable()
export class ClientsService {
  constructor(private readonly prisma: PrismaService) {}

  // ----------------------------------------------------------------- clientes

  async listClients(tenantId: string, query?: string) {
    // Exclusão é lógica: `deletedAt: null` é o filtro de "existe" em toda
    // leitura. O RLS já corta por tenant, mas o `tenantId` explícito mantém a
    // query correta mesmo num contexto de múltiplos tenants (rota global).
    const where: Prisma.ClientWhereInput = { tenantId, deletedAt: null };

    if (query?.trim()) {
      const q = query.trim();
      // Busca por nome, empresa e CNPJ (critério de aceite da spec).
      where.OR = [
        { name: { contains: q, mode: 'insensitive' } },
        { company: { contains: q, mode: 'insensitive' } },
        { cnpj: { contains: q, mode: 'insensitive' } },
      ];
    }

    return this.prisma.client.findMany({ where, orderBy: { name: 'asc' } });
  }

  async getClient(tenantId: string, id: string) {
    const client = await this.prisma.client.findFirst({
      where: { id, tenantId, deletedAt: null },
      include: {
        projects: {
          where: { deletedAt: null },
          orderBy: { createdAt: 'desc' },
        },
      },
    });
    if (!client) throw new NotFoundException('cliente não encontrado');
    return client;
  }

  async createClient(tenantId: string, input: ClientInput) {
    const client = await this.prisma.client.create({
      data: { ...input, tenantId },
    });
    await this.audit(tenantId, 'client.created', client.id, {
      name: client.name,
    });
    return client;
  }

  async updateClient(tenantId: string, id: string, input: Partial<ClientInput>) {
    // findFirst antes do update: `update` casa por PK e ignoraria o filtro de
    // tenant/deletedAt — num contexto multi-tenant isso deixaria editar linha
    // alheia. O RLS cortaria, mas o erro seria "registro não existe", confuso.
    await this.getClient(tenantId, id);
    const client = await this.prisma.client.update({ where: { id }, data: input });
    await this.audit(tenantId, 'client.updated', id, {
      fields: Object.keys(input),
    });
    return client;
  }

  /** Exclusão LÓGICA: some das listas, a linha e a trilha do funil permanecem. */
  async deleteClient(tenantId: string, id: string) {
    await this.getClient(tenantId, id);
    await this.prisma.client.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
    await this.audit(tenantId, 'client.deleted', id, {});
    return { deleted: true };
  }

  // ------------------------------------------------------- projetos de cliente

  async createProject(
    tenantId: string,
    clientId: string,
    input: ClientProjectInput,
  ) {
    await this.getClient(tenantId, clientId);
    const project = await this.prisma.clientProject.create({
      data: { ...input, clientId },
    });
    await this.audit(tenantId, 'client_project.created', project.id, {
      clientId,
      title: project.title,
    });
    return project;
  }

  /** Composição do Kanban: colunas na ordem, cada card com o cliente embutido. */
  async getBoard(tenantId: string, query?: string) {
    const where: Prisma.ClientProjectWhereInput = {
      deletedAt: null,
      client: { tenantId, deletedAt: null },
    };

    if (query?.trim()) {
      const q = query.trim();
      // Busca do Kanban: por título do projeto, nome do cliente e empresa.
      where.OR = [
        { title: { contains: q, mode: 'insensitive' } },
        { client: { name: { contains: q, mode: 'insensitive' } } },
        { client: { company: { contains: q, mode: 'insensitive' } } },
      ];
    }

    const projects = await this.prisma.clientProject.findMany({
      where,
      include: {
        client: { select: { id: true, name: true, company: true } },
      },
      orderBy: { updatedAt: 'desc' },
    });

    // Projeção estado → coluna acontece aqui, uma vez. A UI recebe colunas
    // prontas e não reimplementa o mapa (que é regra de domínio, MVP3 §9).
    return {
      columns: FUNNEL_COLUMNS.map((column) => ({
        column,
        cards: projects.filter((p) => COLUMN_OF[p.state] === column),
      })),
    };
  }

  async getProject(tenantId: string, id: string) {
    const project = await this.prisma.clientProject.findFirst({
      where: { id, deletedAt: null, client: { tenantId, deletedAt: null } },
      include: { client: { select: { id: true, name: true, company: true } } },
    });
    if (!project) throw new NotFoundException('projeto não encontrado');
    return project;
  }

  async getHistory(tenantId: string, id: string) {
    await this.getProject(tenantId, id);
    return this.prisma.clientStatusTransition.findMany({
      where: { clientProjectId: id },
      orderBy: { at: 'desc' },
    });
  }

  /**
   * Transição de estado — o coração do funil.
   *
   * Aceita alvo por ESTADO (chamada de API) ou por COLUNA (drag-and-drop). Os
   * dois caminhos convergem na MESMA validação: sem isso, arrastar seria a
   * porta dos fundos da máquina de estados.
   *
   * Transição inválida → 422 e nada é gravado (a UI faz rollback do card).
   */
  async transition(
    tenantId: string,
    id: string,
    input: TransitionInput,
    // Nullable: transição disparada pelo próprio sistema não tem usuário por
    // trás (o 1º save do rascunho e o submit do briefing movem o card —
    // SPEC-031 §2). `ClientStatusTransition.actorUserId` já nasceu nullable
    // para este caso; inventar um usuário-robô seria pior que registrar o fato
    // como o que ele é.
    actorUserId: string | null,
  ) {
    const project = await this.getProject(tenantId, id);
    const from = project.state;
    const to = this.resolveTarget(from, input);

    // Alvo nulo = movimento dentro da mesma coluna: no-op deliberado, não erro.
    // Gravar `DRAFT → DRAFT` sujaria a trilha com algo que não aconteceu.
    if (to === null) return project;

    if (!canTransition(from, to)) {
      throw new UnprocessableEntityException(
        `transição inválida: ${from} → ${to}`,
      );
    }

    // Transição e trilha na MESMA transação: um card que muda de estado sem a
    // linha de auditoria correspondente é exatamente o histórico furado que
    // esta frente promete não ter.
    //
    // Forma INTERATIVA, não lote (issue #113 e a guarda
    // `batch-transaction.arch.spec.ts`): sob contexto de tenant, o acesso ao
    // model devolve o delegate do client estendido, que já embrulha cada
    // operação na sua própria transação — um `$transaction([update, create])`
    // sairia em DUAS conexões, sem a atomicidade que a forma aparenta prometer.
    const updated = await this.prisma.$transaction(async (tx) => {
      const project = await tx.clientProject.update({
        where: { id },
        data: { state: to },
      });
      await tx.clientStatusTransition.create({
        data: { clientProjectId: id, fromState: from, toState: to, actorUserId },
      });
      return project;
    });

    await this.audit(tenantId, 'client_project.transitioned', id, { from, to });
    return updated;
  }

  /** Normaliza o alvo: estado explícito vence; coluna traduz pelo domínio. */
  private resolveTarget(
    from: ClientProjectState,
    input: TransitionInput,
  ): ClientProjectState | null {
    if (input.to) return input.to;

    if (input.column) {
      if (!isFunnelColumn(input.column)) {
        throw new UnprocessableEntityException(
          `coluna desconhecida: ${input.column}`,
        );
      }
      return stateForColumnMove(from, input.column as FunnelColumn);
    }

    throw new UnprocessableEntityException('informe `to` ou `column`');
  }

  // -------------------------------------------------------------- auditoria

  /**
   * Trilha append-only (MVP3 §3). Falha aqui NÃO derruba a operação de negócio:
   * perder um evento de auditoria é ruim, mas desfazer uma transição já
   * commitada por causa disso seria pior — e o `$transaction` acima já garante
   * que o fato central (estado + trilha do funil) é atômico.
   */
  private async audit(
    tenantId: string,
    kind: string,
    subject: string,
    payload: Prisma.InputJsonValue,
  ) {
    try {
      await this.prisma.auditEvent.create({
        data: { tenantId, kind, subject, payload },
      });
    } catch {
      // ponytail: silencioso de propósito — o logger do Nest exigiria injetar
      // Logger só para isto. Se auditoria virar requisito duro (contrato,
      // compliance), promover para falha explícita.
    }
  }
}
