import { Injectable } from '@nestjs/common';
import { ExpressionBuilder, Kysely, RawBuilder, sql } from 'kysely';
import { InjectKysely } from 'nestjs-kysely';
import { DummyValue, GenerateSql } from 'src/decorators.js';
import { AssetFileType, AssetType, AssetVisibility } from 'src/enum.js';
import {
  PERSON_COVER_GROWTH,
  PERSON_COVER_VERSION,
  isCoverProtected,
  type CoverCandidate,
  type PersonCoverMode,
} from 'src/gallery/utils/person-cover.js';
import { DB } from 'src/schema/index.js';
import type { PersonCoverSource } from 'src/schema/tables/person-cover.table.js';
import { spaceAlbumAssetExists } from 'src/utils/shared-space-album-scope.js';

/** A candidate face with what reading its pixels needs. */
export type CoverCandidateRow = CoverCandidate & {
  previewPath: string | null;
  imageWidth: number;
  imageHeight: number;
  boundingBoxX1: number;
  boundingBoxY1: number;
  boundingBoxX2: number;
  boundingBoxY2: number;
};

/** A hand-picked cover on one profile of an identity. `facePersonGroupId` is the personal person the face is on. */
export type IdentityHandPickedCover = {
  profileType: 'person' | 'space-person';
  profileId: string;
  faceId: string;
  facePersonGroupId: string | null;
};

export type CoverPickResult = 'changed' | 'unchanged' | 'skipped';

type CandidateRow = {
  faceId: string;
  assetId: string;
  date: Date;
  trustedDate: boolean;
  imageWidth: number;
  imageHeight: number;
  boundingBoxX1: number;
  boundingBoxY1: number;
  boundingBoxX2: number;
  boundingBoxY2: number;
  embedding: string;
  previewPath: string | null;
};

const toCandidate = (row: CandidateRow): CoverCandidateRow => ({
  ...row,
  date: new Date(row.date),
  size: Math.min(row.boundingBoxX2 - row.boundingBoxX1, row.boundingBoxY2 - row.boundingBoxY1),
  embedding: JSON.parse(row.embedding) as number[],
});

// The face and asset rules every candidate meets (specs/2026-11-21-person-cover-quality-design.md, "Candidates"):
// a visible photo face with an embedding, not a video face, on a timeline image that is neither deleted nor offline.
const candidateFaces = (db: Kysely<DB>) =>
  db
    .selectFrom('asset_face')
    .innerJoin('asset', 'asset.id', 'asset_face.assetId')
    .innerJoin('face_search', 'face_search.faceId', 'asset_face.id')
    .where('asset_face.deletedAt', 'is', null)
    .where('asset_face.isVisible', '=', true)
    .where((eb) =>
      eb.not(
        eb.exists(
          eb.selectFrom('asset_face_video_frame').whereRef('asset_face_video_frame.faceId', '=', 'asset_face.id'),
        ),
      ),
    )
    .where('asset.type', '=', AssetType.Image)
    .where('asset.deletedAt', 'is', null)
    .where('asset.isOffline', '=', false)
    .where('asset.visibility', '=', AssetVisibility.Timeline);

// Two visible faces of one person on one photo means one is misfiled; neither is a candidate.
const onlyFaceOfPersonOnAsset = (eb: ExpressionBuilder<DB, 'asset_face'>) =>
  eb.not(
    eb.exists(
      eb
        .selectFrom('asset_face as sibling')
        .whereRef('sibling.assetId', '=', 'asset_face.assetId')
        .whereRef('sibling.personGroupId', '=', 'asset_face.personGroupId')
        .whereRef('sibling.id', '!=', 'asset_face.id')
        .where('sibling.deletedAt', 'is', null)
        .where('sibling.isVisible', '=', true),
    ),
  );

// The same rule for a space person, whose faces are its shared_space_person_face rows.
const onlyFaceOfSpacePersonOnAsset = (eb: ExpressionBuilder<DB, 'asset_face' | 'shared_space_person_face'>) =>
  eb.not(
    eb.exists(
      eb
        .selectFrom('shared_space_person_face as sibling_link')
        .innerJoin('asset_face as sibling', 'sibling.id', 'sibling_link.assetFaceId')
        .whereRef('sibling_link.personId', '=', 'shared_space_person_face.personId')
        .whereRef('sibling.assetId', '=', 'asset_face.assetId')
        .whereRef('sibling.id', '!=', 'asset_face.id')
        .where('sibling.deletedAt', 'is', null)
        .where('sibling.isVisible', '=', true),
    ),
  );

// Reachable in the space by the rule isSpacePersonRepresentativeFaceValid applies: a space asset, a space library or a
// space album. `spaceId` is the column holding the space person's space.
const inSpace =
  (spaceId: 'shared_space_person.spaceId' | 'candidate_person.spaceId') =>
  (eb: ExpressionBuilder<DB, 'asset' | 'asset_face'>) =>
    eb.or([
      eb.exists(
        eb
          .selectFrom('shared_space_asset')
          .whereRef('shared_space_asset.assetId', '=', 'asset_face.assetId')
          .where('shared_space_asset.spaceId', '=', sql.ref<string>(spaceId)),
      ),
      eb.exists(
        eb
          .selectFrom('shared_space_library')
          .whereRef('shared_space_library.libraryId', '=', 'asset.libraryId')
          .where('shared_space_library.spaceId', '=', sql.ref<string>(spaceId)),
      ),
      spaceAlbumAssetExists(eb as ExpressionBuilder<DB, keyof DB>, {
        correlateAssetId: 'asset_face.assetId',
        scope: { spaceIdRef: sql.ref(spaceId) as never },
        albumTimelineGate: 'none',
      }),
    ]);

const trustedDate = sql<boolean>`(coalesce("asset_exif"."make", '') <> '' or 'dateTimeOriginal' = any(coalesce("asset_exif"."lockedProperties", '{}')))`;

const previewPath = sql<
  string | null
>`(select "asset_file"."path" from "asset_file" where "asset_file"."assetId" = "asset"."id" and "asset_file"."type" = ${AssetFileType.Preview} order by "asset_file"."isEdited" asc limit 1)`;

// Mirrors isPickStale: no row, a row that no longer holds, an older version, or a quarter more candidates.
const isStale = (
  cover: 'person_cover' | 'shared_space_person_cover',
  key: 'personGroupId' | 'spacePersonId',
  currentFace: 'person.faceAssetId' | 'candidate_person.representativeFaceId',
  count: RawBuilder<number>,
) => {
  const recorded = sql`coalesce(${sql.ref(`${cover}.candidateCount`)}, 0)`;
  return sql<boolean>`(
    ${sql.ref(`${cover}.${key}`)} is null
    or ${sql.ref(`${cover}.faceId`)} is distinct from ${sql.ref(currentFace)}
    or ${sql.ref(`${cover}.version`)} is distinct from ${sql.lit(PERSON_COVER_VERSION)}
    or (${count} > ${recorded} and ${count} >= ceil(${recorded} * ${sql.lit(PERSON_COVER_GROWTH)}))
  )`;
};

@Injectable()
export class PersonCoverRepository {
  constructor(@InjectKysely() private db: Kysely<DB>) {}

  @GenerateSql({ params: [DummyValue.UUID] })
  async getPersonCandidates(personGroupId: string): Promise<CoverCandidateRow[]> {
    const rows = await candidateFaces(this.db)
      .leftJoin('asset_exif', 'asset_exif.assetId', 'asset.id')
      .where('asset_face.personGroupId', '=', personGroupId)
      .where(onlyFaceOfPersonOnAsset)
      .select([
        'asset_face.id as faceId',
        'asset_face.assetId',
        'asset.localDateTime as date',
        'asset_face.imageWidth',
        'asset_face.imageHeight',
        'asset_face.boundingBoxX1',
        'asset_face.boundingBoxY1',
        'asset_face.boundingBoxX2',
        'asset_face.boundingBoxY2',
        sql<string>`"face_search"."embedding"::text`.as('embedding'),
        trustedDate.as('trustedDate'),
        previewPath.as('previewPath'),
      ])
      .orderBy('asset_face.id')
      .execute();
    return rows.map((row) => toCandidate(row as CandidateRow));
  }

  @GenerateSql({ params: [DummyValue.UUID] })
  async getSpacePersonCandidates(spacePersonId: string): Promise<CoverCandidateRow[]> {
    const rows = await candidateFaces(this.db)
      .innerJoin('shared_space_person_face', 'shared_space_person_face.assetFaceId', 'asset_face.id')
      .innerJoin('shared_space_person', 'shared_space_person.id', 'shared_space_person_face.personId')
      .leftJoin('asset_exif', 'asset_exif.assetId', 'asset.id')
      .where('shared_space_person_face.personId', '=', spacePersonId)
      .where(onlyFaceOfSpacePersonOnAsset)
      .where(inSpace('shared_space_person.spaceId'))
      .select([
        'asset_face.id as faceId',
        'asset_face.assetId',
        'asset.localDateTime as date',
        'asset_face.imageWidth',
        'asset_face.imageHeight',
        'asset_face.boundingBoxX1',
        'asset_face.boundingBoxY1',
        'asset_face.boundingBoxX2',
        'asset_face.boundingBoxY2',
        sql<string>`"face_search"."embedding"::text`.as('embedding'),
        trustedDate.as('trustedDate'),
        previewPath.as('previewPath'),
      ])
      .orderBy('asset_face.id')
      .execute();
    return rows.map((row) => toCandidate(row as CandidateRow));
  }

  @GenerateSql({ params: [DummyValue.UUID] })
  getPersonCover(personGroupId: string) {
    return this.db
      .selectFrom('person_cover')
      .select(['source', 'faceId', 'candidateCount', 'version'])
      .where('personGroupId', '=', personGroupId)
      .executeTakeFirst();
  }

  @GenerateSql({ params: [DummyValue.UUID] })
  getSpacePersonCover(spacePersonId: string) {
    return this.db
      .selectFrom('shared_space_person_cover')
      .select(['faceId', 'candidateCount', 'version'])
      .where('spacePersonId', '=', spacePersonId)
      .executeTakeFirst();
  }

  /**
  The personal people a run should look at: never hidden people or pets, never a holding `manual` cover, and on a
  Missing run never a holding `unknown` one either, and only when the last automatic pick is stale.
  */
  @GenerateSql({ params: [{ force: false }], stream: true })
  streamPeopleToPick({ force }: { force: boolean }) {
    const count = sql<number>`(select count(*)::int from (${candidateFaces(this.db)
      .where('asset_face.personGroupId', '=', sql.ref<string>('person.personGroupId'))
      .where(onlyFaceOfPersonOnAsset)
      .select('asset_face.id')}) as candidates)`;
    return (
      this.db
        .selectFrom('person')
        .leftJoin('person_cover', 'person_cover.personGroupId', 'person.personGroupId')
        .select('person.personGroupId')
        .where('person.isHidden', '=', false)
        .where((eb) =>
          eb.not(
            eb.exists(eb.selectFrom('person_pet').whereRef('person_pet.personGroupId', '=', 'person.personGroupId')),
          ),
        )
        // isCoverProtected: a holding `manual` row, or on a Missing run a holding `unknown` one. No row is not protected.
        .where(
          sql<boolean>`not coalesce("person_cover"."source" in (${sql.join(force ? ['manual'] : ['manual', 'unknown'])}) and "person_cover"."faceId" = "person"."faceAssetId", false)`,
        )
        .$if(!force, (qb) => qb.where(isStale('person_cover', 'personGroupId', 'person.faceAssetId', count)))
        .orderBy('person.personGroupId')
        .stream()
    );
  }

  /** The space people a run should look at: automatic, not hidden, not pets, and on a Missing run only stale ones. */
  @GenerateSql({ params: [{ force: false }], stream: true })
  streamSpacePeopleToPick({ force }: { force: boolean }) {
    const count = sql<number>`(select count(*)::int from (${candidateFaces(this.db)
      .innerJoin('shared_space_person_face', 'shared_space_person_face.assetFaceId', 'asset_face.id')
      .where('shared_space_person_face.personId', '=', sql.ref<string>('candidate_person.id'))
      .where(onlyFaceOfSpacePersonOnAsset)
      .where(inSpace('candidate_person.spaceId'))
      .select('asset_face.id')}) as candidates)`;
    return this.db
      .selectFrom('shared_space_person as candidate_person')
      .leftJoin('shared_space_person_cover', 'shared_space_person_cover.spacePersonId', 'candidate_person.id')
      .select('candidate_person.id')
      .where('candidate_person.representativeFaceSource', '=', 'auto')
      .where('candidate_person.isHidden', '=', false)
      .where('candidate_person.type', '=', 'person')
      .$if(!force, (qb) =>
        qb.where(isStale('shared_space_person_cover', 'spacePersonId', 'candidate_person.representativeFaceId', count)),
      )
      .orderBy('candidate_person.id')
      .stream();
  }

  /**
  The holding hand-picked covers on the profiles of an identity: personal people with a holding `manual` row, and
  space people whose source is `manual`.
  */
  @GenerateSql({ params: [DummyValue.UUID] })
  async getIdentityHandPickedCovers(identityId: string): Promise<IdentityHandPickedCover[]> {
    const personal = await this.db
      .selectFrom('person_identity')
      .innerJoin('person', 'person.personGroupId', 'person_identity.personGroupId')
      .innerJoin('person_cover', 'person_cover.personGroupId', 'person.personGroupId')
      .innerJoin('asset_face', 'asset_face.id', 'person_cover.faceId')
      .select([
        'person.personGroupId as profileId',
        'person_cover.faceId',
        'asset_face.personGroupId as facePersonGroupId',
      ])
      .where('person_identity.identityId', '=', identityId)
      .where('person_cover.source', '=', 'manual')
      .whereRef('person_cover.faceId', '=', 'person.faceAssetId')
      .where('asset_face.deletedAt', 'is', null)
      .execute();
    const space = await this.db
      .selectFrom('shared_space_person')
      .innerJoin('asset_face', 'asset_face.id', 'shared_space_person.representativeFaceId')
      .select([
        'shared_space_person.id as profileId',
        'shared_space_person.representativeFaceId as faceId',
        'asset_face.personGroupId as facePersonGroupId',
      ])
      .where('shared_space_person.identityId', '=', identityId)
      .where('shared_space_person.representativeFaceSource', '=', 'manual')
      .where('asset_face.deletedAt', 'is', null)
      .execute();

    return [
      ...personal.map((row) => ({ ...row, faceId: row.faceId!, profileType: 'person' as const })),
      ...space.map((row) => ({ ...row, faceId: row.faceId!, profileType: 'space-person' as const })),
    ];
  }

  @GenerateSql({ params: [DummyValue.UUID, DummyValue.UUID] })
  async recordHandPick(personGroupId: string, faceId: string): Promise<void> {
    await this.upsertPersonCover({ personGroupId, faceId, source: 'manual', candidateCount: null, version: null });
  }

  @GenerateSql({ params: [DummyValue.UUID, DummyValue.UUID] })
  async recordSpaceHandPick(spacePersonId: string, faceId: string): Promise<void> {
    await this.db
      .insertInto('shared_space_person_cover')
      .values({ spacePersonId, faceId, candidateCount: null, version: null, pickedAt: sql`now()` })
      .onConflict((oc) =>
        oc.column('spacePersonId').doUpdateSet({
          faceId,
          candidateCount: null,
          version: null,
          pickedAt: sql`now()`,
        }),
      )
      .execute();
  }

  /**
  Sets a personal person's cover to `faceId` (null keeps the current one) and records the pick as `auto`, unless the
  cover became protected for `mode` while the previews were read, or the face left the person. The person row is
  locked first, so a hand pick committed meanwhile wins.
  */
  async applyPersonPick(input: {
    personGroupId: string;
    faceId: string | null;
    candidateCount: number;
    mode: PersonCoverMode;
  }): Promise<CoverPickResult> {
    const { personGroupId, candidateCount, mode } = input;
    return this.db.transaction().execute(async (trx) => {
      const person = await trx
        .selectFrom('person')
        .select('faceAssetId')
        .where('personGroupId', '=', personGroupId)
        .forUpdate()
        .executeTakeFirst();
      if (!person) {
        return 'skipped';
      }

      const cover = await trx
        .selectFrom('person_cover')
        .select(['source', 'faceId'])
        .where('personGroupId', '=', personGroupId)
        .executeTakeFirst();
      if (isCoverProtected(cover, person.faceAssetId, mode)) {
        return 'skipped';
      }

      const faceId = input.faceId ?? person.faceAssetId;
      const changed = faceId !== null && faceId !== person.faceAssetId;
      if (changed) {
        const face = await trx
          .selectFrom('asset_face')
          .select('id')
          .where('id', '=', faceId)
          .where('personGroupId', '=', personGroupId)
          .where('deletedAt', 'is', null)
          .executeTakeFirst();
        if (!face) {
          return 'skipped';
        }
        await trx
          .updateTable('person')
          .set({ faceAssetId: faceId })
          .where('personGroupId', '=', personGroupId)
          .execute();
      }

      await this.upsertPersonCover(
        { personGroupId, faceId, source: 'auto', candidateCount, version: PERSON_COVER_VERSION },
        trx,
      );
      return changed ? 'changed' : 'unchanged';
    });
  }

  /**
  Sets an automatic space person's cover to `faceId` (null keeps the current one) and records the pick. Does nothing
  once someone picked a face by hand, or when the face is no longer one of the space person's.
  */
  async applySpacePersonPick(input: {
    spacePersonId: string;
    faceId: string | null;
    candidateCount: number;
  }): Promise<CoverPickResult> {
    const { spacePersonId, candidateCount } = input;
    return this.db.transaction().execute(async (trx) => {
      const person = await trx
        .selectFrom('shared_space_person')
        .select(['representativeFaceId', 'representativeFaceSource'])
        .where('id', '=', spacePersonId)
        .forUpdate()
        .executeTakeFirst();
      if (!person || person.representativeFaceSource !== 'auto') {
        return 'skipped';
      }

      const faceId = input.faceId ?? person.representativeFaceId;
      const changed = faceId !== null && faceId !== person.representativeFaceId;
      if (changed) {
        const link = await trx
          .selectFrom('shared_space_person_face')
          .select('assetFaceId')
          .where('personId', '=', spacePersonId)
          .where('assetFaceId', '=', faceId)
          .executeTakeFirst();
        if (!link) {
          return 'skipped';
        }
        await trx
          .updateTable('shared_space_person')
          .set({ representativeFaceId: faceId })
          .where('id', '=', spacePersonId)
          .execute();
      }

      const values = { faceId, candidateCount, version: PERSON_COVER_VERSION, pickedAt: sql<Date>`now()` };
      await trx
        .insertInto('shared_space_person_cover')
        .values({ spacePersonId, ...values })
        .onConflict((oc) => oc.column('spacePersonId').doUpdateSet(values))
        .execute();
      return changed ? 'changed' : 'unchanged';
    });
  }

  private async upsertPersonCover(
    row: {
      personGroupId: string;
      faceId: string | null;
      source: PersonCoverSource;
      candidateCount: number | null;
      version: number | null;
    },
    db: Kysely<DB> = this.db,
  ) {
    const { personGroupId: _personGroupId, ...values } = row;
    await db
      .insertInto('person_cover')
      .values({ ...row, pickedAt: sql`now()` })
      .onConflict((oc) => oc.column('personGroupId').doUpdateSet({ ...values, pickedAt: sql`now()` }))
      .execute();
  }
}
