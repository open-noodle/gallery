import { Injectable } from '@nestjs/common';
import { Insertable, Kysely, sql, Transaction } from 'kysely';
import { InjectKysely } from 'nestjs-kysely';
import { DummyValue, GenerateSql } from 'src/decorators';
import { LoggingRepository } from 'src/repositories/logging.repository';
import { DB } from 'src/schema';
import { FamilyUnionTable } from 'src/schema/tables/family-union.table';

export interface CreateUnionInput {
  status?: string;
  startDate: string | null;
  endDate: string | null;
  createdById: string | null;
  partnerIds: string[];
  childIds: string[];
}

export interface UpdateUnionFields {
  status?: string;
  startDate?: string | null;
  endDate?: string | null;
}

@Injectable()
export class FamilyRepository {
  constructor(
    @InjectKysely() private db: Kysely<DB>,
    private logger: LoggingRepository,
  ) {
    this.logger.setContext(FamilyRepository.name);
  }

  getAccess(userId: string) {
    return this.db.selectFrom('family_access').select('level').where('userId', '=', userId).executeTakeFirst();
  }

  @GenerateSql({ params: [DummyValue.UUID] })
  getUnion(unionId: string, db: Kysely<DB> | Transaction<DB> = this.db) {
    return db.selectFrom('family_union').selectAll().where('id', '=', unionId).executeTakeFirst();
  }

  // Creates the union row and its initial membership in one transaction — a union with
  // participants half-written is worse than no union at all.
  async createUnion(input: CreateUnionInput, db: Kysely<DB> | Transaction<DB> = this.db) {
    const run = async (trx: Kysely<DB> | Transaction<DB>) => {
      const values: Insertable<FamilyUnionTable> = {
        startDate: input.startDate,
        endDate: input.endDate,
        createdById: input.createdById,
      };
      if (input.status !== undefined) {
        values.status = input.status;
      }

      const union = await trx.insertInto('family_union').values(values).returningAll().executeTakeFirstOrThrow();

      if (input.partnerIds.length > 0) {
        await trx
          .insertInto('family_union_partner')
          .values(input.partnerIds.map((identityId) => ({ unionId: union.id, identityId })))
          .execute();
      }

      if (input.childIds.length > 0) {
        await trx
          .insertInto('family_union_child')
          .values(input.childIds.map((identityId) => ({ unionId: union.id, identityId })))
          .execute();
      }

      return union;
    };

    return db === this.db ? this.db.transaction().execute(run) : run(db);
  }

  @GenerateSql({ params: [DummyValue.UUID, { status: 'divorced' }] })
  async updateUnion(unionId: string, values: UpdateUnionFields, db: Kysely<DB> | Transaction<DB> = this.db) {
    if (Object.keys(values).length === 0) {
      return;
    }
    await db.updateTable('family_union').set(values).where('id', '=', unionId).execute();
  }

  @GenerateSql({ params: [DummyValue.UUID] })
  async deleteUnion(unionId: string, db: Kysely<DB> | Transaction<DB> = this.db) {
    await db.deleteFrom('family_union').where('id', '=', unionId).execute();
  }

  @GenerateSql({ params: [DummyValue.UUID] })
  async getPartnerIds(unionId: string, db: Kysely<DB> | Transaction<DB> = this.db): Promise<string[]> {
    const rows = await db
      .selectFrom('family_union_partner')
      .select('identityId')
      .where('unionId', '=', unionId)
      .execute();
    return rows.map((row) => row.identityId);
  }

  @GenerateSql({ params: [DummyValue.UUID] })
  async getChildIds(unionId: string, db: Kysely<DB> | Transaction<DB> = this.db): Promise<string[]> {
    const rows = await db
      .selectFrom('family_union_child')
      .select('identityId')
      .where('unionId', '=', unionId)
      .execute();
    return rows.map((row) => row.identityId);
  }

  @GenerateSql({ params: [DummyValue.UUID, DummyValue.UUID_1] })
  async addPartner(unionId: string, identityId: string, db: Kysely<DB> | Transaction<DB> = this.db) {
    await db.insertInto('family_union_partner').values({ unionId, identityId }).execute();
  }

  @GenerateSql({ params: [DummyValue.UUID, DummyValue.UUID_1] })
  async addChild(unionId: string, identityId: string, db: Kysely<DB> | Transaction<DB> = this.db) {
    await db.insertInto('family_union_child').values({ unionId, identityId }).execute();
  }

  // Removes a participant regardless of which role they hold — a caller asking to remove
  // someone from a union doesn't need to know whether they were a partner or a child.
  async removeParticipant(unionId: string, identityId: string, db: Kysely<DB> | Transaction<DB> = this.db) {
    const run = async (trx: Kysely<DB> | Transaction<DB>) => {
      await trx
        .deleteFrom('family_union_partner')
        .where('unionId', '=', unionId)
        .where('identityId', '=', identityId)
        .execute();
      await trx
        .deleteFrom('family_union_child')
        .where('unionId', '=', unionId)
        .where('identityId', '=', identityId)
        .execute();
    };

    return db === this.db ? this.db.transaction().execute(run) : run(db);
  }

  @GenerateSql({ params: [DummyValue.UUID] })
  async getIdentityType(identityId: string, db: Kysely<DB> | Transaction<DB> = this.db): Promise<string | undefined> {
    const row = await db.selectFrom('face_identity').select('type').where('id', '=', identityId).executeTakeFirst();
    return row?.type;
  }

  // Walks the WHOLE ancestor chain, not one hop: candidateId is a parent, grandparent,
  // great-grandparent (etc.) of ofIdentityId. A one-level check here would pass a direct
  // parent/child cycle (E7) while missing a cycle that closes three generations up (E8) —
  // the recursive CTE below is why both are caught. `UNION` (not `UNION ALL`) also protects
  // against infinite recursion if the graph already contained a cycle.
  @GenerateSql({ params: [DummyValue.UUID, DummyValue.UUID_1] })
  async isAncestor(
    candidateId: string,
    ofIdentityId: string,
    db: Kysely<DB> | Transaction<DB> = this.db,
  ): Promise<boolean> {
    const result = await sql<{ exists: boolean }>`
      WITH RECURSIVE ancestors AS (
        SELECT partner."identityId" AS id
        FROM family_union_child child
        INNER JOIN family_union_partner partner ON partner."unionId" = child."unionId"
        WHERE child."identityId" = ${ofIdentityId}
        UNION
        SELECT partner."identityId" AS id
        FROM ancestors
        INNER JOIN family_union_child child ON child."identityId" = ancestors.id
        INNER JOIN family_union_partner partner ON partner."unionId" = child."unionId"
      )
      SELECT EXISTS (SELECT 1 FROM ancestors WHERE id = ${candidateId}) AS "exists"
    `.execute(db);

    return result.rows[0]?.exists ?? false;
  }
}
