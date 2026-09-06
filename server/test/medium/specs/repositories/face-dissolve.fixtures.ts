import { Kysely } from 'kysely';
import { AssetFileType, AssetVisibility, SourceType } from 'src/enum';
import { DB } from 'src/schema';
import { mediumFactory } from 'test/medium.factory';
import { newUuid } from 'test/small.factory';

export const ZERO_EMBEDDING = '[' + Array.from({ length: 512 }, () => 0).join(',') + ']';

export const seedUser = async (db: Kysely<DB>) => {
  const user = mediumFactory.userInsert({});
  await db.insertInto('user').values(user).execute();
  return user;
};

export const seedPerson = async (db: Kysely<DB>, dto: { ownerId: string; name?: string; type?: string }) => {
  const person = mediumFactory.personInsert({ ...dto, name: dto.name ?? 'Person' });
  await db.insertInto('person').values(person).execute();
  return person;
};

/**
 * `withPreview` and `visibility` decide whether the asset can ever be re-detected:
 * assetsWithPreviews() (asset-job.repository.ts:181) requires a non-hidden, non-trashed asset
 * carrying a Preview file. Seeding without one makes a re-detection assertion pass for the wrong reason.
 */
export const seedAsset = async (
  db: Kysely<DB>,
  dto: { ownerId: string; withPreview?: boolean; visibility?: AssetVisibility },
) => {
  const asset = mediumFactory.assetInsert({ ownerId: dto.ownerId, visibility: dto.visibility });
  await db.insertInto('asset').values(asset).execute();

  if (dto.withPreview !== false) {
    await db
      .insertInto('asset_file')
      .values({ id: newUuid(), assetId: asset.id, type: AssetFileType.Preview, path: `/preview/${asset.id}.jpg` })
      .execute();
  }
  return asset;
};

export const seedFace = async (
  db: Kysely<DB>,
  dto: {
    assetId: string;
    personId: string;
    sourceType?: SourceType;
    withEmbedding?: boolean;
    isPet?: boolean;
    deletedAt?: Date;
  },
) => {
  const face = mediumFactory.assetFaceInsert({
    assetId: dto.assetId,
    personId: dto.personId,
    sourceType: dto.sourceType ?? SourceType.MachineLearning,
    deletedAt: dto.deletedAt,
  });
  await db.insertInto('asset_face').values(face).execute();

  if (dto.isPet) {
    await db.insertInto('pet_search').values({ faceId: face.id, embedding: ZERO_EMBEDDING }).execute();
  } else if (dto.withEmbedding) {
    await db.insertInto('face_search').values({ faceId: face.id, embedding: ZERO_EMBEDDING }).execute();
  }
  return face;
};

/** ctx.newJobStatus drops every field but assetId, so the watermark has to be written directly. */
export const setFacesRecognizedAt = async (db: Kysely<DB>, assetId: string, at: Date | null) => {
  await db
    .insertInto('asset_job_status')
    .values({ assetId, facesRecognizedAt: at })
    .onConflict((oc) => oc.column('assetId').doUpdateSet({ facesRecognizedAt: at }))
    .execute();
};
