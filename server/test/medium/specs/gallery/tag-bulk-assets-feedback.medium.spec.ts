/**
`PUT /tags/assets` reports what it did (specs/2026-11-27-bulk-tag-feedback-design.md): tagged
assets, assets the caller may not tag, and tags the caller may not use, instead of a bare `count` that reads as a
success when nothing was written. Slice 1 changes no permission: the database is checked after every call.
*/
import { Kysely } from 'kysely';
import { AccessRepository } from 'src/repositories/access.repository.js';
import { AssetRepository } from 'src/repositories/asset.repository.js';
import { DatabaseRepository } from 'src/repositories/database.repository.js';
import { EventRepository } from 'src/repositories/event.repository.js';
import { LoggingRepository } from 'src/repositories/logging.repository.js';
import { SharedSpaceRepository } from 'src/repositories/shared-space.repository.js';
import { TagRepository } from 'src/repositories/tag.repository.js';
import { UserRepository } from 'src/repositories/user.repository.js';
import { DB } from 'src/schema/index.js';
import { TagService } from 'src/services/tag.service.js';
import { newMediumService } from 'test/medium.factory.js';
import { factory } from 'test/small.factory.js';
import { getKyselyDB } from 'test/utils.js';

let defaultDatabase: Kysely<DB>;

beforeAll(async () => {
  defaultDatabase = await getKyselyDB();
});

const setup = async () => {
  const { sut, ctx } = newMediumService(TagService, {
    database: defaultDatabase,
    real: [AccessRepository, AssetRepository, DatabaseRepository, SharedSpaceRepository, TagRepository, UserRepository],
    mock: [EventRepository, LoggingRepository],
  });
  ctx.getMock(EventRepository).emit.mockResolvedValue();

  const { user: owner } = await ctx.newUser();
  const { user: editor } = await ctx.newUser();
  const { user: outsider } = await ctx.newUser();
  const { space } = await ctx.newSharedSpace({ createdById: owner.id });
  await ctx.newSharedSpaceMember({ spaceId: space.id, userId: owner.id, role: 'owner' });
  await ctx.newSharedSpaceMember({ spaceId: space.id, userId: editor.id, role: 'editor' });

  const { asset: memberAsset } = await ctx.newAsset({ ownerId: owner.id });
  await ctx.newExif({ assetId: memberAsset.id, make: 'Canon' });
  await ctx.newSharedSpaceAsset({ spaceId: space.id, assetId: memberAsset.id, addedById: owner.id });

  // An asset of a user who is not in the space: no one but its owner may tag it.
  const { asset: outsiderAsset } = await ctx.newAsset({ ownerId: outsider.id });
  await ctx.newExif({ assetId: outsiderAsset.id, make: 'Canon' });

  const { tag: ownerTag } = await ctx.newTag({ userId: owner.id, value: 'event' });
  const { tag: editorTag } = await ctx.newTag({ userId: editor.id, value: 'editor-tag' });

  const links = (assetId: string) =>
    defaultDatabase.selectFrom('tag_asset').select('tagId').where('assetId', '=', assetId).execute();

  return {
    sut,
    owner,
    editor,
    memberAsset,
    outsiderAsset,
    ownerTag,
    editorTag,
    links,
    ownerAuth: factory.auth({ user: { id: owner.id } }),
    editorAuth: factory.auth({ user: { id: editor.id } }),
  };
};

describe('bulkTagAssets feedback', () => {
  it('reports the owner tagging their own asset as tagged', async () => {
    const { sut, ownerAuth, memberAsset, ownerTag, links } = await setup();

    await expect(sut.bulkTagAssets(ownerAuth, { tagIds: [ownerTag.id], assetIds: [memberAsset.id] })).resolves.toEqual({
      count: 1,
      taggedAssetIds: [memberAsset.id],
      skippedAssetIds: [],
      skippedTagIds: [],
    });
    await expect(links(memberAsset.id)).resolves.toEqual([{ tagId: ownerTag.id }]);
  });

  it('reports an asset that already carried the tag as tagged, with no new link', async () => {
    const { sut, ownerAuth, memberAsset, ownerTag } = await setup();
    await sut.bulkTagAssets(ownerAuth, { tagIds: [ownerTag.id], assetIds: [memberAsset.id] });

    await expect(sut.bulkTagAssets(ownerAuth, { tagIds: [ownerTag.id], assetIds: [memberAsset.id] })).resolves.toEqual({
      count: 0,
      taggedAssetIds: [memberAsset.id],
      skippedAssetIds: [],
      skippedTagIds: [],
    });
  });

  it("reports the owner's tag an editor picked as skipped and writes nothing", async () => {
    const { sut, editorAuth, memberAsset, ownerTag, links } = await setup();

    await expect(sut.bulkTagAssets(editorAuth, { tagIds: [ownerTag.id], assetIds: [memberAsset.id] })).resolves.toEqual(
      { count: 0, taggedAssetIds: [], skippedAssetIds: [], skippedTagIds: [ownerTag.id] },
    );
    await expect(links(memberAsset.id)).resolves.toEqual([]);
  });

  it("reports an editor's own tag on a member asset as tagged (unchanged permission)", async () => {
    const { sut, editorAuth, memberAsset, editorTag, links } = await setup();

    await expect(
      sut.bulkTagAssets(editorAuth, { tagIds: [editorTag.id], assetIds: [memberAsset.id] }),
    ).resolves.toEqual({ count: 1, taggedAssetIds: [memberAsset.id], skippedAssetIds: [], skippedTagIds: [] });
    await expect(links(memberAsset.id)).resolves.toEqual([{ tagId: editorTag.id }]);
  });

  it("reports a member asset as tagged with the editor's own tag when the owner's tag in the same request was skipped", async () => {
    const { sut, editorAuth, memberAsset, editorTag, ownerTag, links } = await setup();

    await expect(
      sut.bulkTagAssets(editorAuth, { tagIds: [editorTag.id, ownerTag.id], assetIds: [memberAsset.id] }),
    ).resolves.toEqual({
      count: 1,
      taggedAssetIds: [memberAsset.id],
      skippedAssetIds: [],
      skippedTagIds: [ownerTag.id],
    });
    await expect(links(memberAsset.id)).resolves.toEqual([{ tagId: editorTag.id }]);
  });

  it('reports an asset outside the caller edit access as skipped and writes nothing for it', async () => {
    const { sut, editorAuth, memberAsset, outsiderAsset, editorTag, links } = await setup();

    await expect(
      sut.bulkTagAssets(editorAuth, { tagIds: [editorTag.id], assetIds: [memberAsset.id, outsiderAsset.id] }),
    ).resolves.toEqual({
      count: 1,
      taggedAssetIds: [memberAsset.id],
      skippedAssetIds: [outsiderAsset.id],
      skippedTagIds: [],
    });
    await expect(links(outsiderAsset.id)).resolves.toEqual([]);
  });
});
