import { Injectable } from '@nestjs/common';
import { Kysely } from 'kysely';
import { randomUUID } from 'node:crypto';
import { DB } from 'src/schema';

export type ActivityType =
  | 'MEMBER_INVITED'
  | 'MEMBER_JOINED'
  | 'MEMBER_LEFT'
  | 'ASSET_ADDED'
  | 'ASSET_REMOVED'
  | 'ROLE_CHANGED'
  | 'SPACE_SHARED'
  | 'COVER_UPDATED';

@Injectable()
export class SpaceActivityRepository {
  constructor(private db: Kysely<DB>) {}

  async create(data: { spaceId: string; type: ActivityType; userId: string | null; data?: Record<string, unknown> }) {
    const result = await this.db
      .insertInto('shared_space_activity')
      .values({
        id: randomUUID(),
        spaceId: data.spaceId,
        type: data.type,
        userId: data.userId,
        data: data.data || {},
        createdAt: new Date(),
      })
      .returningAll()
      .executeTakeFirstOrThrow();

    return result;
  }

  async getActivities(
    spaceId: string,
    options: {
      take?: number;
      skip?: number;
      since?: Date;
    } = {},
  ) {
    let query = this.db.selectFrom('shared_space_activity').where('spaceId', '=', spaceId);

    if (options.since) {
      query = query.where('createdAt', '>', options.since);
    }

    return query
      .selectAll()
      .orderBy('createdAt', 'desc')
      .limit(options.take ?? 50)
      .offset(options.skip ?? 0)
      .execute();
  }
}
