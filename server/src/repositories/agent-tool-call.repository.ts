import { Injectable } from '@nestjs/common';
import { Insertable, Kysely, sql, Updateable } from 'kysely';
import { InjectKysely } from 'nestjs-kysely';
import { columns } from 'src/database';
import { DummyValue, GenerateSql } from 'src/decorators';
import { AgentToolApprovalDecision, AgentToolCallStatus, AgentToolDataClass } from 'src/enum';
import { DB } from 'src/schema';
import { AgentToolCallTable } from 'src/schema/tables/agent-tool-call.table';
import { asUuid } from 'src/utils/database';

type AgentToolCallCreate = Insertable<AgentToolCallTable>;
type AgentToolCallUpdate = Pick<
  Updateable<AgentToolCallTable>,
  | 'status'
  | 'approvalDecision'
  | 'responseSummary'
  | 'redactedResponseMetadata'
  | 'assetCount'
  | 'albumCount'
  | 'completedAt'
  | 'error'
>;

@Injectable()
export class AgentToolCallRepository {
  private static readonly countedStatuses = [
    AgentToolCallStatus.PendingApproval,
    AgentToolCallStatus.Approved,
    AgentToolCallStatus.Executing,
    AgentToolCallStatus.Completed,
  ];

  constructor(@InjectKysely() private db: Kysely<DB>) {}

  create(dto: Insertable<AgentToolCallTable>) {
    return this.db.insertInto('agent_tool_call').values(dto).returning(columns.agentToolCall).executeTakeFirstOrThrow();
  }

  async createPendingReadAssetMetadataWithSessionLimit(
    pendingDto: AgentToolCallCreate,
    deniedDto: AgentToolCallCreate,
    maxAssetsPerSession: number,
  ) {
    return this.createWithSessionLimit(pendingDto, deniedDto, AgentToolDataClass.Metadata, maxAssetsPerSession);
  }

  async createWithSessionLimit(
    dto: AgentToolCallCreate,
    deniedDto: AgentToolCallCreate,
    dataClass: AgentToolDataClass,
    maxAssetsPerSession: number,
  ) {
    return this.db.transaction().execute(async (trx) => {
      await trx
        .selectFrom('agent_session')
        .select('id')
        .where('id', '=', asUuid(dto.sessionId))
        .forUpdate()
        .executeTakeFirstOrThrow();

      const result = await trx
        .selectFrom('agent_tool_call')
        .select((eb) => sql<number>`coalesce(sum(${eb.ref('assetCount')}), 0)::int`.as('assetCount'))
        .where('sessionId', '=', asUuid(dto.sessionId))
        .where('dataClass', '=', dataClass)
        .where('status', 'in', AgentToolCallRepository.countedStatuses)
        .executeTakeFirstOrThrow();

      const insertDto = result.assetCount + Number(dto.assetCount) > maxAssetsPerSession ? deniedDto : dto;
      const toolCall = await trx
        .insertInto('agent_tool_call')
        .values(insertDto)
        .returning(columns.agentToolCall)
        .executeTakeFirstOrThrow();

      return insertDto === deniedDto
        ? ({ status: 'limit-exceeded', toolCall } as const)
        : ({ status: 'created', toolCall } as const);
    });
  }

  async transitionWithSessionLimit(
    sessionId: string,
    id: string,
    expectedStatus: AgentToolCallStatus,
    dto: AgentToolCallUpdate,
    dataClass: AgentToolDataClass,
    maxAssetsPerSession: number,
  ) {
    return this.db.transaction().execute(async (trx) => {
      await trx
        .selectFrom('agent_session')
        .select('id')
        .where('id', '=', asUuid(sessionId))
        .forUpdate()
        .executeTakeFirstOrThrow();

      const result = await trx
        .selectFrom('agent_tool_call')
        .select((eb) => sql<number>`coalesce(sum(${eb.ref('assetCount')}), 0)::int`.as('assetCount'))
        .where('sessionId', '=', asUuid(sessionId))
        .where('dataClass', '=', dataClass)
        .where('status', 'in', AgentToolCallRepository.countedStatuses)
        .where('id', '!=', asUuid(id))
        .executeTakeFirstOrThrow();

      if (result.assetCount + Number(dto.assetCount ?? 0) > maxAssetsPerSession) {
        const toolCall = await trx
          .updateTable('agent_tool_call')
          .set({
            status: AgentToolCallStatus.Denied,
            approvalDecision: AgentToolApprovalDecision.Denied,
            responseSummary: null,
            redactedResponseMetadata: dto.redactedResponseMetadata ?? null,
            completedAt: new Date(),
            error: this.getSessionLimitReason(maxAssetsPerSession),
          })
          .where('sessionId', '=', asUuid(sessionId))
          .where('id', '=', asUuid(id))
          .where('status', '=', expectedStatus)
          .returning(columns.agentToolCall)
          .executeTakeFirst();

        return toolCall ? ({ status: 'limit-exceeded', toolCall } as const) : ({ status: 'stale' } as const);
      }

      const toolCall = await trx
        .updateTable('agent_tool_call')
        .set(dto)
        .where('sessionId', '=', asUuid(sessionId))
        .where('id', '=', asUuid(id))
        .where('status', '=', expectedStatus)
        .returning(columns.agentToolCall)
        .executeTakeFirst();

      return toolCall ? ({ status: 'transitioned', toolCall } as const) : ({ status: 'stale' } as const);
    });
  }

  @GenerateSql({ params: [DummyValue.UUID] })
  getBySessionId(sessionId: string) {
    return this.db
      .selectFrom('agent_tool_call')
      .select(columns.agentToolCall)
      .where('sessionId', '=', asUuid(sessionId))
      .orderBy('startedAt', 'desc')
      .orderBy('id', 'desc')
      .execute();
  }

  @GenerateSql({ params: [DummyValue.UUID, DummyValue.UUID] })
  getByIdForSession(sessionId: string, id: string) {
    return this.db
      .selectFrom('agent_tool_call')
      .select(columns.agentToolCall)
      .where('sessionId', '=', asUuid(sessionId))
      .where('id', '=', asUuid(id))
      .executeTakeFirst();
  }

  @GenerateSql(
    { name: 'including all', params: [DummyValue.UUID] },
    { name: 'excluding tool call', params: [DummyValue.UUID, DummyValue.UUID] },
  )
  async getCountedAssetCountBySession(sessionId: string, excludedToolCallId?: string): Promise<number> {
    return this.getCountedAssetCountBySessionAndDataClass(sessionId, AgentToolDataClass.Metadata, excludedToolCallId);
  }

  @GenerateSql(
    { name: 'including all', params: [DummyValue.UUID, AgentToolDataClass.Metadata] },
    { name: 'excluding tool call', params: [DummyValue.UUID, AgentToolDataClass.Previews, DummyValue.UUID] },
  )
  async getCountedAssetCountBySessionAndDataClass(
    sessionId: string,
    dataClass: AgentToolDataClass,
    excludedToolCallId?: string,
  ): Promise<number> {
    const result = await this.db
      .selectFrom('agent_tool_call')
      .select((eb) => sql<number>`coalesce(sum(${eb.ref('assetCount')}), 0)::int`.as('assetCount'))
      .where('sessionId', '=', asUuid(sessionId))
      .where('dataClass', '=', dataClass)
      .where('status', 'in', AgentToolCallRepository.countedStatuses)
      .$if(Boolean(excludedToolCallId), (qb) => qb.where('id', '!=', asUuid(excludedToolCallId!)))
      .executeTakeFirstOrThrow();

    return result.assetCount;
  }

  transition(sessionId: string, id: string, expectedStatus: AgentToolCallStatus, dto: AgentToolCallUpdate) {
    return this.db
      .updateTable('agent_tool_call')
      .set(dto)
      .where('sessionId', '=', asUuid(sessionId))
      .where('id', '=', asUuid(id))
      .where('status', '=', expectedStatus)
      .returning(columns.agentToolCall)
      .executeTakeFirst();
  }

  private getSessionLimitReason(maxAssetsPerSession: number): string {
    return `Session policy allows at most ${maxAssetsPerSession} assets per session`;
  }
}
