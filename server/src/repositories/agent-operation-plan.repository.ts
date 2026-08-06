import { Injectable } from '@nestjs/common';
import { Insertable, Kysely, sql, Transaction } from 'kysely';
import { InjectKysely } from 'nestjs-kysely';
import { columns } from 'src/database';
import { DummyValue, GenerateSql } from 'src/decorators';
import {
  AgentOperationPlanStatus,
  AgentOperationStatus,
  AgentOperationTargetKind,
  AgentOperationType,
  AgentSessionStatus,
} from 'src/enum';
import { DB } from 'src/schema';
import { AgentOperationPlanTable } from 'src/schema/tables/agent-operation-plan.table';
import { AgentOperationTable } from 'src/schema/tables/agent-operation.table';
import { AgentAlbumOperationInput, AgentOperationResult } from 'src/types/agent-operation.types';
import { asUuid } from 'src/utils/database';

type AgentOperationPlanCreateRevision = {
  plan: {
    sessionId: string;
    revision: number;
    status: AgentOperationPlanStatus;
    summary: string;
  };
  operations: AgentAlbumOperationInput[];
};

type AgentOperationPlanCreateReplacement = {
  plan: {
    sessionId: string;
    status: AgentOperationPlanStatus;
    summary: string;
  };
  operations: AgentAlbumOperationInput[];
};
type DatabaseOrTransaction = Kysely<DB> | Transaction<DB>;
type AgentOperationPlanRow = Awaited<ReturnType<AgentOperationPlanRepository['insertPlan']>>;
type AgentOperationRow = Awaited<ReturnType<AgentOperationPlanRepository['insertOperation']>>;
export type AgentOperationPlanWithOperations = AgentOperationPlanRow & { operations: AgentOperationRow[] };
export type AgentOperationApplyUpdate = {
  id: string;
  status: AgentOperationStatus;
  result: AgentOperationResult | null;
  error: string | null;
};

@Injectable()
export class AgentOperationPlanRepository {
  constructor(@InjectKysely() private db: Kysely<DB>) {}

  createRevision(dto: AgentOperationPlanCreateRevision) {
    return this.db.transaction().execute((trx) => this.createRevisionInTransaction(trx, dto));
  }

  async createReplacementRevision(sessionId: string, dto: AgentOperationPlanCreateReplacement) {
    return this.db.transaction().execute(async (trx) => {
      const session = await this.lockSession(trx, sessionId);
      if (
        [
          AgentSessionStatus.Applying,
          AgentSessionStatus.Completed,
          AgentSessionStatus.Cancelled,
          AgentSessionStatus.Interrupted,
          AgentSessionStatus.Failed,
        ].includes(session.status)
      ) {
        return;
      }

      const revision = await this.getNextRevisionInTransaction(trx, sessionId);

      await trx
        .updateTable('agent_operation_plan')
        .set({ status: AgentOperationPlanStatus.Superseded })
        .where('sessionId', '=', asUuid(sessionId))
        .where('status', '=', AgentOperationPlanStatus.Proposed)
        .execute();

      return this.createRevisionInTransaction(trx, { ...dto, plan: { ...dto.plan, sessionId, revision } });
    });
  }

  @GenerateSql({ params: [DummyValue.UUID] })
  getNextRevision(sessionId: string) {
    return this.getNextRevisionInTransaction(this.db, sessionId);
  }

  @GenerateSql({ params: [DummyValue.UUID, DummyValue.UUID] })
  async getByIdForSession(sessionId: string, id: string): Promise<AgentOperationPlanWithOperations | undefined> {
    const plan = await this.db
      .selectFrom('agent_operation_plan')
      .select(columns.agentOperationPlan)
      .where('sessionId', '=', asUuid(sessionId))
      .where('id', '=', asUuid(id))
      .executeTakeFirst();

    return plan ? this.withOperations(plan) : undefined;
  }

  @GenerateSql({ params: [DummyValue.UUID] })
  async getCurrentBySessionId(sessionId: string): Promise<AgentOperationPlanWithOperations | undefined> {
    const plan = await this.db
      .selectFrom('agent_operation_plan')
      .select(columns.agentOperationPlan)
      .where('sessionId', '=', asUuid(sessionId))
      .where('status', '=', AgentOperationPlanStatus.Proposed)
      .orderBy('revision', 'desc')
      .executeTakeFirst();

    return plan ? this.withOperations(plan) : undefined;
  }

  @GenerateSql({ params: [DummyValue.UUID] })
  async getAppliedBySessionId(sessionId: string): Promise<AgentOperationPlanWithOperations[]> {
    const plans = await this.db
      .selectFrom('agent_operation_plan')
      .select(columns.agentOperationPlan)
      .where('sessionId', '=', asUuid(sessionId))
      .where('status', '=', AgentOperationPlanStatus.Applied)
      .orderBy('updatedAt', 'asc')
      .orderBy('revision', 'asc')
      .orderBy('id', 'asc')
      .execute();

    return Promise.all(plans.map((plan) => this.withOperations(plan)));
  }

  async claimCurrentForApply(sessionId: string, planId: string): Promise<AgentOperationPlanWithOperations | undefined> {
    return this.db.transaction().execute(async (trx) => {
      const session = await this.lockSession(trx, sessionId);
      if (session.status !== AgentSessionStatus.WaitingForPlanReview) {
        return;
      }

      const plan = await trx
        .selectFrom('agent_operation_plan')
        .select(columns.agentOperationPlan)
        .where('sessionId', '=', asUuid(sessionId))
        .where('id', '=', asUuid(planId))
        .where('status', '=', AgentOperationPlanStatus.Proposed)
        .forUpdate()
        .executeTakeFirst();

      if (!plan) {
        return;
      }

      await trx
        .updateTable('agent_session')
        .set({ status: AgentSessionStatus.Applying })
        .where('id', '=', asUuid(sessionId))
        .execute();

      const appliedPlan = await trx
        .updateTable('agent_operation_plan')
        .set({ status: AgentOperationPlanStatus.Applied })
        .where('id', '=', asUuid(plan.id))
        .returning(columns.agentOperationPlan)
        .executeTakeFirstOrThrow();

      return this.withOperationsFrom(trx, appliedPlan);
    });
  }

  async completeApply(planId: string, updates: AgentOperationApplyUpdate[]) {
    return this.db.transaction().execute(async (trx) => {
      for (const update of updates) {
        await trx
          .updateTable('agent_operation')
          .set({
            status: update.status,
            result: update.result,
            error: update.error,
          })
          .where('planId', '=', asUuid(planId))
          .where('id', '=', asUuid(update.id))
          .execute();
      }

      const plan = await trx
        .selectFrom('agent_operation_plan')
        .select(columns.agentOperationPlan)
        .where('id', '=', asUuid(planId))
        .executeTakeFirstOrThrow();

      return this.withOperationsFrom(trx, plan);
    });
  }

  private async createRevisionInTransaction(
    trx: Transaction<DB>,
    dto: AgentOperationPlanCreateRevision,
  ): Promise<AgentOperationPlanWithOperations> {
    const plan = await this.insertPlan(trx, {
      sessionId: dto.plan.sessionId,
      revision: dto.plan.revision,
      status: dto.plan.status,
      summary: dto.plan.summary,
    });
    const operations = await this.insertOperations(trx, plan.id, dto.operations);

    return { ...plan, operations };
  }

  private async insertOperations(trx: Transaction<DB>, planId: string, operations: AgentAlbumOperationInput[]) {
    const createdOperations: AgentOperationRow[] = [];
    const createOperationIdByTemporaryTargetId = new Map<string, string>();

    for (const [position, operation] of operations.entries()) {
      if (
        operation.type === AgentOperationType.AlbumCreate &&
        operation.temporaryTargetId &&
        createOperationIdByTemporaryTargetId.has(operation.temporaryTargetId)
      ) {
        throw new Error(`Duplicate album.create temporary target ${operation.temporaryTargetId}`);
      }

      const created = await this.insertOperation(trx, {
        planId,
        type: operation.type,
        position,
        summary: operation.summary,
        targetKind: operation.targetKind,
        targetId: operation.targetId ?? null,
        temporaryTargetId: operation.temporaryTargetId ?? null,
        assetIds: operation.assetIds ?? [],
        payload: operation.payload ?? {},
        dependencyIds: [],
        riskLevel: operation.riskLevel,
        enabled: operation.enabled,
        status: AgentOperationStatus.Proposed,
        result: null,
        error: null,
      });

      if (operation.type === AgentOperationType.AlbumCreate && operation.temporaryTargetId) {
        createOperationIdByTemporaryTargetId.set(operation.temporaryTargetId, created.id);
      }

      createdOperations.push(created);
    }

    const pendingDependencyUpdates = createdOperations
      .map((operation) => {
        const dependencyId =
          operation.temporaryTargetId && operation.type !== AgentOperationType.AlbumCreate
            ? createOperationIdByTemporaryTargetId.get(operation.temporaryTargetId)
            : undefined;
        if (
          operation.targetKind === AgentOperationTargetKind.NewAlbum &&
          operation.type !== AgentOperationType.AlbumCreate &&
          !dependencyId
        ) {
          throw new Error(`Missing album.create operation for temporary target ${operation.temporaryTargetId}`);
        }
        const dependencyIds = dependencyId ? [dependencyId] : [];

        return { id: operation.id, dependencyIds };
      })
      .filter(({ dependencyIds }) => dependencyIds.length > 0);

    for (const dependencyUpdate of pendingDependencyUpdates) {
      await trx
        .updateTable('agent_operation')
        .set({ dependencyIds: dependencyUpdate.dependencyIds })
        .where('id', '=', asUuid(dependencyUpdate.id))
        .execute();
    }

    return createdOperations.map((operation) => {
      const dependencyUpdate = pendingDependencyUpdates.find(({ id }) => id === operation.id);
      return dependencyUpdate ? { ...operation, dependencyIds: dependencyUpdate.dependencyIds } : operation;
    });
  }

  private insertPlan(trx: DatabaseOrTransaction, dto: Insertable<AgentOperationPlanTable>) {
    return trx
      .insertInto('agent_operation_plan')
      .values(dto)
      .returning(columns.agentOperationPlan)
      .executeTakeFirstOrThrow();
  }

  private insertOperation(trx: DatabaseOrTransaction, dto: Insertable<AgentOperationTable>) {
    return trx.insertInto('agent_operation').values(dto).returning(columns.agentOperation).executeTakeFirstOrThrow();
  }

  private withOperations(plan: AgentOperationPlanRow): Promise<AgentOperationPlanWithOperations> {
    return this.withOperationsFrom(this.db, plan);
  }

  private async withOperationsFrom(
    db: DatabaseOrTransaction,
    plan: AgentOperationPlanRow,
  ): Promise<AgentOperationPlanWithOperations> {
    const operations = await db
      .selectFrom('agent_operation')
      .select(columns.agentOperation)
      .where('planId', '=', asUuid(plan.id))
      .orderBy('position', 'asc')
      .execute();

    return { ...plan, operations };
  }

  private async getNextRevisionInTransaction(db: DatabaseOrTransaction, sessionId: string): Promise<number> {
    const result = await db
      .selectFrom('agent_operation_plan')
      .select((eb) => sql<number>`coalesce(max(${eb.ref('revision')}), 0)::int + 1`.as('revision'))
      .where('sessionId', '=', asUuid(sessionId))
      .executeTakeFirstOrThrow();

    return result.revision;
  }

  private lockSession(trx: Transaction<DB>, sessionId: string) {
    return trx
      .selectFrom('agent_session')
      .select(['id', 'status'])
      .where('id', '=', asUuid(sessionId))
      .forUpdate()
      .executeTakeFirstOrThrow();
  }
}
