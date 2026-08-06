import { Injectable } from '@nestjs/common';
import { Insertable, Kysely, Updateable } from 'kysely';
import { InjectKysely } from 'nestjs-kysely';
import { columns } from 'src/database';
import { DummyValue, GenerateSql } from 'src/decorators';
import { DB } from 'src/schema';
import { AgentProviderCredentialTable } from 'src/schema/tables/agent-provider-credential.table';
import { asUuid } from 'src/utils/database';

@Injectable()
export class AgentProviderCredentialRepository {
  constructor(@InjectKysely() private db: Kysely<DB>) {}

  create(dto: Insertable<AgentProviderCredentialTable>) {
    return this.db
      .insertInto('agent_provider_credential')
      .values(dto)
      .returning(columns.agentProviderCredential)
      .executeTakeFirstOrThrow();
  }

  @GenerateSql({ params: [DummyValue.UUID] })
  getByUserId(userId: string) {
    return this.db
      .selectFrom('agent_provider_credential')
      .select(columns.agentProviderCredential)
      .where('userId', '=', userId)
      .orderBy('createdAt', 'desc')
      .execute();
  }

  @GenerateSql({ params: [DummyValue.UUID, DummyValue.UUID] })
  getById(userId: string, id: string) {
    return this.db
      .selectFrom('agent_provider_credential')
      .select(columns.agentProviderCredential)
      .where('userId', '=', userId)
      .where('id', '=', asUuid(id))
      .executeTakeFirst();
  }

  update(userId: string, id: string, dto: Updateable<AgentProviderCredentialTable>) {
    return this.db
      .updateTable('agent_provider_credential')
      .set(dto)
      .where('userId', '=', userId)
      .where('id', '=', asUuid(id))
      .returning(columns.agentProviderCredential)
      .executeTakeFirstOrThrow();
  }

  @GenerateSql({ params: [DummyValue.UUID, DummyValue.UUID] })
  async delete(userId: string, id: string) {
    await this.db
      .deleteFrom('agent_provider_credential')
      .where('userId', '=', userId)
      .where('id', '=', asUuid(id))
      .execute();
  }
}
