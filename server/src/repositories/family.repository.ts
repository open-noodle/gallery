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

/**
 * One union's full participant lists, before any per-viewer redaction. `partnerIds`/`childIds`
 * are ordered by identity id — a fixed, arbitrary-but-deterministic order — so that the same
 * union always assigns the same anonymous slot index to the same identity across repeated reads
 * (`E30`'s "stable slot" property depends on this: query results are not otherwise guaranteed to
 * come back in the same row order twice).
 */
export interface RawUnionRow {
  id: string;
  status: string;
  startDate: string | null;
  endDate: string | null;
  partnerIds: string[];
  childIds: string[];
}

/** One seat in a union as the visibility query has resolved it: an identity the caller already
 * knows the viewer can resolve, or a placeholder for one they cannot. The placeholder carries
 * nothing at all — not even a slot number — because its position in the `partners`/`children`
 * array IS the slot: the caller never needs a separate index to keep two anonymous seats in the
 * same union apart. Never confuse this with a `ProjectedFamilyParticipant`: this is the
 * repository-internal shape (`identityId`, not `kind: 'known'`); `FamilyService` maps it to the
 * public one. */
export type VisibilityParticipant = { readonly identityId: string } | { readonly anonymous: true };

export interface VisibleUnion {
  readonly id: string;
  readonly status: string;
  readonly startDate: string | null;
  readonly endDate: string | null;
  readonly partners: readonly VisibilityParticipant[];
  readonly children: readonly VisibilityParticipant[];
}

/** A node in the connected-components graph over visible unions: a resolvable identity, or an
 * anonymous seat scoped to one union+role+index so it can never be mistaken for "the same"
 * anonymous seat elsewhere. */
type ClusterNode = { readonly kind: 'known'; readonly identityId: string } | { readonly kind: 'anonymous' };

/** The connected-components node key for one seat: a known identity's real id, or a synthetic
 * key scoped to its own union+role+index. Pure — no closure over `computeClusters`' state — so
 * it lives at module scope rather than being re-created on every call. */
const clusterNodeKey = (
  unionId: string,
  role: 'partner' | 'child',
  index: number,
  seat: VisibilityParticipant,
): string => ('identityId' in seat ? seat.identityId : `anon:${unionId}:${role}:${index}`);

export interface RawCluster {
  /** Every resolvable identity in this cluster. Always at least 2 — every visible union already
   * guarantees 2+ resolvable participants, and a cluster is built from at least one such union. */
  readonly knownIds: readonly string[];
  /** Total distinct people in the cluster, resolvable or not. */
  readonly size: number;
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

  // Slice 7: every explicit grant on the instance, for the admin grants table. Users with no
  // row here simply inherit `familyTree.defaultAccess` — the caller renders that distinction,
  // this just returns what is actually stored.
  @GenerateSql()
  getAllAccess(db: Kysely<DB> | Transaction<DB> = this.db) {
    return db.selectFrom('family_access').selectAll().execute();
  }

  // Slice 7: admin grant administration is independent of the caller's own family access level
  // (D2) — this never checks or touches `requireFamilyWrite`. `grantedAt` is set explicitly on
  // every call (insert AND re-grant) because, unlike `family_union`, this table has no
  // updated-at trigger to refresh it for us.
  @GenerateSql({ params: [DummyValue.UUID, DummyValue.STRING, DummyValue.UUID_1] })
  setAccess(userId: string, level: string, grantedById: string, db: Kysely<DB> | Transaction<DB> = this.db) {
    return db
      .insertInto('family_access')
      .values({ userId, level, grantedById, grantedAt: new Date() })
      .onConflict((oc) => oc.column('userId').doUpdateSet({ level, grantedById, grantedAt: new Date() }))
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  // Slice 7 (new): removes the row entirely, reverting the user to `familyTree.defaultAccess` —
  // NOT an update to a matching value, which would leave "explicit grant" state behind (D5.1's
  // "inherits default" vs an explicit value must stay a real distinction). Deleting a row that
  // doesn't exist is a no-op, not an error — the caller never needs to check first.
  @GenerateSql({ params: [DummyValue.UUID] })
  deleteAccess(userId: string, db: Kysely<DB> | Transaction<DB> = this.db) {
    return db.deleteFrom('family_access').where('userId', '=', userId).execute();
  }

  @GenerateSql({ params: [DummyValue.UUID] })
  getUnion(unionId: string, db: Kysely<DB> | Transaction<DB> = this.db) {
    return db.selectFrom('family_union').selectAll().where('id', '=', unionId).executeTakeFirst();
  }

  // Slice 5 (D3): every union with its full, unredacted participant lists, in ONE query
  // regardless of how many unions exist (`E65`) — a LATERAL array_agg per role rather than a
  // join that would multiply rows (and therefore round trips scaling with union size) per
  // partner/child. This is deliberately viewer-agnostic: redaction is layered on top by
  // `FamilyService`, which is also why this never takes a userId. Each array is ordered by
  // identity id so that repeated calls (e.g. successive reads by different viewers) assign the
  // same anonymous slot index to the same identity — see `RawUnionRow`.
  @GenerateSql()
  async getAllUnionsWithParticipants(db: Kysely<DB> | Transaction<DB> = this.db): Promise<RawUnionRow[]> {
    const result = await sql<RawUnionRow>`
      SELECT
        family_union.id,
        family_union.status,
        family_union."startDate",
        family_union."endDate",
        COALESCE(partners.ids, ARRAY[]::uuid[]) AS "partnerIds",
        COALESCE(children.ids, ARRAY[]::uuid[]) AS "childIds"
      FROM family_union
      LEFT JOIN LATERAL (
        SELECT array_agg(family_union_partner."identityId" ORDER BY family_union_partner."identityId") AS ids
        FROM family_union_partner
        WHERE family_union_partner."unionId" = family_union.id
      ) partners ON true
      LEFT JOIN LATERAL (
        SELECT array_agg(family_union_child."identityId" ORDER BY family_union_child."identityId") AS ids
        FROM family_union_child
        WHERE family_union_child."unionId" = family_union.id
      ) children ON true
      ORDER BY family_union.id
    `.execute(db);

    return result.rows;
  }

  // Slice 5 (D3): applies the visibility rule — a union is visible iff the viewer can resolve at
  // least two of its participants — and shapes every participant into either a known seat or an
  // opaque anonymous one. Pure in-memory work over `getAllUnionsWithParticipants`'s single query;
  // no further DB access, so this scales with the number of unions in the graph, not with the
  // number of round trips (`E65`).
  computeVisibleUnions(unions: RawUnionRow[], resolvableIds: ReadonlySet<string>): VisibleUnion[] {
    const visible: VisibleUnion[] = [];

    for (const union of unions) {
      const partners = union.partnerIds.map((identityId): VisibilityParticipant =>
        resolvableIds.has(identityId) ? { identityId } : { anonymous: true },
      );
      const children = union.childIds.map((identityId): VisibilityParticipant =>
        resolvableIds.has(identityId) ? { identityId } : { anonymous: true },
      );

      const resolvedCount =
        partners.filter((seat) => 'identityId' in seat).length + children.filter((seat) => 'identityId' in seat).length;

      // E27/E28/E29: below two resolvable participants the union conveys nothing and still
      // leaks a headcount, so it is omitted entirely rather than redacted.
      if (resolvedCount < 2) {
        continue;
      }

      visible.push({
        id: union.id,
        status: union.status,
        startDate: union.startDate,
        endDate: union.endDate,
        partners,
        children,
      });
    }

    return visible;
  }

  // Slice 5 (D3/E63/E64): connected components over the VIEWER-VISIBLE graph only — never the
  // full graph, or a cluster could reveal that two people are related through a union the viewer
  // is not allowed to see. Computed fresh from `visibleUnions` every call; nothing here is
  // stored (`E64`). Anonymous seats are nodes too, scoped to their own union+role+index, so two
  // anonymous seats in different unions are never merged into one node — the same non-correlation
  // guarantee `E30` requires of the projected graph.
  computeClusters(visibleUnions: readonly VisibleUnion[]): RawCluster[] {
    const parent = new Map<string, string>();
    const nodeInfo = new Map<string, ClusterNode>();

    const find = (key: string): string => {
      let root = key;
      while (parent.get(root) !== root) {
        const next = parent.get(root);
        if (next === undefined) {
          break;
        }
        root = next;
      }
      let cursor = key;
      while (parent.get(cursor) !== root) {
        const next = parent.get(cursor)!;
        parent.set(cursor, root);
        cursor = next;
      }
      return root;
    };

    const ensureNode = (key: string, info: ClusterNode) => {
      if (parent.has(key)) {
        return;
      }
      parent.set(key, key);
      nodeInfo.set(key, info);
    };

    const union = (a: string, b: string) => {
      const rootA = find(a);
      const rootB = find(b);
      if (rootA !== rootB) {
        parent.set(rootA, rootB);
      }
    };

    for (const familyUnion of visibleUnions) {
      const keys: string[] = [];

      for (const [index, seat] of familyUnion.partners.entries()) {
        const key = clusterNodeKey(familyUnion.id, 'partner', index, seat);
        ensureNode(key, 'identityId' in seat ? { kind: 'known', identityId: seat.identityId } : { kind: 'anonymous' });
        keys.push(key);
      }
      for (const [index, seat] of familyUnion.children.entries()) {
        const key = clusterNodeKey(familyUnion.id, 'child', index, seat);
        ensureNode(key, 'identityId' in seat ? { kind: 'known', identityId: seat.identityId } : { kind: 'anonymous' });
        keys.push(key);
      }

      // Every participant of a union belongs to the same family unit — union them all together.
      for (let i = 1; i < keys.length; i++) {
        union(keys[0]!, keys[i]!);
      }
    }

    const groups = new Map<string, string[]>();
    for (const key of parent.keys()) {
      const root = find(key);
      const group = groups.get(root) ?? [];
      group.push(key);
      groups.set(root, group);
    }

    const clusters: RawCluster[] = [];
    for (const group of groups.values()) {
      const knownIds = group
        .map((key) => nodeInfo.get(key)!)
        .filter((info): info is { kind: 'known'; identityId: string } => info.kind === 'known')
        .map((info) => info.identityId);

      clusters.push({ knownIds, size: group.length });
    }

    return clusters;
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

      // A union needs two participants to mean anything: `computeVisibleUnions` drops anything
      // below that (`E27`-`E29`), so what is left here is a row nobody can ever see. Left behind,
      // those husks are not merely untidy — a one-partner remnant still has a FREE PARTNER SEAT,
      // and the `beside` drop gesture fills the first union with one. Dropping a new partner next
      // to someone would silently resurrect an abandoned union, carrying whatever status and dates
      // it had ("married", 1998) into a relationship that has nothing to do with them.
      const [remainingPartners, remainingChildren] = await Promise.all([
        trx.selectFrom('family_union_partner').select('identityId').where('unionId', '=', unionId).execute(),
        trx.selectFrom('family_union_child').select('identityId').where('unionId', '=', unionId).execute(),
      ]);

      if (remainingPartners.length + remainingChildren.length < 2) {
        await trx.deleteFrom('family_union').where('id', '=', unionId).execute();
        return;
      }

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

  // Slice 5: gender is stored on face_identity, never on person/shared_space_person, so it needs
  // its own lookup — one query for the whole batch (`E65`), never one per participant.
  @GenerateSql({ params: [[DummyValue.UUID]] })
  async getGenders(
    identityIds: string[],
    db: Kysely<DB> | Transaction<DB> = this.db,
  ): Promise<Map<string, string | null>> {
    if (identityIds.length === 0) {
      return new Map();
    }
    const rows = await db.selectFrom('face_identity').select(['id', 'gender']).where('id', 'in', identityIds).execute();
    return new Map(rows.map((row) => [row.id, row.gender]));
  }

  // Slice 7: gender is shared data (it changes the label every viewer reads), so it lives on
  // `face_identity` itself rather than anywhere per-user — see `getGenders` above.
  @GenerateSql({ params: [DummyValue.UUID, DummyValue.STRING] })
  async setGender(identityId: string, gender: string | null, db: Kysely<DB> | Transaction<DB> = this.db) {
    await db.updateTable('face_identity').set({ gender }).where('id', '=', identityId).execute();
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
