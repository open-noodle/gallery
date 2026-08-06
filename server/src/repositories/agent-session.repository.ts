import { Injectable } from '@nestjs/common';
import { Insertable, Kysely, Updateable } from 'kysely';
import { InjectKysely } from 'nestjs-kysely';
import { columns } from 'src/database';
import { DummyValue, GenerateSql } from 'src/decorators';
import { AgentSessionStatus } from 'src/enum';
import { DB } from 'src/schema';
import { AgentSessionTable } from 'src/schema/tables/agent-session.table';
import { asUuid } from 'src/utils/database';

type AgentSessionUpdate = Pick<
  Updateable<AgentSessionTable>,
  'status' | 'endedAt' | 'runnerEndpoint' | 'runnerSessionId' | 'runnerCapabilitiesSnapshot'
>;
type AgentSessionMetadataUpdate = Pick<Updateable<AgentSessionTable>, 'title'>;
type AgentSessionWorkflowState = Updateable<AgentSessionTable>['workflowState'];
type AgentSessionMarkRunning = Pick<
  Updateable<AgentSessionTable>,
  'status' | 'runnerEndpoint' | 'runnerSessionId' | 'runnerCapabilitiesSnapshot'
>;

@Injectable()
export class AgentSessionRepository {
  private static readonly cancellableStatuses = [
    AgentSessionStatus.Created,
    AgentSessionStatus.Running,
    AgentSessionStatus.WaitingForToolApproval,
    AgentSessionStatus.WaitingForPlanReview,
    AgentSessionStatus.Interrupted,
  ];
  private static readonly interruptibleStatuses = [
    AgentSessionStatus.Running,
    AgentSessionStatus.WaitingForToolApproval,
    AgentSessionStatus.WaitingForPlanReview,
    AgentSessionStatus.Interrupted,
  ];

  constructor(@InjectKysely() private db: Kysely<DB>) {}

  create(dto: Insertable<AgentSessionTable>) {
    return this.db.insertInto('agent_session').values(dto).returning(columns.agentSession).executeTakeFirstOrThrow();
  }

  @GenerateSql({ params: [DummyValue.UUID] })
  getByUserId(userId: string) {
    return this.db
      .selectFrom('agent_session')
      .select(columns.agentSession)
      .where('userId', '=', userId)
      .orderBy('createdAt', 'desc')
      .orderBy('id', 'desc')
      .execute();
  }

  @GenerateSql({ params: [DummyValue.UUID, DummyValue.UUID] })
  getById(userId: string, id: string) {
    return this.db
      .selectFrom('agent_session')
      .select(columns.agentSession)
      .where('userId', '=', userId)
      .where('id', '=', asUuid(id))
      .executeTakeFirst();
  }

  update(userId: string, id: string, dto: AgentSessionUpdate) {
    return this.db
      .updateTable('agent_session')
      .set(dto)
      .where('userId', '=', userId)
      .where('id', '=', asUuid(id))
      .returning(columns.agentSession)
      .executeTakeFirstOrThrow();
  }

  updateMetadata(userId: string, id: string, dto: AgentSessionMetadataUpdate) {
    return this.db
      .updateTable('agent_session')
      .set(dto)
      .where('userId', '=', userId)
      .where('id', '=', asUuid(id))
      .returning(columns.agentSession)
      .executeTakeFirstOrThrow();
  }

  setWorkflowState(userId: string, id: string, workflowState: AgentSessionWorkflowState) {
    return this.db
      .updateTable('agent_session')
      .set({ workflowState })
      .where('userId', '=', userId)
      .where('id', '=', asUuid(id))
      .returning(columns.agentSession)
      .executeTakeFirstOrThrow();
  }

  async delete(userId: string, id: string) {
    const result = await this.db
      .deleteFrom('agent_session')
      .where('userId', '=', userId)
      .where('id', '=', asUuid(id))
      .executeTakeFirst();

    return Number(result.numDeletedRows) > 0;
  }

  @GenerateSql({
    params: [
      DummyValue.UUID,
      DummyValue.UUID,
      {
        status: AgentSessionStatus.Running,
        runnerEndpoint: 'http://agent-runner:4477',
        runnerSessionId: 'stub-00000000-0000-4000-8000-000000000100',
        runnerCapabilitiesSnapshot: {
          protocolVersion: '2026-05-14',
          streaming: true,
          tools: ['echo'],
          models: [],
        },
      },
    ],
  })
  markRunningFromCreated(userId: string, id: string, dto: AgentSessionMarkRunning) {
    return this.db
      .updateTable('agent_session')
      .set(dto)
      .where('userId', '=', userId)
      .where('id', '=', asUuid(id))
      .where('status', '=', AgentSessionStatus.Created)
      .returning(columns.agentSession)
      .executeTakeFirst();
  }

  @GenerateSql({
    params: [DummyValue.UUID, DummyValue.UUID, DummyValue.DATE],
  })
  markFailedFromCreated(userId: string, id: string, endedAt: Date) {
    return this.db
      .updateTable('agent_session')
      .set({ status: AgentSessionStatus.Failed, endedAt })
      .where('userId', '=', userId)
      .where('id', '=', asUuid(id))
      .where('status', '=', AgentSessionStatus.Created)
      .returning(columns.agentSession)
      .executeTakeFirst();
  }

  @GenerateSql({
    params: [DummyValue.UUID, DummyValue.UUID],
  })
  markInterruptedFromActive(userId: string, id: string) {
    return this.db
      .updateTable('agent_session')
      .set({ status: AgentSessionStatus.Interrupted })
      .where('userId', '=', userId)
      .where('id', '=', asUuid(id))
      .where('status', 'in', AgentSessionRepository.interruptibleStatuses)
      .returning(columns.agentSession)
      .executeTakeFirst();
  }

  @GenerateSql({
    params: [DummyValue.UUID, DummyValue.UUID, DummyValue.DATE],
  })
  cancel(userId: string, id: string, endedAt: Date) {
    return this.db
      .updateTable('agent_session')
      .set({ status: AgentSessionStatus.Cancelled, endedAt })
      .where('userId', '=', userId)
      .where('id', '=', asUuid(id))
      .where('status', 'in', AgentSessionRepository.cancellableStatuses)
      .returning(columns.agentSession)
      .executeTakeFirst();
  }
}
