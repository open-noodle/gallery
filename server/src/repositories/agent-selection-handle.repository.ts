import { Injectable } from '@nestjs/common';
import { Kysely } from 'kysely';
import { InjectKysely } from 'nestjs-kysely';
import { columns } from 'src/database';
import { DummyValue, GenerateSql } from 'src/decorators';
import { DB } from 'src/schema';
import { asUuid } from 'src/utils/database';

const selectionHandleSampleSize = 25;

export type AgentSelectionHandleCreate = {
  sessionId: string;
  userId: string;
  sourceToolCallId: string | null;
  assetIds: string[];
  expiresAt: Date;
};

export type AgentSelectionHandleLookup = {
  id: string;
  sessionId: string;
  userId: string;
  now: Date;
};

export type AgentSelectionHandleRecoveryLookup = {
  id: string;
  sessionId: string;
  userId: string;
};

export type AgentSelectionHandleRecoveryList = {
  sessionId: string;
  userId: string;
  now: Date;
  limit: number;
};

@Injectable()
export class AgentSelectionHandleRepository {
  constructor(@InjectKysely() private db: Kysely<DB>) {}

  create(dto: AgentSelectionHandleCreate) {
    const assetIds = this.uniqueOrdered(dto.assetIds);

    return this.db
      .insertInto('agent_selection_handle')
      .values({
        sessionId: dto.sessionId,
        userId: dto.userId,
        sourceToolCallId: dto.sourceToolCallId,
        assetIds,
        assetCount: assetIds.length,
        sampleAssetIds: assetIds.slice(0, selectionHandleSampleSize),
        expiresAt: dto.expiresAt,
      })
      .returning(columns.agentSelectionHandle)
      .executeTakeFirstOrThrow();
  }

  @GenerateSql({
    params: [{ id: DummyValue.UUID, sessionId: DummyValue.UUID, userId: DummyValue.UUID, now: DummyValue.DATE }],
  })
  getValidForPlanning(dto: AgentSelectionHandleLookup) {
    return this.db
      .selectFrom('agent_selection_handle')
      .select(columns.agentSelectionHandle)
      .where('id', '=', asUuid(dto.id))
      .where('sessionId', '=', asUuid(dto.sessionId))
      .where('userId', '=', asUuid(dto.userId))
      .where('expiresAt', '>', dto.now)
      .executeTakeFirst();
  }

  listValidForRecovery(dto: AgentSelectionHandleRecoveryList) {
    return this.db
      .selectFrom('agent_selection_handle')
      .select(['id', 'assetCount', 'sourceToolCallId', 'createdAt', 'expiresAt'])
      .where('sessionId', '=', asUuid(dto.sessionId))
      .where('userId', '=', asUuid(dto.userId))
      .where('expiresAt', '>', dto.now)
      .orderBy('createdAt', 'desc')
      .orderBy('id', 'desc')
      .limit(dto.limit)
      .execute();
  }

  getForRecovery(dto: AgentSelectionHandleRecoveryLookup) {
    return this.db
      .selectFrom('agent_selection_handle')
      .select(['id', 'assetCount', 'sourceToolCallId', 'createdAt', 'expiresAt'])
      .where('id', '=', asUuid(dto.id))
      .where('sessionId', '=', asUuid(dto.sessionId))
      .where('userId', '=', asUuid(dto.userId))
      .executeTakeFirst();
  }

  private uniqueOrdered(assetIds: string[]) {
    return [...new Set(assetIds)];
  }
}
