import { Injectable } from '@nestjs/common';
import { Insertable, Kysely } from 'kysely';
import { InjectKysely } from 'nestjs-kysely';
import { columns } from 'src/database';
import { DummyValue, GenerateSql } from 'src/decorators';
import { DB } from 'src/schema';
import { AgentSessionActivityEventTable } from 'src/schema/tables/agent-session-activity-event.table';
import { asUuid } from 'src/utils/database';

@Injectable()
export class AgentSessionActivityEventRepository {
  constructor(@InjectKysely() private db: Kysely<DB>) {}

  create(dto: Insertable<AgentSessionActivityEventTable>) {
    return this.db
      .insertInto('agent_session_activity_event')
      .values(dto)
      .returning(columns.agentSessionActivityEvent)
      .executeTakeFirstOrThrow();
  }

  @GenerateSql({ params: [DummyValue.UUID] })
  getBySessionId(sessionId: string) {
    return this.db
      .selectFrom('agent_session_activity_event')
      .select(columns.agentSessionActivityEvent)
      .where('sessionId', '=', asUuid(sessionId))
      .orderBy('createdAt', 'asc')
      .orderBy('id', 'asc')
      .execute();
  }
}
