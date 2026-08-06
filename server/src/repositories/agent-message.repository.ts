import { Injectable } from '@nestjs/common';
import { Insertable, Kysely } from 'kysely';
import { InjectKysely } from 'nestjs-kysely';
import { columns } from 'src/database';
import { DummyValue, GenerateSql } from 'src/decorators';
import { DB } from 'src/schema';
import { AgentMessageTable } from 'src/schema/tables/agent-message.table';
import { asUuid } from 'src/utils/database';

@Injectable()
export class AgentMessageRepository {
  constructor(@InjectKysely() private db: Kysely<DB>) {}

  create(dto: Insertable<AgentMessageTable>) {
    return this.db.insertInto('agent_message').values(dto).returning(columns.agentMessage).executeTakeFirstOrThrow();
  }

  @GenerateSql({ params: [DummyValue.UUID] })
  getBySessionId(sessionId: string) {
    return this.db
      .selectFrom('agent_message')
      .select(columns.agentMessage)
      .where('sessionId', '=', asUuid(sessionId))
      .orderBy('createdAt', 'asc')
      .orderBy('id', 'asc')
      .execute();
  }
}
