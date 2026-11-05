import { Injectable } from '@nestjs/common';
import { Insertable, Kysely, sql } from 'kysely';
import { InjectKysely } from 'nestjs-kysely';
import { DummyValue, GenerateSql } from 'src/decorators.js';
import { AssetType, AssetVisibility } from 'src/enum.js';
import { DB } from 'src/schema/index.js';
import { AssetFaceVideoFrameTable } from 'src/schema/tables/asset-face-video-frame.table.js';
import { AssetFaceTable } from 'src/schema/tables/asset-face.table.js';
import { asUuid, petFacePredicate } from 'src/utils/database.js';

export type VideoFaceBox = {
  imageWidth: number;
  imageHeight: number;
  boundingBoxX1: number;
  boundingBoxY1: number;
  boundingBoxX2: number;
  boundingBoxY2: number;
};

export type VideoFaceChanges = {
  /** New faces, with their ids already chosen so frames and embeddings can refer to them. */
  insert: (Insertable<AssetFaceTable> & { id: string; assetId: string })[];
  /** Existing faces whose box moves to a new best frame. */
  update: ({ id: string } & VideoFaceBox)[];
  deleteIds: string[];
  embeddings: { faceId: string; embedding: string }[];
  frames: Insertable<AssetFaceVideoFrameTable>[];
};

// Video faces sampled across the whole video (specs/2026-10-31-video-face-frames-design.md).
@Injectable()
export class VideoFaceRepository {
  constructor(@InjectKysely() private db: Kysely<DB>) {}

  /** The video, its trim, and every face it already has, with what a re-scan needs to keep their ids. */
  @GenerateSql({ params: [DummyValue.UUID] })
  async getForDetect(id: string) {
    const asset = await this.db
      .selectFrom('asset')
      .leftJoin('asset_video_trim', 'asset_video_trim.assetId', 'asset.id')
      .select([
        'asset.id',
        'asset.ownerId',
        'asset.type',
        'asset.visibility',
        'asset.originalPath',
        'asset_video_trim.startTime as trimStart',
        'asset_video_trim.endTime as trimEnd',
      ])
      .where('asset.id', '=', asUuid(id))
      .where('asset.deletedAt', 'is', null)
      .executeTakeFirst();
    if (!asset) {
      return;
    }

    const faces = await this.db
      .selectFrom('asset_face')
      .leftJoin('face_search', 'face_search.faceId', 'asset_face.id')
      .leftJoin('asset_face_video_frame', 'asset_face_video_frame.faceId', 'asset_face.id')
      .select((eb) => [
        'asset_face.id',
        'asset_face.personGroupId',
        'asset_face.sourceType',
        'asset_face.imageWidth',
        'asset_face.imageHeight',
        'asset_face.boundingBoxX1',
        'asset_face.boundingBoxY1',
        'asset_face.boundingBoxX2',
        'asset_face.boundingBoxY2',
        'face_search.embedding',
        'asset_face_video_frame.path as framePath',
        petFacePredicate(eb).as('isPet'),
      ])
      .where('asset_face.assetId', '=', asUuid(id))
      .where('asset_face.deletedAt', 'is', null)
      .execute();

    return { ...asset, faces };
  }

  /** Applies one re-scan in a single transaction, so a video never shows half of an old scan and half of a new one. */
  async apply({ insert, update, deleteIds, embeddings, frames }: VideoFaceChanges): Promise<void> {
    await this.db.transaction().execute(async (trx) => {
      if (deleteIds.length > 0) {
        await trx.deleteFrom('asset_face').where('asset_face.id', 'in', deleteIds).execute();
      }
      if (insert.length > 0) {
        await trx.insertInto('asset_face').values(insert).execute();
      }
      for (const { id, ...box } of update) {
        await trx.updateTable('asset_face').set(box).where('asset_face.id', '=', id).execute();
      }
      if (embeddings.length > 0) {
        await trx
          .insertInto('face_search')
          .values(embeddings)
          .onConflict((oc) => oc.column('faceId').doUpdateSet((eb) => ({ embedding: eb.ref('excluded.embedding') })))
          .execute();
      }
      if (frames.length > 0) {
        await trx
          .insertInto('asset_face_video_frame')
          .values(frames)
          .onConflict((oc) =>
            oc.column('faceId').doUpdateSet((eb) => ({
              path: eb.ref('excluded.path'),
              timeSeconds: eb.ref('excluded.timeSeconds'),
              quality: eb.ref('excluded.quality'),
              sightings: eb.ref('excluded.sightings'),
              version: eb.ref('excluded.version'),
              createdAt: sql`now()`,
            })),
          )
          .execute();
      }
    });
  }

  /** The best frame of one face, or undefined for a photo face or a video face from single-frame detection. */
  @GenerateSql({ params: [DummyValue.UUID] })
  async getFramePath(faceId: string): Promise<string | undefined> {
    const row = await this.db
      .selectFrom('asset_face_video_frame')
      .select('path')
      .where('faceId', '=', asUuid(faceId))
      .executeTakeFirst();
    return row?.path;
  }

  /** The best frame of a person's representative face, for the person thumbnail. */
  @GenerateSql({ params: [{ ownerId: DummyValue.UUID, personGroupId: DummyValue.UUID }] })
  async getRepresentativeFramePath({ ownerId, personGroupId }: { ownerId: string; personGroupId: string }) {
    const row = await this.db
      .selectFrom('person')
      .innerJoin('asset_face_video_frame', 'asset_face_video_frame.faceId', 'person.faceAssetId')
      .select('asset_face_video_frame.path')
      .where('person.ownerId', '=', asUuid(ownerId))
      .where('person.personGroupId', '=', asUuid(personGroupId))
      .executeTakeFirst();
    return row?.path;
  }

  /** The people whose representative face is one of `faceIds`: their thumbnails are cut from a frame that changed. */
  @GenerateSql({ params: [[DummyValue.UUID]] })
  getPeopleRepresentedBy(faceIds: string[]) {
    return this.db
      .selectFrom('person')
      .select(['person.ownerId', 'person.personGroupId'])
      .where('person.faceAssetId', 'in', faceIds)
      .execute();
  }

  /** Visible videos face detection has already been through, but not this sampler: what its Missing job adds. */
  @GenerateSql({ params: [], stream: true })
  streamUnsampled() {
    return this.db
      .selectFrom('asset')
      .innerJoin('asset_job_status', 'asset_job_status.assetId', 'asset.id')
      .leftJoin('asset_job_status_gallery', 'asset_job_status_gallery.assetId', 'asset.id')
      .select('asset.id')
      .where('asset.type', '=', sql.lit(AssetType.Video))
      .where('asset.deletedAt', 'is', null)
      .where('asset.visibility', '!=', sql.lit(AssetVisibility.Hidden))
      .where('asset_job_status.facesRecognizedAt', 'is not', null)
      .where('asset_job_status_gallery.videoFacesSampledAt', 'is', null)
      .stream();
  }

  @GenerateSql({ params: [DummyValue.UUID] })
  async markSampled(assetId: string): Promise<void> {
    await this.db
      .insertInto('asset_job_status_gallery')
      .values({ assetId, videoFacesSampledAt: sql`now()` })
      .onConflict((oc) => oc.column('assetId').doUpdateSet({ videoFacesSampledAt: sql`now()` }))
      .execute();
  }

  /** The best frames among `paths`, for IntegrityService: they sit in the thumbnail folder the untracked-file scan walks. */
  @GenerateSql({ params: [DummyValue.STRING] })
  getPathsByPaths(paths: string[]) {
    return this.db.selectFrom('asset_face_video_frame').select('path').where('path', 'in', paths).execute();
  }
}
