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

  // Gallery-fork identity-merge participation (D1.6). Re-points family_union_partner and
  // family_union_child from every merged-away identity to the survivor, then repairs whatever the
  // merge could have broken: duplicate memberships, self-unions, partnerKey collisions, and any
  // closed parent cycle. Must be called BEFORE mergeIdentitiesAfterProfileResolution deletes the
  // source face_identity rows, or their ON DELETE CASCADE would silently take the memberships
  // with them (E56).
  //
  // The whole operation runs inside a SQL SAVEPOINT so that even an unanticipated failure here
  // can never abort the caller's face merge: a merge is a user correcting recognition, not
  // asserting a family fact, and family data must never be the reason it fails or is lost.
  // Verified empirically (this driver stack — kysely-postgres-js over postgres.js — has no
  // built-in savepoint API on a callback-style Transaction<DB>, so this uses raw SQL) that
  // SAVEPOINT / ROLLBACK TO SAVEPOINT / RELEASE SAVEPOINT recover cleanly from a mid-transaction
  // error without poisoning the outer transaction.
  async repointIdentities(sourceIds: string[], targetId: string, db: Transaction<DB>): Promise<void> {
    const sources = [...new Set(sourceIds)].filter((id) => id !== targetId);
    if (sources.length === 0) {
      return;
    }

    await sql`SAVEPOINT family_repoint`.execute(db);
    try {
      await this.repointIdentitiesUnsafe(sources, targetId, db);
      await sql`RELEASE SAVEPOINT family_repoint`.execute(db);
    } catch (error) {
      await sql`ROLLBACK TO SAVEPOINT family_repoint`.execute(db);
      await sql`RELEASE SAVEPOINT family_repoint`.execute(db);
      this.logger.error(
        `Family relationship repointing failed during an identity merge (target=${targetId}, ` +
          `sources=${sources.join(',')}) — family data for this merge was left untouched, but the ` +
          `merge itself proceeds: ${error}`,
      );
    }
  }

  private async repointIdentitiesUnsafe(sources: string[], targetId: string, db: Transaction<DB>): Promise<void> {
    const allIds = [targetId, ...sources];

    const partnerRows = await db
      .selectFrom('family_union_partner')
      .select(['unionId', 'identityId'])
      .where('identityId', 'in', allIds)
      .execute();
    const childRows = await db
      .selectFrom('family_union_child')
      .select(['unionId', 'identityId'])
      .where('identityId', 'in', allIds)
      .execute();

    const touchedUnionIds = [
      ...new Set([...partnerRows.map((row) => row.unionId), ...childRows.map((row) => row.unionId)]),
    ];
    if (touchedUnionIds.length === 0) {
      return;
    }

    // Full partner rows (not just rows for our ids) for every touched union — needed to detect
    // self-unions: a union collapses to a single distinct partner once mapped through the merge.
    const touchedPartnerRows = await db
      .selectFrom('family_union_partner')
      .select(['unionId', 'identityId'])
      .where('unionId', 'in', touchedUnionIds)
      .execute();

    const mapId = (id: string) => (sources.includes(id) ? targetId : id);

    const partnersByUnion = new Map<string, string[]>();
    for (const row of touchedPartnerRows) {
      const list = partnersByUnion.get(row.unionId) ?? [];
      list.push(row.identityId);
      partnersByUnion.set(row.unionId, list);
    }

    // Step 2 (self-unions, E58): a union that had exactly two DISTINCT partners collapses to one
    // identity once mapped through the merge. It no longer represents a partnership and is
    // deleted outright — its own partner/child rows cascade away with it.
    const selfUnionIds: string[] = [];
    for (const [unionId, partners] of partnersByUnion) {
      if (partners.length === 2 && new Set(partners.map((id) => mapId(id))).size === 1) {
        selfUnionIds.push(unionId);
      }
    }
    if (selfUnionIds.length > 0) {
      await db.deleteFrom('family_union').where('id', 'in', selfUnionIds).execute();
    }

    // Step 1 (collapse duplicate memberships): if a union already lists the survivor as a child
    // AND a merged-away identity as a child too, the merged-away row is now redundant. Drop it
    // before the blind re-point below, or the re-point would try to insert a second
    // (unionId, targetId) row and violate the primary key.
    await db
      .deleteFrom('family_union_child')
      .where('identityId', 'in', sources)
      .where('unionId', 'in', (eb) =>
        eb.selectFrom('family_union_child').select('unionId').where('identityId', '=', targetId),
      )
      .execute();

    // Re-point everything else. Both re-points are now guaranteed collision-free: self-unions
    // were deleted above (the only possible family_union_partner PK collision, since arity is
    // capped at two by the write path), and duplicate child rows were dropped above (the only
    // possible family_union_child PK collision).
    await db
      .updateTable('family_union_partner')
      .set({ identityId: targetId })
      .where('identityId', 'in', sources)
      .execute();
    await db
      .updateTable('family_union_child')
      .set({ identityId: targetId })
      .where('identityId', 'in', sources)
      .execute();

    // Defensive: not a named edge case, but the same invariant E10 protects on the write path,
    // which the merge never validates. If repointing left the survivor as BOTH a partner and a
    // child of the same union, the child edge loses — the same remedy used for a cycle below.
    await db
      .deleteFrom('family_union_child')
      .where('identityId', '=', targetId)
      .where('unionId', 'in', (eb) =>
        eb.selectFrom('family_union_partner').select('unionId').where('identityId', '=', targetId),
      )
      .execute();

    // Step 3 (fold partnerKey collisions, E57): every union where the survivor is now a
    // partner — including ones it already held before this merge — grouped by the FINAL
    // (post-repoint) partnerKey. A collision here can only be produced by this merge: the write
    // path and Task 2's createUnion already guarantee no duplicate existed beforehand.
    const survivorPartnerRows = await db
      .selectFrom('family_union_partner')
      .select('unionId')
      .where('identityId', '=', targetId)
      .execute();
    const candidateUnionIds = [...new Set(survivorPartnerRows.map((row) => row.unionId))];

    const foldedAwayUnionIds = new Set<string>();
    if (candidateUnionIds.length > 0) {
      const candidateUnions = await db
        .selectFrom('family_union')
        .select(['id', 'startDate', 'status'])
        .where('id', 'in', candidateUnionIds)
        .execute();
      const candidatePartnerRows = await db
        .selectFrom('family_union_partner')
        .select(['unionId', 'identityId'])
        .where('unionId', 'in', candidateUnionIds)
        .execute();
      const partnersByCandidateUnion = new Map<string, string[]>();
      for (const row of candidatePartnerRows) {
        const list = partnersByCandidateUnion.get(row.unionId) ?? [];
        list.push(row.identityId);
        partnersByCandidateUnion.set(row.unionId, list);
      }

      const groupsByKey = new Map<string, typeof candidateUnions>();
      for (const union of candidateUnions) {
        const partners = partnersByCandidateUnion.get(union.id) ?? [];
        if (partners.length !== 2) {
          continue;
        }
        const key = computePartnerKey(partners, union.startDate);
        if (!key) {
          continue;
        }
        const group = groupsByKey.get(key) ?? [];
        group.push(union);
        groupsByKey.set(key, group);
      }

      for (const group of groupsByKey.values()) {
        if (group.length < 2) {
          continue;
        }

        // A colliding group's members share an identical partnerKey by definition, which means
        // their startDate values are already equal (both dates equal, or both null) — otherwise
        // their keys would differ and there would be no collision to fold. "Keep the earliest
        // startDate" is therefore satisfied trivially by keeping the winner's; the ordering below
        // exists to pick a deterministic winner (id, as a stable final tiebreak) rather than to
        // compare genuinely different dates.
        const [winner, ...losers] = [...group].sort((a, b) => a.id.localeCompare(b.id));

        for (const loser of losers) {
          const loserChildren = await db
            .selectFrom('family_union_child')
            .select('identityId')
            .where('unionId', '=', loser.id)
            .execute();
          if (loserChildren.length > 0) {
            const winnerChildren = await db
              .selectFrom('family_union_child')
              .select('identityId')
              .where('unionId', '=', winner.id)
              .execute();
            const existingChildIds = new Set(winnerChildren.map((row) => row.identityId));
            const toMove = loserChildren.map((row) => row.identityId).filter((id) => !existingChildIds.has(id));
            if (toMove.length > 0) {
              await db
                .insertInto('family_union_child')
                .values(toMove.map((identityId) => ({ unionId: winner.id, identityId })))
                .execute();
            }
          }

          foldedAwayUnionIds.add(loser.id);
        }

        // "Keep the non-null status": `status` is never SQL NULL on this table (schema default
        // 'partnered'), so this is read as "prefer a deliberately-set, more specific status over
        // the anonymous default" — a loser's non-default status survives over the winner's
        // default one.
        const nonDefaultLoserStatus = losers.find((loser) => loser.status !== 'partnered')?.status;
        const finalStatus =
          winner.status === 'partnered' && nonDefaultLoserStatus ? nonDefaultLoserStatus : winner.status;
        if (finalStatus !== winner.status) {
          await db.updateTable('family_union').set({ status: finalStatus }).where('id', '=', winner.id).execute();
        }
      }

      if (foldedAwayUnionIds.size > 0) {
        await db
          .deleteFrom('family_union')
          .where('id', 'in', [...foldedAwayUnionIds])
          .execute();
      }
    }

    // Step 4 (break closed cycles, E58): only unions the merge actually touched, or that just
    // received folded-in children, can possibly contain a fresh cycle. Any new cycle must pass
    // through the survivor identity — every OTHER edge in the graph was already validated
    // acyclic by the write path and is untouched by this merge — so every edge newly incident to
    // it lives in one of these unions.
    const cycleCheckUnionIds = [...new Set([...touchedUnionIds, ...candidateUnionIds])].filter(
      (unionId) => !selfUnionIds.includes(unionId) && !foldedAwayUnionIds.has(unionId),
    );

    for (const unionId of cycleCheckUnionIds) {
      const partners = await this.getPartnerIds(unionId, db);
      const children = await this.getChildIds(unionId, db);
      for (const partnerId of partners) {
        for (const childId of children) {
          if (await this.isAncestor(childId, partnerId, db)) {
            await db
              .deleteFrom('family_union_child')
              .where('unionId', '=', unionId)
              .where('identityId', '=', childId)
              .execute();
          }
        }
      }
    }

    // Step 5: recompute partnerKey for every union still standing that this merge touched.
    for (const unionId of cycleCheckUnionIds) {
      const union = await db
        .selectFrom('family_union')
        .select('startDate')
        .where('id', '=', unionId)
        .executeTakeFirst();
      if (!union) {
        continue;
      }
      const partners = await this.getPartnerIds(unionId, db);
      const partnerKey = computePartnerKey(partners, union.startDate);
      await db.updateTable('family_union').set({ partnerKey }).where('id', '=', unionId).execute();
    }
  }
}
