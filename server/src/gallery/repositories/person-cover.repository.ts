import { Injectable } from '@nestjs/common';
import { ExpressionBuilder, Insertable, Kysely, RawBuilder, sql } from 'kysely';
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
import { personIsPet } from 'src/gallery/utils/person-sidecar.js';
import { DB } from 'src/schema/index.js';
import type { PersonCoverTable } from 'src/schema/tables/person-cover.table.js';
import type { SharedSpacePersonCoverTable } from 'src/schema/tables/shared-space-person-cover.table.js';
import { withFilePath } from 'src/utils/database.js';
import { spaceAssetPathBranches } from 'src/utils/shared-space-album-scope.js';

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

/** A hand-picked cover on a profile of an identity, and the personal person its face is on. */
export type IdentityHandPickedCover = { faceId: string; facePersonGroupId: string | null };

export type CoverPickResult = 'changed' | 'unchanged' | 'skipped';

const toCandidate = <
  R extends {
    date: Date | string;
    embedding: string;
    boundingBoxX1: number;
    boundingBoxY1: number;
    boundingBoxX2: number;
    boundingBoxY2: number;
  },
>(
  row: R,
) => ({
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

// Reachable in the space of the joined shared_space_person, by the paths isSpacePersonRepresentativeFaceValid accepts:
// a space asset, a space library or a space album.
const inSpace = (eb: ExpressionBuilder<DB, keyof DB>) =>
  eb.or(
    spaceAssetPathBranches(eb, {
      correlateAssetId: 'asset_face.assetId',
      correlateLibraryId: 'asset.libraryId',
      scope: { spaceIdRef: 'shared_space_person.spaceId' },
      albumTimelineGate: 'none',
    }),
  );

/** A personal person's candidate faces. `personGroupId` is a value, or a reference to correlate with. */
const personCandidates = (db: Kysely<DB>, personGroupId: string | RawBuilder<string>) =>
  candidateFaces(db).where('asset_face.personGroupId', '=', personGroupId).where(onlyFaceOfPersonOnAsset);

/** A space person's candidate faces: its faces reachable in its space. */
const spacePersonCandidates = (db: Kysely<DB>, spacePersonId: string | RawBuilder<string>) =>
  candidateFaces(db)
    .innerJoin('shared_space_person_face', 'shared_space_person_face.assetFaceId', 'asset_face.id')
    .innerJoin('shared_space_person', 'shared_space_person.id', 'shared_space_person_face.personId')
    .where('shared_space_person_face.personId', '=', spacePersonId)
    .where(onlyFaceOfSpacePersonOnAsset)
    .where(inSpace);

const trustedDate = sql<boolean>`(coalesce("asset_exif"."make", '') <> '' or 'dateTimeOriginal' = any(coalesce("asset_exif"."lockedProperties", '{}')))`;

// What pickCover and the pixel reader need of a candidate. The preview is the unedited one, which the face box was
// detected on, as the person thumbnail job reads it.
const candidateColumns = (eb: ExpressionBuilder<DB, 'asset' | 'asset_face' | 'face_search' | 'asset_exif'>) =>
  [
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
    withFilePath(eb, AssetFileType.Preview).as('previewPath'),
  ] as const;

const countOf = (query: { select: (column: 'asset_face.id') => unknown }) =>
  sql<number>`(select count(*)::int from (${query.select('asset_face.id') as never}) as candidates)`;

// Mirrors isPickStale: no row, a row that no longer holds, an older version, or a quarter more candidates. The growth
// test counts the profile's raw faces first, on its index, and the candidates only when that count could have grown
// enough: a fresh pick, the usual case, then costs no candidate scan.
const isStale = (
  cover: 'person_cover' | 'shared_space_person_cover',
  key: 'personGroupId' | 'spacePersonId',
  currentFace: 'person.faceAssetId' | 'candidate_person.representativeFaceId',
  counts: { faces: RawBuilder<number>; candidates: RawBuilder<number> },
) => {
  const recorded = sql`coalesce(${sql.ref(`${cover}.candidateCount`)}, 0)`;
  const threshold = sql`greatest(ceil(${recorded} * ${sql.lit(PERSON_COVER_GROWTH)}), ${recorded} + 1)`;
  return sql<boolean>`(
    ${sql.ref(`${cover}.${key}`)} is null
    or ${sql.ref(`${cover}.faceId`)} is distinct from ${sql.ref(currentFace)}
    or ${sql.ref(`${cover}.version`)} is distinct from ${sql.lit(PERSON_COVER_VERSION)}
    or case when ${counts.faces} >= ${threshold} then ${counts.candidates} >= ${threshold} else false end
  )`;
};

@Injectable()
export class PersonCoverRepository {
  constructor(@InjectKysely() private db: Kysely<DB>) {}

  @GenerateSql({ params: [DummyValue.UUID] })
  async getPersonCandidates(personGroupId: string): Promise<CoverCandidateRow[]> {
    const rows = await personCandidates(this.db, personGroupId)
      .leftJoin('asset_exif', 'asset_exif.assetId', 'asset.id')
      .select(candidateColumns)
      .orderBy('asset_face.id')
      .execute();
    return rows.map((row) => toCandidate(row));
  }

  @GenerateSql({ params: [DummyValue.UUID] })
  async getSpacePersonCandidates(spacePersonId: string): Promise<CoverCandidateRow[]> {
    const rows = await spacePersonCandidates(this.db, spacePersonId)
      .leftJoin('asset_exif', 'asset_exif.assetId', 'asset.id')
      .select(candidateColumns)
      .orderBy('asset_face.id')
      .execute();
    return rows.map((row) => toCandidate(row));
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
    const personGroupId = sql.ref<string>('person.personGroupId');
    const counts = {
      faces: sql<number>`(select count(*)::int from "asset_face" where "asset_face"."personGroupId" = ${personGroupId})`,
      candidates: countOf(personCandidates(this.db, personGroupId)),
    };
    return (
      this.db
        .selectFrom('person')
        .leftJoin('person_cover', 'person_cover.personGroupId', 'person.personGroupId')
        .select('person.personGroupId')
        .where('person.isHidden', '=', false)
        .where(sql<boolean>`not ${personIsPet()}`)
        // isCoverProtected: a holding `manual` row, or on a Missing run a holding `unknown` one. No row is not protected.
        .where(
          sql<boolean>`not coalesce("person_cover"."source" in (${sql.join(force ? ['manual'] : ['manual', 'unknown'])}) and "person_cover"."faceId" = "person"."faceAssetId", false)`,
        )
        .$if(!force, (qb) => qb.where(isStale('person_cover', 'personGroupId', 'person.faceAssetId', counts)))
        .orderBy('person.personGroupId')
        .stream()
    );
  }

  /** The space people a run should look at: automatic, not hidden, not pets, and on a Missing run only stale ones. */
  @GenerateSql({ params: [{ force: false }], stream: true })
  streamSpacePeopleToPick({ force }: { force: boolean }) {
    const spacePersonId = sql.ref<string>('candidate_person.id');
    const counts = {
      faces: sql<number>`(select count(*)::int from "shared_space_person_face" where "shared_space_person_face"."personId" = ${spacePersonId})`,
      candidates: countOf(spacePersonCandidates(this.db, spacePersonId)),
    };
    return this.db
      .selectFrom('shared_space_person as candidate_person')
      .leftJoin('shared_space_person_cover', 'shared_space_person_cover.spacePersonId', 'candidate_person.id')
      .select('candidate_person.id')
      .where('candidate_person.representativeFaceSource', '=', 'auto')
      .where('candidate_person.isHidden', '=', false)
      .where('candidate_person.type', '=', 'person')
      .$if(!force, (qb) =>
        qb.where(
          isStale('shared_space_person_cover', 'spacePersonId', 'candidate_person.representativeFaceId', counts),
        ),
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
      .select(['asset_face.id as faceId', 'asset_face.personGroupId as facePersonGroupId'])
      .where('person_identity.identityId', '=', identityId)
      .where('person_cover.source', '=', 'manual')
      .whereRef('person_cover.faceId', '=', 'person.faceAssetId')
      .where('asset_face.deletedAt', 'is', null)
      .execute();
    const space = await this.db
      .selectFrom('shared_space_person')
      .innerJoin('asset_face', 'asset_face.id', 'shared_space_person.representativeFaceId')
      .select(['asset_face.id as faceId', 'asset_face.personGroupId as facePersonGroupId'])
      .where('shared_space_person.identityId', '=', identityId)
      .where('shared_space_person.representativeFaceSource', '=', 'manual')
      .where('asset_face.deletedAt', 'is', null)
      .execute();

    return [...personal, ...space];
  }

  @GenerateSql({ params: [DummyValue.UUID, DummyValue.UUID] })
  async recordHandPick(personGroupId: string, faceId: string): Promise<void> {
    await this.upsertPersonCover({ personGroupId, faceId, source: 'manual', candidateCount: null, version: null });
  }

  @GenerateSql({ params: [DummyValue.UUID, DummyValue.UUID] })
  async recordSpaceHandPick(spacePersonId: string, faceId: string): Promise<void> {
    await this.upsertSpacePersonCover({ spacePersonId, faceId, candidateCount: null, version: null });
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

      await this.upsertSpacePersonCover({ spacePersonId, faceId, candidateCount, version: PERSON_COVER_VERSION }, trx);
      return changed ? 'changed' : 'unchanged';
    });
  }

  private async upsertPersonCover(
    { personGroupId, ...row }: Omit<Insertable<PersonCoverTable>, 'pickedAt'>,
    db: Kysely<DB> = this.db,
  ) {
    const values = { ...row, pickedAt: sql<Date>`now()` };
    await db
      .insertInto('person_cover')
      .values({ personGroupId, ...values })
      .onConflict((oc) => oc.column('personGroupId').doUpdateSet(values))
      .execute();
  }

  private async upsertSpacePersonCover(
    { spacePersonId, ...row }: Omit<Insertable<SharedSpacePersonCoverTable>, 'pickedAt'>,
    db: Kysely<DB> = this.db,
  ) {
    const values = { ...row, pickedAt: sql<Date>`now()` };
    await db
      .insertInto('shared_space_person_cover')
      .values({ spacePersonId, ...values })
      .onConflict((oc) => oc.column('spacePersonId').doUpdateSet(values))
      .execute();
  }
}
