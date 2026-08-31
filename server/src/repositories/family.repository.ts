import { Injectable } from '@nestjs/common';
import { Insertable, Kysely, sql, Transaction } from 'kysely';
import { InjectKysely } from 'nestjs-kysely';
import { PostgresError } from 'postgres';
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

// See family-union.table.ts: a partial unique index on partnerKey, NULL below two partners.
const PARTNER_KEY_UNIQUE_INDEX = 'family_union_partner_key_uq';

// partnerKey = the two partner identity ids, SORTED, joined with ':', then ':' and the
// startDate (or '' when null). NULL unless there are exactly two partners — that is what lets
// 0- and 1-partner unions coexist freely (E5) while a genuine duplicate collapses (E4/E61).
// startDate is part of the key so the same couple can marry, divorce and remarry (E60).
const computePartnerKey = (partnerIds: string[], startDate: string | null): string | null => {
  if (partnerIds.length !== 2) {
    return null;
  }
  const [a, b] = [...partnerIds].sort();
  return `${a}:${b}:${startDate ?? ''}`;
};

const isPartnerKeyViolation = (error: unknown): boolean =>
  (error as PostgresError)?.code === '23505' && (error as PostgresError)?.constraint_name === PARTNER_KEY_UNIQUE_INDEX;

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
  // participants half-written is worse than no union at all. partnerKey is computed up front
  // (before the transaction even opens) so the same call site handles both the ordinary insert
  // and the duplicate-collision fallback below with one value.
  async createUnion(input: CreateUnionInput, db: Kysely<DB> | Transaction<DB> = this.db) {
    const partnerKey = computePartnerKey(input.partnerIds, input.startDate);

    const run = async (trx: Kysely<DB> | Transaction<DB>) => {
      const values: Insertable<FamilyUnionTable> = {
        startDate: input.startDate,
        endDate: input.endDate,
        createdById: input.createdById,
        partnerKey,
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

    try {
      return await (db === this.db ? this.db.transaction().execute(run) : run(db));
    } catch (error) {
      // E4/E61 (including under concurrency): the partial unique index is what actually
      // guarantees "one row for this pair+date", not this catch — a second, truly concurrent
      // insert only reaches this branch once the winner's transaction has already committed
      // (Postgres blocks the second insert on the index until the first resolves), so the
      // fallback SELECT below is guaranteed to find it. A `NULL` partnerKey can never collide
      // (the index predicate excludes it), so this can only fire for a real 2-partner duplicate.
      if (partnerKey && isPartnerKeyViolation(error)) {
        const existing = await db
          .selectFrom('family_union')
          .selectAll()
          .where('partnerKey', '=', partnerKey)
          .executeTakeFirst();
        if (existing) {
          return existing;
        }
      }
      throw error;
    }
  }

  // E62: startDate is part of partnerKey, so an edit to it must recompute the key in the SAME
  // transaction as the update — never as a separate follow-up write.
  async updateUnion(unionId: string, values: UpdateUnionFields, db: Kysely<DB> | Transaction<DB> = this.db) {
    if (Object.keys(values).length === 0) {
      return;
    }

    const run = async (trx: Kysely<DB> | Transaction<DB>) => {
      const finalValues: UpdateUnionFields & { partnerKey?: string | null } = { ...values };

      if ('startDate' in values) {
        const partnerIds = await this.getPartnerIds(unionId, trx);
        finalValues.partnerKey = computePartnerKey(partnerIds, values.startDate ?? null);
      }

      await trx.updateTable('family_union').set(finalValues).where('id', '=', unionId).execute();
    };

    return db === this.db ? this.db.transaction().execute(run) : run(db);
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

  // Membership changes recompute partnerKey too, not just startDate edits: adding a second
  // partner is exactly the 0/1 -> 2 transition that turns a never-deduplicated union into one
  // the unique index polices. Left uncaught here if it collides — folding two unions that a
  // membership change made collide on partnerKey is Task 3's identity-merge scope, not this one.
  async addPartner(unionId: string, identityId: string, db: Kysely<DB> | Transaction<DB> = this.db) {
    const run = async (trx: Kysely<DB> | Transaction<DB>) => {
      await trx.insertInto('family_union_partner').values({ unionId, identityId }).execute();

      const partnerIds = await this.getPartnerIds(unionId, trx);
      if (partnerIds.length === 2) {
        const union = await trx
          .selectFrom('family_union')
          .select('startDate')
          .where('id', '=', unionId)
          .executeTakeFirstOrThrow();
        const partnerKey = computePartnerKey(partnerIds, union.startDate);
        await trx.updateTable('family_union').set({ partnerKey }).where('id', '=', unionId).execute();
      }
    };

    return db === this.db ? this.db.transaction().execute(run) : run(db);
  }

  @GenerateSql({ params: [DummyValue.UUID, DummyValue.UUID_1] })
  async addChild(unionId: string, identityId: string, db: Kysely<DB> | Transaction<DB> = this.db) {
    await db.insertInto('family_union_child').values({ unionId, identityId }).execute();
  }

  // Removes a participant regardless of which role they hold — a caller asking to remove
  // someone from a union doesn't need to know whether they were a partner or a child.
  //
  // E17: removing a partner can only ever drop the union to 0 or 1 partners, never leave it at
  // 2 — so unlike addPartner there is nothing to recompute, only to clear. Checked BEFORE the
  // delete so we know whether a partner (as opposed to a child) actually left.
  async removeParticipant(unionId: string, identityId: string, db: Kysely<DB> | Transaction<DB> = this.db) {
    const run = async (trx: Kysely<DB> | Transaction<DB>) => {
      const wasPartner = await trx
        .selectFrom('family_union_partner')
        .select('identityId')
        .where('unionId', '=', unionId)
        .where('identityId', '=', identityId)
        .executeTakeFirst();

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

      if (wasPartner) {
        await trx.updateTable('family_union').set({ partnerKey: null }).where('id', '=', unionId).execute();
      }
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
