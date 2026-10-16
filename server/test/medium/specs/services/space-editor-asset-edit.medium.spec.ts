/**
 * What a space Editor may do to another member's asset (specs/2026-08-14-space-editor-asset-permissions-design.md):
 * every edit call site the design grants, and none of the owner-only filing writes. Permission.AssetUpdate keeps
 * Immich's owner-only meaning; the granted sites go through requireAssetEditAccess.
 */
import { BadRequestException } from '@nestjs/common';
import { Kysely } from 'kysely';
import { AssetJobName } from 'src/dtos/asset.dto.js';
import { MemoryType } from 'src/enum.js';
import { GalleryAssetRepository } from 'src/gallery/repositories/gallery-asset.repository.js';
import { AccessRepository } from 'src/repositories/access.repository.js';
import { AlbumRepository } from 'src/repositories/album.repository.js';
import { AssetEditRepository } from 'src/repositories/asset-edit.repository.js';
import { AssetFavoriteRepository } from 'src/repositories/asset-favorite.repository.js';
import { AssetJobRepository } from 'src/repositories/asset-job.repository.js';
import { AssetRepository } from 'src/repositories/asset.repository.js';
import { ConfigRepository } from 'src/repositories/config.repository.js';
import { DatabaseRepository } from 'src/repositories/database.repository.js';
import { DuplicateRepository } from 'src/repositories/duplicate.repository.js';
import { EventRepository } from 'src/repositories/event.repository.js';
import { FaceIdentityRepository } from 'src/repositories/face-identity.repository.js';
import { FacePersonVerdictRepository } from 'src/repositories/face-person-verdict.repository.js';
import { JobRepository } from 'src/repositories/job.repository.js';
import { LoggingRepository } from 'src/repositories/logging.repository.js';
import { MemoryRepository } from 'src/repositories/memory.repository.js';
import { PersonRepository } from 'src/repositories/person.repository.js';
import { SharedSpaceRepository } from 'src/repositories/shared-space.repository.js';
import { StackRepository } from 'src/repositories/stack.repository.js';
import { StorageRepository } from 'src/repositories/storage.repository.js';
import { TagRepository } from 'src/repositories/tag.repository.js';
import { UserRepository } from 'src/repositories/user.repository.js';
import { DB } from 'src/schema/index.js';
import { AssetService } from 'src/services/asset.service.js';
import { BaseService } from 'src/services/base.service.js';
import { DuplicateService } from 'src/services/duplicate.service.js';
import { MemoryService } from 'src/services/memory.service.js';
import { PersonService } from 'src/services/person.service.js';
import { StackService } from 'src/services/stack.service.js';
import { TagService } from 'src/services/tag.service.js';
import { newMediumService } from 'test/medium.factory.js';
import { factory } from 'test/small.factory.js';
import { getKyselyDB } from 'test/utils.js';

let defaultDatabase: Kysely<DB>;

const setup = async () => {
  const { ctx } = newMediumService(BaseService, {
    database: defaultDatabase,
    real: [
      AccessRepository,
      AlbumRepository,
      AssetEditRepository,
      AssetFavoriteRepository,
      AssetJobRepository,
      AssetRepository,
      GalleryAssetRepository,
      ConfigRepository,
      DatabaseRepository,
      DuplicateRepository,
      FaceIdentityRepository,
      FacePersonVerdictRepository,
      MemoryRepository,
      PersonRepository,
      SharedSpaceRepository,
      StackRepository,
      TagRepository,
      UserRepository,
    ],
    mock: [EventRepository, JobRepository, LoggingRepository, StorageRepository],
  });
  ctx.getMock(EventRepository).emit.mockResolvedValue();
  ctx.getMock(JobRepository).queue.mockResolvedValue();
  ctx.getMock(JobRepository).queueAll.mockResolvedValue();

  const { user: owner } = await ctx.newUser();
  const { user: editor } = await ctx.newUser();
  const { space } = await ctx.newSharedSpace({ createdById: owner.id });
  await ctx.newSharedSpaceMember({ spaceId: space.id, userId: owner.id, role: 'owner' });
  await ctx.newSharedSpaceMember({ spaceId: space.id, userId: editor.id, role: 'editor' });

  const duplicateId = factory.uuid();
  const { asset } = await ctx.newAsset({ ownerId: owner.id, width: 200, height: 200, duplicateId });
  const { asset: other } = await ctx.newAsset({ ownerId: owner.id, duplicateId });
  for (const { id } of [asset, other]) {
    await ctx.newExif({ assetId: id, exifImageHeight: 200, exifImageWidth: 200 });
    await ctx.newSharedSpaceAsset({ spaceId: space.id, assetId: id, addedById: owner.id });
  }

  return { ctx, auth: factory.auth({ user: { id: editor.id } }), editor, asset, other, duplicateId };
};

beforeAll(async () => {
  defaultDatabase = await getKyselyDB();
});

describe('space editor on a member asset', () => {
  it('may update the asset, its metadata, run its jobs, tag it and add a face', async () => {
    const { ctx, auth, editor, asset } = await setup();
    const assets = ctx.getService(AssetService);
    const id = asset.id;

    await expect(assets.update(auth, id, { description: 'by editor' })).resolves.toBeDefined();
    await expect(assets.updateAll(auth, { ids: [id], description: 'by editor, bulk' })).resolves.toBeUndefined();
    await expect(assets.upsertMetadata(auth, id, { items: [{ key: 'one', value: { a: 1 } }] })).resolves.toHaveLength(
      1,
    );
    await expect(
      assets.upsertBulkMetadata(auth, { items: [{ assetId: id, key: 'two', value: { b: 2 } }] }),
    ).resolves.toHaveLength(1);
    await expect(assets.deleteMetadataByKey(auth, id, 'one')).resolves.toBeUndefined();
    await expect(assets.deleteBulkMetadata(auth, { items: [{ assetId: id, key: 'two' }] })).resolves.toBeUndefined();
    await expect(
      assets.run(auth, { assetIds: [id], name: AssetJobName.REGENERATE_THUMBNAIL }),
    ).resolves.toBeUndefined();

    const { tag } = await ctx.newTag({ userId: editor.id, value: 'editor-tag' });
    await expect(ctx.getService(TagService).bulkTagAssets(auth, { tagIds: [tag.id], assetIds: [id] })).resolves.toEqual(
      { count: 1 },
    );

    const { person } = await ctx.newPerson({ ownerId: editor.id });
    await expect(
      ctx.getService(PersonService).createFace(auth, {
        personId: person.personGroupId,
        assetId: id,
        imageWidth: 200,
        imageHeight: 200,
        x: 10,
        y: 10,
        width: 50,
        height: 50,
      }),
    ).resolves.toBeUndefined();
  });

  it('may not file it into a tag, a memory, a duplicate resolution or a stack', async () => {
    const { ctx, auth, editor, asset, other, duplicateId } = await setup();
    const denied = [{ id: asset.id, success: false, error: 'no_permission' }];

    const { tag } = await ctx.newTag({ userId: editor.id, value: 'editor-tag' });
    await expect(ctx.getService(TagService).addAssets(auth, tag.id, { ids: [asset.id] })).resolves.toEqual(denied);

    const memories = ctx.getService(MemoryService);
    const { memory } = await ctx.newMemory({ ownerId: editor.id });
    await expect(memories.addAssets(auth, memory.id, { ids: [asset.id] })).resolves.toEqual(denied);
    await expect(
      memories.create(auth, {
        type: MemoryType.OnThisDay,
        data: { year: 2021 },
        memoryAt: new Date(2021),
        assetIds: [asset.id],
      }),
    ).resolves.toMatchObject({ assets: [] });

    // DuplicateDelete on the trashed asset already refuses; the keeper check is pinned in duplicate.service specs.
    await expect(
      ctx
        .getService(DuplicateService)
        .resolve(auth, { groups: [{ duplicateId, keepAssetIds: [asset.id], trashAssetIds: [other.id] }] }),
    ).rejects.toThrow();
    await expect(ctx.getService(StackService).create(auth, { assetIds: [asset.id, other.id] })).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});
