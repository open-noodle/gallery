// P1-7 (#752): faces on contributed-only assets must be selectable as projection targets and by
// the link-time face-sync pager. Face fixtures are seeded with direct inserts (no factory).
import { Kysely } from 'kysely';
import { AssetVisibility, SharedSpaceRole } from 'src/enum';
import { AssetRepository } from 'src/repositories/asset.repository';
import { FaceIdentityRepository } from 'src/repositories/face-identity.repository';
import { LoggingRepository } from 'src/repositories/logging.repository';
import { DB } from 'src/schema';
import { BaseService } from 'src/services/base.service';
import { newMediumService } from 'test/medium.factory';
import { getKyselyDB } from 'test/utils';

let db: Kysely<DB>;

const setup = () => {
  const { ctx } = newMediumService(BaseService, { database: db, real: [], mock: [LoggingRepository] });
  return { ctx };
};

beforeAll(async () => {
  db = await getKyselyDB();
});

const seedContributionWithFace = async (ctx: ReturnType<typeof setup>['ctx']) => {
  const { user: owner } = await ctx.newUser();
  const { user: carol } = await ctx.newUser();
  const { album } = await ctx.newAlbum({ ownerId: owner.id });
  const { asset } = await ctx.newAsset({ ownerId: carol.id, visibility: AssetVisibility.Timeline });
  const { space } = await ctx.newSharedSpace({ createdById: owner.id, faceRecognitionEnabled: true });
  await ctx.newSharedSpaceMember({ spaceId: space.id, userId: owner.id, role: SharedSpaceRole.Owner });
  await ctx.newSharedSpaceAlbum({ spaceId: space.id, albumId: album.id });
  await ctx.newAlbumSpaceAsset({ albumId: album.id, assetId: asset.id, spaceId: space.id });
  // named face + identity — the CTE requires asset_face.personId NOT NULL + face_identity_face
  const { person } = await ctx.newPerson({ ownerId: carol.id });
  const { assetFace } = await ctx.newAssetFace({ assetId: asset.id, personId: person.id });
  const identity = await ctx.database
    .insertInto('face_identity')
    .values({ type: 'person' })
    .returningAll()
    .executeTakeFirstOrThrow();
  await ctx.database
    .insertInto('face_identity_face')
    .values({ identityId: identity.id, assetFaceId: assetFace.id, source: 'backfill' })
    .execute();
  return { owner, space, album, asset, assetFace };
};

describe('P1-7: contributed-only assets in the face pipeline', () => {
  it('getSharedSpaceFaceMatchBackfillTargets selects a contributed-only asset', async () => {
    const { ctx } = setup();
    const s = await seedContributionWithFace(ctx);
    const sut = ctx.get(FaceIdentityRepository);
    const targets = await sut.getSharedSpaceFaceMatchBackfillTargets();
    expect(targets.some((t) => t.spaceId === s.space.id && t.assetId === s.asset.id)).toBe(true);
  });

  it('getByAlbumIdWithFaces pages a contributed asset for its tether space (re-link face sync, D1-b)', async () => {
    const { ctx } = setup();
    const s = await seedContributionWithFace(ctx);
    const sut = ctx.get(AssetRepository);
    const rows = await sut.getByAlbumIdWithFaces(s.album.id, s.space.id);
    expect(rows.map((r) => r.id)).toContain(s.asset.id);
  });

  it('getByAlbumIdWithFaces does NOT page a contribution tethered to a different space', async () => {
    // Cross-space guard: linking the album to a second space must not project the S1-tethered
    // contribution's faces into S2 (mirrors contributionVisibleToMember's albumId+spaceId gate).
    const { ctx } = setup();
    const s = await seedContributionWithFace(ctx);
    const { space: other } = await ctx.newSharedSpace({ createdById: s.owner.id, faceRecognitionEnabled: true });
    await ctx.newSharedSpaceAlbum({ spaceId: other.id, albumId: s.album.id });
    const sut = ctx.get(AssetRepository);
    const rows = await sut.getByAlbumIdWithFaces(s.album.id, other.id);
    expect(rows.map((r) => r.id)).not.toContain(s.asset.id);
  });
});
