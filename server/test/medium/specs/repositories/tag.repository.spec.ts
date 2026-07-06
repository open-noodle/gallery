import { Kysely } from 'kysely';
import { SharedSpaceRole } from 'src/enum';
import { LoggingRepository } from 'src/repositories/logging.repository';
import { TagRepository } from 'src/repositories/tag.repository';
import { DB } from 'src/schema';
import { BaseService } from 'src/services/base.service';
import { newMediumService } from 'test/medium.factory';
import { getKyselyDB } from 'test/utils';

let defaultDatabase: Kysely<DB>;

const setup = (db?: Kysely<DB>) => {
  const { ctx } = newMediumService(BaseService, {
    database: db || defaultDatabase,
    real: [TagRepository],
    mock: [LoggingRepository],
  });
  return { ctx, sut: ctx.get(TagRepository) };
};

type Ctx = ReturnType<typeof setup>['ctx'];

// Create a tag the way production does (upsertValue), which also populates tag_closure
// — required for any tag-id timeline/search filter (withAnyTagId) to match the asset.
const createTag = (ctx: Ctx, userId: string, value: string) => ctx.get(TagRepository).upsertValue({ userId, value });

// Seed a tag owned by the space creator, attached to an asset added directly to a
// space, with `member` joined at the given role. The tag and asset are owned by a
// different user, so any visibility the member gets comes purely from their space
// membership — never from ownership.
const seedDirectSpaceTag = async (ctx: Ctx, role: SharedSpaceRole, value: string) => {
  const { user: owner } = await ctx.newUser();
  const { user: member } = await ctx.newUser();
  const { space } = await ctx.newSharedSpace({ createdById: owner.id });
  const { asset } = await ctx.newAsset({ ownerId: owner.id });
  const tag = await createTag(ctx, owner.id, value);
  await ctx.newTagAsset({ tagIds: [tag.id], assetIds: [asset.id] });
  await ctx.newSharedSpaceAsset({ spaceId: space.id, assetId: asset.id, addedById: owner.id });
  await ctx.newSharedSpaceMember({ spaceId: space.id, userId: member.id, role });
  return { owner, member, space, asset, tag };
};

// Seed a tag attached to an asset reachable through a library linked to a space.
const seedLinkedLibraryTag = async (ctx: Ctx, role: SharedSpaceRole, value: string) => {
  const { user: owner } = await ctx.newUser();
  const { user: member } = await ctx.newUser();
  const { space } = await ctx.newSharedSpace({ createdById: owner.id });
  const { library } = await ctx.newLibrary({ ownerId: owner.id });
  await ctx.newSharedSpaceLibrary({ spaceId: space.id, libraryId: library.id });
  const { asset } = await ctx.newAsset({ ownerId: owner.id, libraryId: library.id });
  const tag = await createTag(ctx, owner.id, value);
  await ctx.newTagAsset({ tagIds: [tag.id], assetIds: [asset.id] });
  await ctx.newSharedSpaceMember({ spaceId: space.id, userId: member.id, role });
  return { owner, member, space, library, asset, tag };
};

const ALL_ROLES = [SharedSpaceRole.Viewer, SharedSpaceRole.Editor, SharedSpaceRole.Owner];

beforeAll(async () => {
  defaultDatabase = await getKyselyDB();
});

describe(TagRepository.name, () => {
  afterEach(async () => {
    const { ctx } = setup();
    await ctx.database.deleteFrom('tag_closure').execute();
    await ctx.database.deleteFrom('tag_asset').execute();
    await ctx.database.deleteFrom('tag').execute();
  });

  describe('create', () => {
    it('should create a top-level tag with proper closures', async () => {
      const { ctx, sut } = setup();
      const { user } = await ctx.newUser();

      const result = await sut.create({
        userId: user.id,
        value: 'tagA',
        color: '#000000',
      });

      await expect(
        ctx.database
          .selectFrom('tag')
          .select(['userId', 'value', 'color', 'parentId'])
          .where('id', '=', result.id)
          .executeTakeFirstOrThrow(),
      ).resolves.toEqual({ userId: user.id, value: 'tagA', color: '#000000', parentId: null });

      await expect(
        ctx.database
          .selectFrom('tag_closure')
          .select(['id_ancestor', 'id_descendant'])
          .where('id_ancestor', '=', result.id)
          .execute(),
      ).resolves.toEqual([{ id_ancestor: result.id, id_descendant: result.id }]);
    });
    it('should create a child tag with proper closures', async () => {
      const { ctx, sut } = setup();
      const { user } = await ctx.newUser();

      const resultParent = await sut.create({
        userId: user.id,
        value: 'tagA',
        color: '#000000',
      });
      const resultChild = await sut.create({
        userId: user.id,
        value: 'tagA/tagB',
        color: '#00FF00',
        parentId: resultParent.id,
      });

      await expect(
        ctx.database
          .selectFrom('tag')
          .select(['userId', 'value', 'color', 'parentId'])
          .where('id', '=', resultParent.id)
          .executeTakeFirstOrThrow(),
      ).resolves.toEqual({ userId: user.id, value: 'tagA', color: '#000000', parentId: null });

      await expect(
        ctx.database
          .selectFrom('tag')
          .select(['userId', 'value', 'color', 'parentId'])
          .where('id', '=', resultChild.id)
          .executeTakeFirstOrThrow(),
      ).resolves.toEqual({ userId: user.id, value: 'tagA/tagB', color: '#00FF00', parentId: resultParent.id });

      await expect(
        ctx.database
          .selectFrom('tag_closure')
          .select(['id_ancestor', 'id_descendant'])
          .where('id_ancestor', '=', resultParent.id)
          .execute(),
      ).resolves.toEqual([
        { id_ancestor: resultParent.id, id_descendant: resultParent.id },
        { id_ancestor: resultParent.id, id_descendant: resultChild.id },
      ]);

      await expect(
        ctx.database
          .selectFrom('tag_closure')
          .select(['id_ancestor', 'id_descendant'])
          .where('id_ancestor', '=', resultChild.id)
          .execute(),
      ).resolves.toEqual([{ id_ancestor: resultChild.id, id_descendant: resultChild.id }]);
    });
  });

  describe('update', () => {
    it('should update a tag color', async () => {
      const { ctx, sut } = setup();
      const { user } = await ctx.newUser();

      const { tag } = await ctx.newTag({
        userId: user.id,
        value: 'tagA',
        color: '#000000',
      });

      await sut.update(tag.id, { color: '#FFFFFF' });

      await expect(
        ctx.database
          .selectFrom('tag')
          .select(['userId', 'value', 'color', 'parentId'])
          .where('id', '=', tag.id)
          .executeTakeFirstOrThrow(),
      ).resolves.toEqual({ userId: user.id, value: 'tagA', color: '#FFFFFF', parentId: null });
    });
    it('should update a top-level tag value', async () => {
      const { ctx, sut } = setup();
      const { user } = await ctx.newUser();

      const { tag } = await ctx.newTag({
        userId: user.id,
        value: 'tagA',
        color: '#000000',
      });

      await sut.update(tag.id, { value: 'updatedTagA' });

      await expect(
        ctx.database
          .selectFrom('tag')
          .select(['userId', 'value', 'color', 'parentId'])
          .where('id', '=', tag.id)
          .executeTakeFirstOrThrow(),
      ).resolves.toEqual({ userId: user.id, value: 'updatedTagA', color: '#000000', parentId: null });
    });
  });

  describe('delete', () => {
    it('should delete top-level tag without descendants', async () => {
      const { ctx, sut } = setup();
      const { user } = await ctx.newUser();

      const { tag } = await ctx.newTag({
        userId: user.id,
        value: 'tagA',
        color: '#000000',
      });

      await expect(
        ctx.database
          .selectFrom('tag')
          .select(['userId', 'value', 'color', 'parentId'])
          .where('id', '=', tag.id)
          .executeTakeFirst(),
      ).resolves.toEqual({ userId: user.id, value: 'tagA', color: '#000000', parentId: null });

      await sut.delete(tag.id);

      await expect(
        ctx.database.selectFrom('tag').selectAll().where('id', '=', tag.id).executeTakeFirst(),
      ).resolves.toBeUndefined();
    });

    it('should delete a parent tag and all its descendants', async () => {
      const { ctx, sut } = setup();
      const { user } = await ctx.newUser();

      const { tag: tag1 } = await ctx.newTag({
        userId: user.id,
        value: 'tagA',
        color: '#000000',
      });

      const { tag: tag2 } = await ctx.newTag({
        userId: user.id,
        value: 'tagA/tagB',
        color: '#00FF00',
        parentId: tag1.id,
      });

      const { tag: tag3 } = await ctx.newTag({
        userId: user.id,
        value: 'tagA/tagB/tagC',
        color: '#0000FF',
        parentId: tag2.id,
      });

      const { tag: tag4 } = await ctx.newTag({
        userId: user.id,
        value: 'tagA/tagD',
        color: '#FFFF00',
        parentId: tag1.id,
      });

      const { tag: tag5 } = await ctx.newTag({
        userId: user.id,
        value: 'tagA/tagD/tagE',
        color: '#FF00FF',
        parentId: tag4.id,
      });
      await expect(
        ctx.database
          .selectFrom('tag')
          .select(['userId', 'value', 'color', 'parentId'])
          .where('id', 'in', [tag1.id, tag2.id, tag3.id, tag4.id, tag5.id])
          .execute(),
      ).resolves.toEqual(
        expect.arrayContaining([
          { userId: user.id, value: 'tagA', color: '#000000', parentId: null },
          { userId: user.id, value: 'tagA/tagB', color: '#00FF00', parentId: tag1.id },
          { userId: user.id, value: 'tagA/tagB/tagC', color: '#0000FF', parentId: tag2.id },
          { userId: user.id, value: 'tagA/tagD', color: '#FFFF00', parentId: tag1.id },
          { userId: user.id, value: 'tagA/tagD/tagE', color: '#FF00FF', parentId: tag4.id },
        ]),
      );

      await sut.delete(tag1.id);

      await expect(
        ctx.database
          .selectFrom('tag')
          .where('id', 'in', [tag1.id, tag2.id, tag3.id, tag4.id, tag5.id])
          .executeTakeFirst(),
      ).resolves.toBeUndefined();
    });

    it('should not delete tags outside the hierarchy', async () => {
      const { ctx, sut } = setup();
      const { user } = await ctx.newUser();

      const { tag: tag1 } = await ctx.newTag({
        userId: user.id,
        value: 'tagA',
        color: '#000000',
      });

      const { tag: tag2 } = await ctx.newTag({
        userId: user.id,
        value: 'tagA/tagB',
        color: '#00FF00',
        parentId: tag1.id,
      });

      const { tag: tag3 } = await ctx.newTag({
        userId: user.id,
        value: 'tagC',
        color: '#0000FF',
      });

      await expect(
        ctx.database
          .selectFrom('tag')
          .select(['userId', 'value', 'color', 'parentId'])
          .where('id', 'in', [tag1.id, tag2.id, tag3.id])
          .execute(),
      ).resolves.toEqual(
        expect.arrayContaining([
          { userId: user.id, value: 'tagA', color: '#000000', parentId: null },
          { userId: user.id, value: 'tagA/tagB', color: '#00FF00', parentId: tag1.id },
          { userId: user.id, value: 'tagC', color: '#0000FF', parentId: null },
        ]),
      );

      await sut.delete(tag1.id);

      await expect(
        ctx.database.selectFrom('tag').select(['userId', 'value', 'color', 'parentId']).execute(),
      ).resolves.toEqual([{ userId: user.id, value: 'tagC', color: '#0000FF', parentId: null }]);
    });
  });
  // ============================================================================
  // getAll — shared-space access permission matrix (issue #647)
  // ============================================================================
  describe('getAll', () => {
    it('GRANT — owner sees their own tag (even with no assets attached)', async () => {
      const { ctx, sut } = setup();
      const { user } = await ctx.newUser();
      const tag = await createTag(ctx, user.id, 'owner/solo');

      const result = await sut.getAll(user.id);

      expect(result.map((t) => t.id)).toContain(tag.id);
    });

    it.each(ALL_ROLES)('GRANT — space %s sees a tag on an asset shared directly into the space', async (role) => {
      const { ctx, sut } = setup();
      const { member, tag } = await seedDirectSpaceTag(ctx, role, `direct/${role}`);

      const result = await sut.getAll(member.id);

      expect(result.map((t) => t.id)).toContain(tag.id);
    });

    it.each(ALL_ROLES)('GRANT — space %s sees a tag on an asset in a library linked to the space', async (role) => {
      const { ctx, sut } = setup();
      const { member, tag } = await seedLinkedLibraryTag(ctx, role, `library/${role}`);

      const result = await sut.getAll(member.id);

      expect(result.map((t) => t.id)).toContain(tag.id);
    });

    it('GRANT — member sees the tag even when showInTimeline is disabled', async () => {
      const { ctx, sut } = setup();
      const { member, space, tag } = await seedDirectSpaceTag(ctx, SharedSpaceRole.Viewer, 'direct/no-timeline');
      await ctx.database
        .updateTable('shared_space_member')
        .set({ showInTimeline: false })
        .where('spaceId', '=', space.id)
        .where('userId', '=', member.id)
        .execute();

      const result = await sut.getAll(member.id);

      expect(result.map((t) => t.id)).toContain(tag.id);
    });

    it('DENY — non-member does not see a tag on a space asset', async () => {
      const { ctx, sut } = setup();
      const { user: owner } = await ctx.newUser();
      const { user: stranger } = await ctx.newUser();
      const { space } = await ctx.newSharedSpace({ createdById: owner.id });
      const { asset } = await ctx.newAsset({ ownerId: owner.id });
      const tag = await createTag(ctx, owner.id, 'private/secret');
      await ctx.newTagAsset({ tagIds: [tag.id], assetIds: [asset.id] });
      await ctx.newSharedSpaceAsset({ spaceId: space.id, assetId: asset.id, addedById: owner.id });

      const result = await sut.getAll(stranger.id);

      expect(result.map((t) => t.id)).not.toContain(tag.id);
    });

    it('DENY — member of a different space does not see the tag', async () => {
      const { ctx, sut } = setup();
      const { user: owner } = await ctx.newUser();
      const { user: outsider } = await ctx.newUser();
      const { space: withAsset } = await ctx.newSharedSpace({ createdById: owner.id });
      const { space: other } = await ctx.newSharedSpace({ createdById: owner.id });
      const { asset } = await ctx.newAsset({ ownerId: owner.id });
      const tag = await createTag(ctx, owner.id, 'private/other-space');
      await ctx.newTagAsset({ tagIds: [tag.id], assetIds: [asset.id] });
      await ctx.newSharedSpaceAsset({ spaceId: withAsset.id, assetId: asset.id, addedById: owner.id });
      // outsider belongs to a different space that does NOT contain the asset
      await ctx.newSharedSpaceMember({ spaceId: other.id, userId: outsider.id, role: SharedSpaceRole.Viewer });

      const result = await sut.getAll(outsider.id);

      expect(result.map((t) => t.id)).not.toContain(tag.id);
    });

    it('DENY — member does not see a tag that is only on the owner’s non-shared asset', async () => {
      const { ctx, sut } = setup();
      const { user: owner } = await ctx.newUser();
      const { user: member } = await ctx.newUser();
      const { space } = await ctx.newSharedSpace({ createdById: owner.id });
      await ctx.newSharedSpaceMember({ spaceId: space.id, userId: member.id, role: SharedSpaceRole.Editor });
      // tag attached to an asset the owner never shared into the space
      const { asset } = await ctx.newAsset({ ownerId: owner.id });
      const tag = await createTag(ctx, owner.id, 'private/unshared');
      await ctx.newTagAsset({ tagIds: [tag.id], assetIds: [asset.id] });

      const result = await sut.getAll(member.id);

      expect(result.map((t) => t.id)).not.toContain(tag.id);
    });

    it('DENY — member does not see a tag attached only to a soft-deleted shared asset', async () => {
      const { ctx, sut } = setup();
      const { member, asset, tag } = await seedDirectSpaceTag(ctx, SharedSpaceRole.Editor, 'direct/deleted');
      await ctx.softDeleteAsset(asset.id);

      const result = await sut.getAll(member.id);

      expect(result.map((t) => t.id)).not.toContain(tag.id);
    });

    it('DENY — a removed member no longer sees the tag', async () => {
      const { ctx, sut } = setup();
      const { member, space, tag } = await seedDirectSpaceTag(ctx, SharedSpaceRole.Editor, 'direct/removed');

      await expect(sut.getAll(member.id).then((r) => r.map((t) => t.id))).resolves.toContain(tag.id);

      await ctx.database
        .deleteFrom('shared_space_member')
        .where('spaceId', '=', space.id)
        .where('userId', '=', member.id)
        .execute();

      await expect(sut.getAll(member.id).then((r) => r.map((t) => t.id))).resolves.not.toContain(tag.id);
    });

    it('GRANT — member sees same-value tags from every owner who shared a tagged asset', async () => {
      const { ctx, sut } = setup();
      // Tags are per-user, so two owners tagging "family" produce two distinct tag rows
      // with the same value. A member who can reach both owners' assets through the space
      // should get BOTH rows (the web tree then collapses them onto one "family" node).
      const { user: ownerA } = await ctx.newUser();
      const { user: ownerB } = await ctx.newUser();
      const { user: member } = await ctx.newUser();
      const { space } = await ctx.newSharedSpace({ createdById: ownerA.id });
      await ctx.newSharedSpaceMember({ spaceId: space.id, userId: member.id, role: SharedSpaceRole.Viewer });

      const { asset: assetA } = await ctx.newAsset({ ownerId: ownerA.id });
      const tagA = await createTag(ctx, ownerA.id, 'family');
      await ctx.newTagAsset({ tagIds: [tagA.id], assetIds: [assetA.id] });
      await ctx.newSharedSpaceAsset({ spaceId: space.id, assetId: assetA.id, addedById: ownerA.id });

      const { asset: assetB } = await ctx.newAsset({ ownerId: ownerB.id });
      const tagB = await createTag(ctx, ownerB.id, 'family');
      await ctx.newTagAsset({ tagIds: [tagB.id], assetIds: [assetB.id] });
      await ctx.newSharedSpaceAsset({ spaceId: space.id, assetId: assetB.id, addedById: ownerB.id });

      const ids = await sut.getAll(member.id).then((r) => r.map((t) => t.id));

      expect(ids).toEqual(expect.arrayContaining([tagA.id, tagB.id]));
    });
  });
});
