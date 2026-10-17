import { Injectable } from '@nestjs/common';
import { type ExpressionBuilder, type Kysely, type SqlBool, type Transaction, type Updateable, sql } from 'kysely';
import { jsonObjectFrom } from 'kysely/helpers/postgres';
import { InjectKysely } from 'nestjs-kysely';
import { DummyValue, GenerateSql } from 'src/decorators.js';
import { AssetFileType, AssetVisibility, SourceType } from 'src/enum.js';
import {
  clearOrphanPersonIdentity,
  personIdentityId,
  personIsPet,
  personSidecarColumns,
  personSpecies,
  setPersonIdentity,
  writePersonSidecars,
} from 'src/gallery/utils/person-sidecar.js';
import { type PeopleFaceStatisticsOptions } from 'src/repositories/person.repository.js';
import { DB } from 'src/schema/index.js';
import { PersonTable } from 'src/schema/tables/person.table.js';
import { retargetDeclinePersonId } from 'src/utils/face-decline-merge.js';
import { reviewableAssetVisibility } from 'src/utils/face-review.js';
import { retargetVerdictPersonId } from 'src/utils/face-verdict-merge.js';
import {
  spaceAssetPathBranches,
  spaceVisibilityGate,
  spaceVisibleAssetVisibilities,
} from 'src/utils/shared-space-album-scope.js';

export interface DormantPerson {
  id: string;
  name: string;
}

export interface PeopleOverviewStatistics {
  total: number;
  hidden: number;
  detectedFaceCount: number;
}

export interface PeopleFaceStatistics {
  detectedFaceCount: number;
  assignedVisibleFaceCount: number;
  namedVisiblePersonCount: number;
  assignedHiddenFaceCount: number;
  unassignedFaceCount: number;
}

export interface RepresentativeFaceListOptions {
  personId: string;
  take: number;
  skip: number;
  /**
   * Fork RBAC (Slice 2 / M1): when set, restricts results to faces on assets that `memberUserId`
   * can reach through a shared space AND that pass the shareable-visibility gate. Omit for the
   * owner's own unscoped picker view.
   */
  scope?: { memberUserId: string };
  /**
   * Fork (#869 follow-up): the owner's unscoped view above has no visibility gate of its own, so
   * without this the picker enumerates the owner's Locked Folder faces to a session that never
   * entered the PIN. Scoped (non-owner) callers are already Timeline+Archive-only via
   * `spaceVisibilityGate`, so their own elevation can never reach the owner's locked assets.
   */
  hasElevatedPermission?: boolean;
}

export interface RepresentativeFaceUpdateOptions {
  personId: string;
  assetFaceId: string;
}

const peopleAssetVisibilities = spaceVisibleAssetVisibilities;

const isBlank = (value: string | null | undefined) => !value || value.trim().length === 0;

/**
 * Option M: owner-agnostic variant of `withPerson`.
 *
 * `withPerson` selects the viewer's OWN person row in the face's group — correct for user-facing
 * reads. The face-repair admin console reads faces belonging to people the admin does not own and
 * has no viewer to key on, so this resolves the single person row in the group instead. Sound only
 * under M's 1:1 person_group-to-person invariant; see `getByGroupIdOnly`.
 */
const withPersonAnyOwner = (eb: ExpressionBuilder<DB, 'asset_face'>) =>
  jsonObjectFrom(
    eb
      .selectFrom('person')
      .selectAll('person')
      .select(personSidecarColumns())
      .whereRef('person.personGroupId', '=', 'asset_face.personGroupId'),
  ).as('person');

/**
 * Gallery-only person queries (identity and merge, the face picker, admin face reads, people statistics, suggestion
 * scans), kept out of the replay-owned PersonRepository. See specs/2026-10-10-gallery-on-immich-layering-design.md.
 */
@Injectable()
export class GalleryPersonRepository {
  constructor(@InjectKysely() private db: Kysely<DB>) {}

  async mergePersonProfile(
    input: {
      sourcePersonId: string;
      targetPersonId: string;
      targetIdentityId: string;
    },
    db: Kysely<DB> | Transaction<DB> = this.db,
  ): Promise<{ deletedThumbnailPath: string | null; targetNeedsFeatureFaceRepair: boolean }> {
    const people = await db
      .selectFrom('person')
      .select([
        'personGroupId',
        'name',
        'birthDate',
        'thumbnailPath',
        'color',
        personSpecies().as('species'),
        'faceAssetId',
      ])
      .where('personGroupId', 'in', [input.sourcePersonId, input.targetPersonId])
      .execute();
    const target = people.find((person) => person.personGroupId === input.targetPersonId);
    const source = people.find((person) => person.personGroupId === input.sourcePersonId);
    if (!target || !source) {
      throw new Error('Person profile not found');
    }

    await setPersonIdentity(db, input.targetPersonId, input.targetIdentityId);
    // Always touches the survivor (bumping updatedAt/updateId), as when identityId lived on person.
    const update: Updateable<PersonTable> = { name: target.name };
    if (isBlank(target.name) && !isBlank(source.name)) {
      update.name = source.name;
    }

    if (!target.birthDate && source.birthDate) {
      update.birthDate = source.birthDate;
    }

    if (isBlank(target.color) && !isBlank(source.color)) {
      update.color = source.color;
    }

    if (isBlank(target.species) && !isBlank(source.species)) {
      // only lands when the survivor is a pet: species lives on its person_pet row
      await writePersonSidecars(db, input.targetPersonId, { species: source.species });
    }

    await db.updateTable('person').set(update).where('personGroupId', '=', input.targetPersonId).execute();
    await db
      .updateTable('asset_face')
      .set({ personGroupId: input.targetPersonId })
      .where('personGroupId', '=', input.sourcePersonId)
      .execute();

    // Human placements live in `face_identity_face.source='manual'` (identity-keyed); negative/keep-here
    // verdicts live in `face_person_verdict`. Both are re-pointed to the survivor at merge time: the
    // identityId re-key runs in mergeIdentitiesAfterProfileResolution, and the personId re-target runs
    // just below (survivor-wins). The identityId FK is ON DELETE SET NULL as a safety net.

    // D1: move this person's verdicts to the survivor before deleting the source person (personId FK is
    // SET NULL — a bare delete would orphan them). Survivor-wins on the (personId, assetFaceId) collision.
    await retargetVerdictPersonId(db, input.sourcePersonId, input.targetPersonId);

    // H10: face_repair_decline.personId is ON DELETE CASCADE (unlike the verdict FK above), so the source
    // person's cluster mute must be moved onto the survivor before deletion too, or it is silently
    // destroyed and the cluster resurfaces on the next scan.
    await retargetDeclinePersonId(db, input.sourcePersonId, input.targetPersonId);

    const targetNeedsFeatureFaceRepair =
      !target.faceAssetId || !(await this.isFeatureFaceValid(input.targetPersonId, target.faceAssetId, db));
    const [deleteResult] = await db.deleteFrom('person').where('personGroupId', '=', input.sourcePersonId).execute();
    if (Number(deleteResult.numDeletedRows ?? 0) === 0) {
      throw new Error('Person profile not found');
    }

    // Sweep the group the source person just vacated. Upstream's mergePerson does this via
    // removeAllPersonGroups -> deleteEmptyGroups; the fork routes merges through here instead and the
    // step was not carried, so every merge left an orphan person_group row until the nightly
    // PersonCleanup happened to collect it. Scoped to this group and conditional on it being empty,
    // so it is correct under M (one person per group) and stays correct if that ever changes.
    await db
      .deleteFrom('person_group')
      .where('id', '=', input.sourcePersonId)
      .where(({ not, exists, selectFrom }) =>
        not(
          exists(
            selectFrom('person')
              .whereRef('person.personGroupId', '=', 'person_group.id')
              .select('person.personGroupId'),
          ),
        ),
      )
      .execute();

    return { deletedThumbnailPath: source.thumbnailPath || null, targetNeedsFeatureFaceRepair };
  }

  async lockPeopleForMerge(personIds: string[], db: Kysely<DB> | Transaction<DB> = this.db): Promise<void> {
    if (personIds.length === 0) {
      return;
    }

    const rows = await db
      .selectFrom('person')
      .select('personGroupId')
      .where('personGroupId', 'in', [...new Set(personIds)].toSorted())
      .orderBy('personGroupId')
      .forUpdate()
      .execute();
    if (rows.length !== new Set(personIds).size) {
      throw new Error('Person profile not found');
    }
  }

  private async isFeatureFaceValid(
    personId: string,
    faceAssetId: string,
    db: Kysely<DB> | Transaction<DB>,
  ): Promise<boolean> {
    const row = await db
      .selectFrom('asset_face')
      .select('asset_face.id')
      .where('asset_face.id', '=', faceAssetId)
      .where('asset_face.personGroupId', '=', personId)
      .where('asset_face.deletedAt', 'is', null)
      .where('asset_face.isVisible', 'is', true)
      .executeTakeFirst();

    return !!row;
  }

  async updatePersonIdentity(
    input: {
      personId: string;
      identityId: string;
    },
    db: Kysely<DB> | Transaction<DB> = this.db,
  ): Promise<void> {
    await setPersonIdentity(db, input.personId, input.identityId);
  }

  /**
   * Spec §6.3.1 (revised): resolve the ASSET OWNER's own `person` for a face identity, creating it
   * when the owner has never named this human themselves.
   *
   * Space-editor face edits propagate to `asset_face.personGroupId`, which lives in the owner's
   * layer, so the editor's space person has to be mapped onto a person row the OWNER owns.
   * `shared_space_person.identityId` and `person.identityId` hold the same value for the same human,
   * and that is the join used here.
   *
   * Option M keeps `person_group` 1:1 with `person`, so a brand-new owner person needs its own group
   * first (`createGroup`) — the same rule `createWithGroup` enforces for every other person-insert
   * path. A person is addressed by `personGroupId`; there is no standalone `person.id` any more.
   *
   * The insert races `person_identity_ownerId_identityId_key`: two
   * editors attaching two faces of the same not-yet-named human concurrently would both miss the
   * initial select. `doNothing` plus a re-select makes the loser adopt the winner's row rather than
   * fail on the duplicate key. The loser's freshly minted `person_group` row is then unreferenced,
   * and the nightly orphan-group sweep collects it.
   */
  async getOrCreateOwnerPersonForIdentity(
    input: { ownerId: string; identityId: string; name: string; type: string },
    db: Kysely<DB> | Transaction<DB> = this.db,
  ): Promise<{ personGroupId: string }> {
    const find = () =>
      db
        .selectFrom('person')
        .innerJoin('person_identity', 'person_identity.personGroupId', 'person.personGroupId')
        .select('person.personGroupId')
        .where('person.ownerId', '=', input.ownerId)
        .where('person_identity.identityId', '=', input.identityId)
        .executeTakeFirst();

    const existing = await find();
    if (existing) {
      return existing;
    }

    const group = await db
      .insertInto('person_group')
      .columns(['clusterGroupId'])
      .expression((eb) => eb.selectFrom('user').select('user.clusterGroupId').where('user.id', '=', input.ownerId))
      .returning('id')
      .executeTakeFirstOrThrow();

    // The identity link is written before the person: it carries the (ownerId, identityId) key.
    await clearOrphanPersonIdentity(db, input.ownerId, input.identityId);
    const linked = await db
      .insertInto('person_identity')
      .values({ personGroupId: group.id, ownerId: input.ownerId, identityId: input.identityId })
      .onConflict((oc) => oc.columns(['ownerId', 'identityId']).doNothing())
      .returning('personGroupId')
      .executeTakeFirst();
    if (!linked) {
      // Lost the race: the winner's person row is visible once its transaction commits.
      const winner = await find();
      if (!winner) {
        throw new Error(`Identity ${input.identityId} is linked for owner ${input.ownerId} but has no person row`);
      }
      return winner;
    }

    await db
      .insertInto('person')
      .values({ ownerId: input.ownerId, personGroupId: group.id, name: input.name })
      .execute();
    await writePersonSidecars(db, group.id, { type: input.type });

    return { personGroupId: group.id };
  }

  /**
   * Spec §6.3.1 (revised): the owner-layer half of a space-editor face edit. `personGroupId` is the
   * owner's person (addressed by its group id) on attach, or `null` on detach.
   *
   * The `expectedPersonGroupId` guard is what keeps a detach from clearing a tag that was never
   * about this human: an editor detaching space person "Uncle Tom" must not null out the owner's
   * unrelated "Dad" tag on the same face. The caller passes the owner person it resolved from the
   * space person's identity, and the update is a no-op if the face has since moved.
   */
  async setFaceOwnerPerson(
    input: { assetFaceId: string; personGroupId: string | null; expectedPersonGroupId?: string | null },
    db: Kysely<DB> | Transaction<DB> = this.db,
  ): Promise<void> {
    let query = db
      .updateTable('asset_face')
      .set({ personGroupId: input.personGroupId })
      .where('id', '=', input.assetFaceId);

    if (input.expectedPersonGroupId !== undefined) {
      query =
        input.expectedPersonGroupId === null
          ? query.where('personGroupId', 'is', null)
          : query.where('personGroupId', '=', input.expectedPersonGroupId);
    }

    await query.execute();
  }

  // Admin face-thumbnail read: no person join, and INCLUDES tombstoned faces (the "not a face"
  // action sets deletedAt but keeps boundingBox/dims, and resolutions history must still render).
  // Slice 1 (F1): excludes faces on a non-reviewable (Locked/Hidden) asset — the Locked folder requires
  // the owner's elevated re-authentication, which this admin route never performs. A Locked-asset face id
  // makes this throw, which the sole caller (face-repair.service.ts getAdminFaceThumbnail) already turns
  // into a 404, so the asset's existence is never disclosed. The tombstone inclusion above is unaffected —
  // deliberate and still tested.
  @GenerateSql({ params: [DummyValue.UUID] })
  getFaceByIdIncludingTombstoned(id: string) {
    return this.db
      .selectFrom('asset_face')
      .innerJoin('asset', 'asset.id', 'asset_face.assetId')
      .selectAll('asset_face')
      .select(withPersonAnyOwner)
      .where('asset_face.id', '=', id)
      .where((eb) => reviewableAssetVisibility(eb))
      .executeTakeFirstOrThrow();
  }

  // Sibling of getFaceByIdIncludingTombstoned for the admin PREVIEW route, which serves the whole source
  // photo rather than a 250px crop. It adds one filter: the asset must not be in the trash. The face
  // tombstone is deliberately still allowed through — the resolutions history renders tombstoned faces, so
  // a future magnifier there needs no server change.
  @GenerateSql({ params: [DummyValue.UUID] })
  getFaceByIdOnLiveAsset(id: string) {
    // withPersonAnyOwner, like the sibling above: this serves the admin console, which reads faces of
    // people the admin does not own and has no viewer to key `withPerson` on.
    return this.db
      .selectFrom('asset_face')
      .innerJoin('asset', 'asset.id', 'asset_face.assetId')
      .selectAll('asset_face')
      .select(withPersonAnyOwner)
      .where('asset_face.id', '=', id)
      .where('asset.deletedAt', 'is', null)
      .where((eb) => reviewableAssetVisibility(eb))
      .executeTakeFirstOrThrow();
  }

  @GenerateSql({ params: [{ personId: DummyValue.UUID, take: 50, skip: 0 }] })
  getRepresentativeFaces(options: RepresentativeFaceListOptions) {
    return this.db
      .selectFrom('person')
      .innerJoin('asset_face', (join) =>
        join.on((eb) =>
          eb.or([
            eb('asset_face.personGroupId', '=', eb.ref('person.personGroupId')),
            eb.exists(
              eb
                .selectFrom('face_identity_face')
                .select('face_identity_face.assetFaceId')
                .whereRef('face_identity_face.assetFaceId', '=', 'asset_face.id')
                .where('face_identity_face.identityId', '=', personIdentityId()),
            ),
          ]),
        ),
      )
      .innerJoin('asset', 'asset.id', 'asset_face.assetId')
      .selectAll('asset_face')
      .select(['asset.fileCreatedAt', 'person.faceAssetId as representativeFaceId'])
      .where('person.personGroupId', '=', options.personId)
      .where('asset_face.deletedAt', 'is', null)
      .where('asset_face.isVisible', '=', true)
      .where('asset.deletedAt', 'is', null)
      .where('asset.isOffline', '=', false)
      .where((eb) =>
        eb.not(
          eb.exists(
            eb
              .selectFrom('face_identity_face')
              .select('face_identity_face.assetFaceId')
              .whereRef('face_identity_face.assetFaceId', '=', 'asset_face.id')
              .where(sql<SqlBool>`face_identity_face."identityId" IS DISTINCT FROM ${personIdentityId()}`),
          ),
        ),
      )
      .$if(!options.hasElevatedPermission, (qb) => qb.where('asset.visibility', '!=', AssetVisibility.Locked))
      .$if(!!options.scope, (qb) =>
        qb.where((eb) =>
          eb.and([
            // Fork RBAC (Slice 2 / M1): a non-owner (space-granted) caller may only see faces on assets
            // they can reach through a space AND that pass the shareable visibility gate. Filters faces
            // matched via BOTH the personId arm and the identity-expansion arm (predicate is on the
            // joined asset row), so cross-user identity faces are also excluded.
            spaceVisibilityGate(eb),
            eb.or(
              spaceAssetPathBranches(eb, {
                correlateAssetId: 'asset.id',
                correlateLibraryId: 'asset.libraryId',
                scope: { memberUserId: options.scope!.memberUserId },
                albumTimelineGate: 'none',
              }),
            ),
          ]),
        ),
      )
      .orderBy('asset.fileCreatedAt', 'desc')
      .orderBy('asset_face.id')
      .offset(options.skip)
      .limit(options.take + 1)
      .execute();
  }

  @GenerateSql({ params: [{ personId: DummyValue.UUID, assetFaceId: DummyValue.UUID }] })
  getRepresentativeFaceForUpdate(options: RepresentativeFaceUpdateOptions) {
    return this.db
      .selectFrom('person')
      .innerJoin('asset_face', (join) =>
        join.on((eb) =>
          eb.or([
            eb('asset_face.personGroupId', '=', eb.ref('person.personGroupId')),
            eb.exists(
              eb
                .selectFrom('face_identity_face')
                .select('face_identity_face.assetFaceId')
                .whereRef('face_identity_face.assetFaceId', '=', 'asset_face.id')
                .where('face_identity_face.identityId', '=', personIdentityId()),
            ),
          ]),
        ),
      )
      .innerJoin('asset', 'asset.id', 'asset_face.assetId')
      .selectAll('asset_face')
      .where('person.personGroupId', '=', options.personId)
      .where('asset_face.id', '=', options.assetFaceId)
      .where('asset_face.deletedAt', 'is', null)
      .where('asset_face.isVisible', '=', true)
      .where('asset.deletedAt', 'is', null)
      .where('asset.isOffline', '=', false)
      .where((eb) =>
        eb.not(
          eb.exists(
            eb
              .selectFrom('face_identity_face')
              .select('face_identity_face.assetFaceId')
              .whereRef('face_identity_face.assetFaceId', '=', 'asset_face.id')
              .where(sql<SqlBool>`face_identity_face."identityId" IS DISTINCT FROM ${personIdentityId()}`),
          ),
        ),
      )
      .executeTakeFirst();
  }

  @GenerateSql({ params: [DummyValue.UUID, { minimumFaceCount: 3 }] })
  async getPeopleOverviewStatistics(
    userId: string,
    options: PeopleFaceStatisticsOptions = {},
  ): Promise<PeopleOverviewStatistics> {
    const minimumFaceCount = options.minimumFaceCount ?? 1;
    const result = await sql<PeopleOverviewStatistics>`
      WITH "eligible_faces" AS (
        SELECT
          "asset_face"."id" AS "assetFaceId",
          "asset_face"."personGroupId"
        FROM "asset_face"
        INNER JOIN "asset" ON "asset"."id" = "asset_face"."assetId"
        WHERE "asset"."ownerId" = ${userId}
          AND "asset"."deletedAt" IS NULL
          AND "asset"."isOffline" = false
          AND "asset"."visibility" IN (${sql.join(peopleAssetVisibilities)})
          AND "asset_face"."deletedAt" IS NULL
          AND "asset_face"."isVisible" = true
      ),
      "eligible_people" AS (
        SELECT
          "person"."personGroupId",
          "person"."isHidden"
        FROM "person"
        INNER JOIN "eligible_faces" ON "eligible_faces"."personGroupId" = "person"."personGroupId"
        WHERE "person"."ownerId" = ${userId}
        -- group by the table's PRIMARY KEY, which #30739 made composite. Postgres only infers
        -- functional dependency from a primary key, never from a unique index, so grouping by
        -- "personGroupId" alone leaves "isHidden" and "name" ungrouped and the query fails to plan.
        GROUP BY "person"."ownerId", "person"."personGroupId"
        HAVING NULLIF(BTRIM("person"."name"), '') IS NOT NULL
          OR COUNT(DISTINCT "eligible_faces"."assetFaceId") >= ${minimumFaceCount}
      )
      SELECT
        COUNT(DISTINCT "eligible_people"."personGroupId")::int AS "total",
        COUNT(DISTINCT "eligible_people"."personGroupId") FILTER (WHERE "eligible_people"."isHidden" = true)::int AS "hidden",
        COUNT(DISTINCT "eligible_faces"."assetFaceId")::int AS "detectedFaceCount"
      FROM "eligible_faces"
      LEFT JOIN "eligible_people" ON "eligible_people"."personGroupId" = "eligible_faces"."personGroupId"
    `.execute(this.db);

    const row = result.rows[0];
    return {
      total: Number(row?.total ?? 0),
      hidden: Number(row?.hidden ?? 0),
      detectedFaceCount: Number(row?.detectedFaceCount ?? 0),
    };
  }

  @GenerateSql({ params: [DummyValue.UUID, { minimumFaceCount: 3 }] })
  async getPeopleFaceStatistics(
    userId: string,
    options: PeopleFaceStatisticsOptions = {},
  ): Promise<PeopleFaceStatistics> {
    const minimumFaceCount = options.minimumFaceCount ?? 1;
    const result = await sql<PeopleFaceStatistics>`
      WITH "eligible_faces" AS (
        SELECT
          "asset_face"."id" AS "assetFaceId",
          "asset_face"."personGroupId"
        FROM "asset_face"
        INNER JOIN "asset" ON "asset"."id" = "asset_face"."assetId"
        WHERE "asset"."ownerId" = ${userId}
          AND "asset"."deletedAt" IS NULL
          AND "asset"."isOffline" = false
          AND "asset"."visibility" IN (${sql.join(peopleAssetVisibilities)})
          AND "asset_face"."deletedAt" IS NULL
          AND "asset_face"."isVisible" = true
      ),
      "person_face_counts" AS (
        SELECT
          "personGroupId" AS "personId",
          COUNT(DISTINCT "assetFaceId")::int AS "assetCount"
        FROM "eligible_faces"
        WHERE "personGroupId" IS NOT NULL
        GROUP BY "personGroupId"
      ),
      "detected_faces" AS (
        SELECT
          "eligible_faces"."assetFaceId",
          "person"."personGroupId" AS "personId",
          NULLIF(BTRIM("person"."name"), '') IS NOT NULL AS "isNamed",
          CASE
            WHEN "person"."personGroupId" IS NOT NULL
              AND (
                NULLIF(BTRIM("person"."name"), '') IS NOT NULL
                OR "person_face_counts"."assetCount" >= ${minimumFaceCount}
              )
            THEN "person"."isHidden"
            ELSE NULL
          END AS "isHidden"
        FROM "eligible_faces"
        LEFT JOIN "person"
          ON "person"."personGroupId" = "eligible_faces"."personGroupId"
          AND "person"."ownerId" = ${userId}
        LEFT JOIN "person_face_counts"
          ON "person_face_counts"."personId" = "person"."personGroupId"
      )
      SELECT
        COUNT(DISTINCT "assetFaceId")::int AS "detectedFaceCount",
        COUNT(DISTINCT "assetFaceId") FILTER (WHERE "isHidden" = false)::int AS "assignedVisibleFaceCount",
        COUNT(DISTINCT "personId") FILTER (WHERE "isHidden" = false AND "isNamed" = true)::int AS "namedVisiblePersonCount",
        COUNT(DISTINCT "assetFaceId") FILTER (WHERE "isHidden" = true)::int AS "assignedHiddenFaceCount",
        COUNT(DISTINCT "assetFaceId") FILTER (WHERE "isHidden" IS NULL)::int AS "unassignedFaceCount"
      FROM "detected_faces"
    `.execute(this.db);

    const row = result.rows[0];
    return {
      detectedFaceCount: Number(row?.detectedFaceCount ?? 0),
      assignedVisibleFaceCount: Number(row?.assignedVisibleFaceCount ?? 0),
      namedVisiblePersonCount: Number(row?.namedVisiblePersonCount ?? 0),
      assignedHiddenFaceCount: Number(row?.assignedHiddenFaceCount ?? 0),
      unassignedFaceCount: Number(row?.unassignedFaceCount ?? 0),
    };
  }

  @GenerateSql({ params: [DummyValue.UUID, 20] })
  getAssignedFaceEmbeddings(personId: string, limit: number) {
    return this.db
      .selectFrom('asset_face')
      .innerJoin('face_search', 'face_search.faceId', 'asset_face.id')
      .select('face_search.embedding')
      .where('asset_face.personGroupId', '=', personId)
      .where('asset_face.deletedAt', 'is', null)
      .where('asset_face.isVisible', 'is', true)
      .orderBy('asset_face.id', 'asc')
      .limit(limit)
      .execute();
  }

  /**
   * Slice 9 (F17): a person is only "scannable" — worth queueing `PersonSuggestionScan` for — when
   * BOTH cheap `EXISTS` checks below hold. Neither is the KNN the scan job itself performs, so
   * together they cannot tell whether any candidate actually falls within the configured distance
   * band for this specific person — that would need a per-person embedding search, which this
   * pre-check deliberately avoids (`handlePersonSuggestionScan` still does that work). A person who
   * passes both checks but whose real candidates all sit outside the band still gets a job that
   * finds nothing and returns early; that residual waste is not what this narrows.
   *
   * What it does remove: the previous predicate only correlated on `asset.ownerId = person.ownerId`,
   * so a single unassigned face anywhere in the owner's library queued a scan for every named,
   * visible, non-pet person that owner has — regardless of whether that person has ever been seen
   * in a photo. That is fixed by requiring the person to have at least one of their own assigned,
   * live, visible faces with an embedding (the exact precondition `getAssignedFaceEmbeddings` needs
   * before `handlePersonSuggestionScan` will do any work — a person with none is always Skipped
   * immediately, so queueing them can never do anything). The owner-side `EXISTS` keeps the
   * ownership correlation but is narrowed to `reviewableAssetVisibility` (Slice 1) so a Locked or
   * Hidden stray face no longer counts as a candidate the scan would never actually search against.
   */
  getScannablePeopleWithUnassignedFaces() {
    return this.db
      .selectFrom('person')
      .select(['person.personGroupId', 'person.ownerId'])
      .where(sql`BTRIM("person"."name")`, '<>', '')
      .where('person.isHidden', '=', false)
      .where((eb) => eb.not(personIsPet()))
      .where((eb) =>
        eb.exists(
          eb
            .selectFrom('asset_face')
            .innerJoin('face_search', 'face_search.faceId', 'asset_face.id')
            .select('asset_face.id')
            .whereRef('asset_face.personGroupId', '=', 'person.personGroupId')
            .where('asset_face.deletedAt', 'is', null)
            .where('asset_face.isVisible', 'is', true),
        ),
      )
      .where((eb) =>
        eb.exists(
          eb
            .selectFrom('asset_face')
            .innerJoin('asset', 'asset.id', 'asset_face.assetId')
            .select('asset_face.id')
            .whereRef('asset.ownerId', '=', 'person.ownerId')
            .where('asset.deletedAt', 'is', null)
            .where('asset_face.personGroupId', 'is', null)
            .where('asset_face.deletedAt', 'is', null)
            .where('asset_face.isVisible', 'is', true)
            .where('asset_face.sourceType', '=', SourceType.MachineLearning)
            .where((eb2) => reviewableAssetVisibility(eb2)),
        ),
      )
      .stream();
  }

  /**
   * Dormant people: named, non-hidden, non-pet persons whose most recent Timeline-visible,
   * previewable asset predates `lastSeenBefore`, with at least `minAssets` such assets ever.
   * The asset-side predicates mirror `MemoryRuleAssetRepository.getMemoryFacesForPeriod` exactly — a
   * missing `Preview` file or an archived asset must not make a still-active person look dormant.
   */
  @GenerateSql({
    params: [DummyValue.UUID, { lastSeenBefore: DummyValue.DATE, minAssets: 10, limit: 10 }],
  })
  getDormantPeople(
    ownerId: string,
    { lastSeenBefore, minAssets, limit }: { lastSeenBefore: Date; minAssets: number; limit: number },
  ): Promise<DormantPerson[]> {
    // Grouped by (personGroupId, name): `person`'s PK is the composite (ownerId, personGroupId),
    // so personGroupId alone does not functionally determine `person.name` for Postgres.
    return this.db
      .selectFrom('person')
      .select(['person.personGroupId as id', 'person.name'])
      .innerJoin('asset_face', 'asset_face.personGroupId', 'person.personGroupId')
      .innerJoin('asset', 'asset.id', 'asset_face.assetId')
      .where('person.ownerId', '=', ownerId)
      .where((eb) => eb.not(personIsPet()))
      .where('person.name', '!=', '')
      .where('person.isHidden', '=', false)
      .where('asset_face.deletedAt', 'is', null)
      .where('asset_face.isVisible', '=', true)
      .where('asset.ownerId', '=', ownerId)
      .where('asset.visibility', '=', AssetVisibility.Timeline)
      .where('asset.deletedAt', 'is', null)
      .where((eb) =>
        eb.exists(
          eb
            .selectFrom('asset_file')
            .select('asset_file.assetId')
            .whereRef('asset_file.assetId', '=', 'asset.id')
            .where('asset_file.type', '=', AssetFileType.Preview),
        ),
      )
      .groupBy(['person.personGroupId', 'person.name'])
      .having((eb) => eb.fn.max('asset.localDateTime'), '<', lastSeenBefore)
      .having((eb) => eb.fn.count(eb.fn('distinct', ['asset.id'])), '>=', minAssets)
      .orderBy((eb) => eb.fn.count(eb.fn('distinct', ['asset.id'])), 'desc')
      .orderBy('person.personGroupId', 'asc')
      .limit(limit)
      .execute();
  }
}
