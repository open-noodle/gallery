import {
  AlbumUserRole,
  AssetVisibility,
  LoginResponseDto,
  SharedSpaceRole,
  addAssetsToAlbum,
  addUsersToAlbum,
  updateAssets,
  updateMemberTimeline,
  updatePartner,
} from '@immich/sdk';
import { createUserDto } from 'src/fixtures';
import { app, asBearerAuth, utils } from 'src/utils';
import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';

const setVisibilityAs = (token: string, assetId: string, visibility: AssetVisibility) =>
  updateAssets({ assetBulkUpdateDto: { ids: [assetId], visibility } }, { headers: asBearerAuth(token) });

/** Compare asset-id sets without asserting a round ORDER, which the generation seed decides. */
const sorted = (ids: string[]) => ids.toSorted((a, b) => a.localeCompare(b));

/**
 * Start a solo challenge as `player` with the given source toggles, asking for `roundCount` rounds,
 * and return the asset ids actually drawn. The generator returns a SHORTER challenge rather than
 * reaching for an ineligible photo, so asking for more rounds than there are eligible photos is
 * what makes an over-inclusive pool visible.
 */
const soloAssetIds = async (
  player: LoginResponseDto,
  roundCount: number,
  sources: { includePartners: boolean; includeSpaces: boolean },
): Promise<string[]> => {
  const created = await request(app)
    .post('/games/solo')
    .set('Authorization', `Bearer ${player.accessToken}`)
    .send({ roundCount, sources });
  expect(created.status).toBe(201);

  const detail = await request(app)
    .get(`/games/${created.body.id}`)
    .set('Authorization', `Bearer ${player.accessToken}`);
  for (const round of detail.body.rounds) {
    await request(app)
      .post(`/games/${created.body.id}/rounds/${round.index}/guess`)
      .set('Authorization', `Bearer ${player.accessToken}`)
      .send({ date: new Date('2020-01-01').toISOString() });
  }

  const played = await request(app)
    .get(`/games/${created.body.id}`)
    .set('Authorization', `Bearer ${player.accessToken}`);
  return played.body.rounds.map((round: { assetId: string }) => round.assetId);
};

/**
 * The game pool must never surface an asset the owner has taken out of their timeline.
 *
 * The space cases are characterization tests: they pass against the unmodified tree. The `solo pool
 * read arms` block at the bottom is not - it was written against the solo pool's eligibility
 * predicate before the `POST /games/solo` route that reaches it exists, so it stays red (404 on
 * every case) until that route lands.
 *
 * Every fixture asset in this file is a generated 1x1 PNG with no EXIF GPS, so
 * `GameRepository.getLocationCandidates`' INNER JOIN on `asset_exif`'s lat/lon always excludes
 * them, and every challenge this suite generates comes back as date rounds - meaning it only ever
 * exercises `GameRepository.getDateCandidates`' visibility exclusion (and, for the solo cases,
 * `getSoloDateCandidates`'). The location queries' own sample stage and the round-image resolvers'
 * correlated predicate carry further, independent copies of that same exclusion that no fixture
 * here can reach; those are pinned instead by the static guards in `game.repository.spec.ts`.
 *
 * The exclusion does real work: the space-membership machinery these queries drive from - the
 * directly-added-asset, linked-library and linked-album access paths - only answers "is this
 * asset reachable through the space", never "is it currently showable". None of those paths
 * filter on the asset's visibility at all, so it is carried entirely by one separate predicate on
 * the asset's own visibility column, independently ANDed in on top.
 */
describe('/games (visibility negatives)', () => {
  let admin: LoginResponseDto;
  let owner: LoginResponseDto;
  let editor: LoginResponseDto;

  beforeAll(async () => {
    await utils.resetDatabase();
    admin = await utils.adminSetup();
    [owner, editor] = await Promise.all([
      utils.userSetup(admin.accessToken, createUserDto.create('gamevis-owner')),
      utils.userSetup(admin.accessToken, createUserDto.create('gamevis-editor')),
    ]);
  });

  const setVisibility = (assetId: string, visibility: AssetVisibility) =>
    updateAssets({ assetBulkUpdateDto: { ids: [assetId], visibility } }, { headers: asBearerAuth(owner.accessToken) });

  /**
   * A space holding exactly two photos: one left on the timeline, one moved to `hidden`.
   * Requesting a 2-round challenge can therefore only be satisfied by the visible photo, and the
   * generator returns a SHORTER challenge rather than reaching for the excluded one.
   */
  const spaceWithOneExcluded = async (name: string, visibility: AssetVisibility) => {
    const space = await utils.createSpace(owner.accessToken, { name });
    await utils.addSpaceMember(owner.accessToken, space.id, { userId: editor.userId, role: SharedSpaceRole.Editor });

    const visible = await utils.createAsset(owner.accessToken, { assetData: { filename: `${name}-visible.png` } });
    const excluded = await utils.createAsset(owner.accessToken, { assetData: { filename: `${name}-excluded.png` } });
    await utils.addSpaceAssets(owner.accessToken, space.id, [visible.id, excluded.id]);
    await setVisibility(excluded.id, visibility);

    return { spaceId: space.id, visibleId: visible.id, excludedId: excluded.id };
  };

  const createChallenge = async (spaceId: string, roundCount: number) => {
    const { status, body } = await request(app)
      .post(`/shared-spaces/${spaceId}/games`)
      .set('Authorization', `Bearer ${editor.accessToken}`)
      .send({ roundCount });
    expect(status).toBe(201);
    return body;
  };

  /** Play every round so the detail response reveals each round's assetId. */
  const revealedAssetIds = async (challengeId: string): Promise<string[]> => {
    const detail = await request(app).get(`/games/${challengeId}`).set('Authorization', `Bearer ${editor.accessToken}`);
    expect(detail.status).toBe(200);

    for (const round of detail.body.rounds) {
      await request(app)
        .post(`/games/${challengeId}/rounds/${round.index}/guess`)
        .set('Authorization', `Bearer ${editor.accessToken}`)
        .send({ date: new Date('2020-01-01').toISOString() });
    }

    const played = await request(app).get(`/games/${challengeId}`).set('Authorization', `Bearer ${editor.accessToken}`);
    expect(played.status).toBe(200);
    return played.body.rounds.map((round: { assetId: string }) => round.assetId);
  };

  for (const visibility of [AssetVisibility.Archive, AssetVisibility.Hidden, AssetVisibility.Locked] as const) {
    it(`never draws a round from an asset whose visibility is '${visibility}'`, async () => {
      const { spaceId, visibleId, excludedId } = await spaceWithOneExcluded(`gamevis-${visibility}`, visibility);

      const challenge = await createChallenge(spaceId, 2);

      // The generator could only fill one round, because the other photo is excluded.
      expect(
        challenge.roundCount,
        `A ${visibility} asset was drawn into the pool. GameRepository.getDateCandidates lost its\n` +
          `visibility exclusion - the one of three independent copies of that exclusion this\n` +
          `fixture-based test can reach, since it has no EXIF GPS and every generated round here\n` +
          `is a date round. See game.repository.spec.ts for the other two.`,
      ).toBe(1);

      const assetIds = await revealedAssetIds(challenge.id);
      expect(assetIds).toEqual([visibleId]);
      expect(assetIds).not.toContain(excludedId);
    });
  }

  /** A brand-new player owning exactly ONE eligible photo. */
  const freshPlayer = async (key: string) => {
    const player = await utils.userSetup(admin.accessToken, createUserDto.create(key));
    const mine = await utils.createAsset(player.accessToken, { assetData: { filename: `${key}-mine.png` } });
    return { player, mineId: mine.id };
  };

  /** A third user, so nothing under test is owned by the player or by this file's other users. */
  const host = (key: string) => utils.userSetup(admin.accessToken, createUserDto.create(`${key}-host`));

  /**
   * A third user's album, linked into a space the player belongs to, holding one LOCKED photo and
   * one left on the timeline.
   *
   * The visible one is a POSITIVE CONTROL and it is not optional: without it, a solo pool whose
   * space arm returned nothing at all - a broken join, a lost membership predicate, a union arm
   * that silently matches no rows - would pass this case for entirely the wrong reason.
   */
  const spaceLinkedAlbumWithLockedAsset = async (key: string, player: LoginResponseDto) => {
    const albumOwner = await host(key);
    const space = await utils.createSpace(albumOwner.accessToken, { name: key });
    await utils.addSpaceMember(albumOwner.accessToken, space.id, {
      userId: player.userId,
      role: SharedSpaceRole.Viewer,
    });

    const album = await utils.createAlbum(albumOwner.accessToken, { albumName: key });
    const locked = await utils.createAsset(albumOwner.accessToken, { assetData: { filename: `${key}-locked.png` } });
    const visible = await utils.createAsset(albumOwner.accessToken, { assetData: { filename: `${key}-visible.png` } });
    await addAssetsToAlbum(
      { id: album.id, bulkIdsDto: { ids: [locked.id, visible.id] } },
      { headers: asBearerAuth(albumOwner.accessToken) },
    );
    await utils.linkSpaceAlbum(albumOwner.accessToken, space.id, album.id);
    await setVisibilityAs(albumOwner.accessToken, locked.id, AssetVisibility.Locked);

    return { lockedId: locked.id, visibleId: visible.id };
  };

  /**
   * A third user's ARCHIVED photo, added directly to a space the player belongs to, alongside one
   * left on the timeline as the positive control - see spaceLinkedAlbumWithLockedAsset for why
   * that control is load-bearing.
   */
  const spaceWithArchivedAsset = async (key: string, player: LoginResponseDto) => {
    const spaceOwner = await host(key);
    const space = await utils.createSpace(spaceOwner.accessToken, { name: key });
    await utils.addSpaceMember(spaceOwner.accessToken, space.id, {
      userId: player.userId,
      role: SharedSpaceRole.Viewer,
    });

    const archived = await utils.createAsset(spaceOwner.accessToken, {
      assetData: { filename: `${key}-archived.png` },
    });
    const visible = await utils.createAsset(spaceOwner.accessToken, {
      assetData: { filename: `${key}-visible.png` },
    });
    await utils.addSpaceAssets(spaceOwner.accessToken, space.id, [archived.id, visible.id]);
    await setVisibilityAs(spaceOwner.accessToken, archived.id, AssetVisibility.Archive);

    return { archivedId: archived.id, visibleId: visible.id };
  };

  /**
   * A space the player belongs to and has HIDDEN from their own timeline, holding one perfectly
   * ordinary timeline photo.
   *
   * Nothing about the photo disqualifies it - only the player's per-space preference does, which is
   * why this fixture needs no control asset of its own: the player's own photo is the control, and
   * a pool that ignored the preference would draw two rounds instead of one.
   */
  const spaceHiddenFromPlayerTimeline = async (key: string, player: LoginResponseDto) => {
    const spaceOwner = await host(key);
    const space = await utils.createSpace(spaceOwner.accessToken, { name: key });
    await utils.addSpaceMember(spaceOwner.accessToken, space.id, {
      userId: player.userId,
      role: SharedSpaceRole.Viewer,
    });

    const theirs = await utils.createAsset(spaceOwner.accessToken, {
      assetData: { filename: `${key}-hidden-space.png` },
    });
    await utils.addSpaceAssets(spaceOwner.accessToken, space.id, [theirs.id]);
    await updateMemberTimeline(
      { id: space.id, sharedSpaceMemberTimelineDto: { showInTimeline: false } },
      { headers: asBearerAuth(player.accessToken) },
    );

    return { hiddenSpaceAssetId: theirs.id };
  };

  /** A third user's timeline photo, reachable by the player ONLY through a shared album. */
  const albumSharedWithPlayer = async (key: string, player: LoginResponseDto) => {
    const albumOwner = await host(key);
    const album = await utils.createAlbum(albumOwner.accessToken, { albumName: key });
    const shared = await utils.createAsset(albumOwner.accessToken, { assetData: { filename: `${key}-shared.png` } });
    await addAssetsToAlbum(
      { id: album.id, bulkIdsDto: { ids: [shared.id] } },
      { headers: asBearerAuth(albumOwner.accessToken) },
    );
    await addUsersToAlbum(
      { id: album.id, addUsersDto: { albumUsers: [{ userId: player.userId, role: AlbumUserRole.Viewer }] } },
      { headers: asBearerAuth(albumOwner.accessToken) },
    );

    return { sharedId: shared.id };
  };

  /**
   * The solo pool's read arms, each case chosen at the point where an existing access helper would
   * admit the asset on its own - so the pool having its own predicate is the only thing keeping it
   * out.
   *
   * Every case gets its OWN player. Assets, partnerships and space memberships all accumulate in
   * one database, so a shared player would carry the previous case's photos into the next one's
   * assertions, and "exactly one photo was drawable" - the assertion every case here rests on -
   * would stop meaning anything after the first test.
   */
  describe('solo pool read arms', () => {
    it('never draws a partner asset when the partner is hidden from the timeline', async () => {
      // The partner arm must respect partner.inTimeline, matching timeline and search. The
      // access-layer partner check deliberately does NOT consult it, so composing from that helper
      // would silently widen the pool.
      const { player, mineId } = await freshPlayer('solo-partner-off');
      const partner = await host('solo-partner-off');
      const theirs = await utils.createAsset(partner.accessToken, {
        assetData: { filename: 'solo-partner-off.png' },
      });
      await utils.createPartner(partner.accessToken, player.userId);
      await updatePartner(
        { id: partner.userId, partnerUpdateDto: { inTimeline: false } },
        { headers: asBearerAuth(player.accessToken) },
      );

      const drawn = await soloAssetIds(player, 2, { includePartners: true, includeSpaces: false });

      expect(drawn).toEqual([mineId]);
      expect(drawn, 'the partner arm ignored partner.inTimeline').not.toContain(theirs.id);
    });

    it('never draws a partner asset whose visibility is hidden', async () => {
      // The access layer's partner check admits hidden assets; the game's own floor must exclude
      // them. The partner's OTHER photo is the positive control: the arm has to be working for
      // this case to say anything about the floor.
      const { player, mineId } = await freshPlayer('solo-partner-hidden');
      const partner = await host('solo-partner-hidden');
      const hidden = await utils.createAsset(partner.accessToken, {
        assetData: { filename: 'solo-partner-hidden.png' },
      });
      const visible = await utils.createAsset(partner.accessToken, {
        assetData: { filename: 'solo-partner-visible.png' },
      });
      await utils.createPartner(partner.accessToken, player.userId);
      await updatePartner(
        { id: partner.userId, partnerUpdateDto: { inTimeline: true } },
        { headers: asBearerAuth(player.accessToken) },
      );
      await setVisibilityAs(partner.accessToken, hidden.id, AssetVisibility.Hidden);

      const drawn = await soloAssetIds(player, 3, { includePartners: true, includeSpaces: false });

      expect(sorted(drawn), 'the partner arm drew nothing at all, so this case proves nothing').toEqual(
        sorted([mineId, visible.id]),
      );
      expect(drawn, 'a hidden partner asset reached the pool').not.toContain(hidden.id);
    });

    it('never draws a locked asset from an album linked to a space the player belongs to', async () => {
      // The linked-album path is an arm the predicate DOES use, and it carries no visibility rule
      // of its own - the timeline floor is the only thing excluding this asset.
      const { player, mineId } = await freshPlayer('solo-locked-album');
      const { lockedId, visibleId } = await spaceLinkedAlbumWithLockedAsset('solo-locked-album', player);

      const drawn = await soloAssetIds(player, 3, { includePartners: false, includeSpaces: true });

      expect(sorted(drawn), 'the space-album arm drew nothing at all, so this case proves nothing').toEqual(
        sorted([mineId, visibleId]),
      );
      expect(drawn, 'a LOCKED asset reached the pool through the space-album arm').not.toContain(lockedId);
    });

    it('never draws an archived asset from a shared space', async () => {
      // The set of visibilities a space shares admits archived by design.
      const { player, mineId } = await freshPlayer('solo-archived-space');
      const { archivedId, visibleId } = await spaceWithArchivedAsset('solo-archived-space', player);

      const drawn = await soloAssetIds(player, 3, { includePartners: false, includeSpaces: true });

      expect(sorted(drawn), 'the direct space arm drew nothing at all, so this case proves nothing').toEqual(
        sorted([mineId, visibleId]),
      );
      expect(drawn, 'an archived asset reached the pool through a space arm').not.toContain(archivedId);
    });

    it('never draws from a space the player has hidden from their own timeline', async () => {
      // includeSpaces is a coarse global opt-in; shared_space_member.showInTimeline is the finer,
      // per-space expression of the same intent, and the finer one wins - exactly as the partner
      // arm honours partner.inTimeline even though the player opted into partner photos. This fork
      // has dropped this same gate once before, from album-scoped search, and had to restore it.
      const { player, mineId } = await freshPlayer('solo-hidden-space');
      const { hiddenSpaceAssetId } = await spaceHiddenFromPlayerTimeline('solo-hidden-space', player);

      const drawn = await soloAssetIds(player, 2, { includePartners: false, includeSpaces: true });

      expect(drawn).toEqual([mineId]);
      expect(drawn, 'a space the player hid from their timeline still fed the game').not.toContain(hiddenSpaceAssetId);
    });

    it('never draws an asset shared with the player only through a shared album', async () => {
      // album_user is deliberately not a read arm at all - no composable predicate exists for it,
      // and no other listing surface in the product includes it.
      const { player, mineId } = await freshPlayer('solo-shared-album');
      const { sharedId } = await albumSharedWithPlayer('solo-shared-album', player);

      const drawn = await soloAssetIds(player, 2, { includePartners: true, includeSpaces: true });

      expect(drawn).toEqual([mineId]);
      expect(drawn, 'album_user became a read arm').not.toContain(sharedId);
    });

    it('draws own photos only when both source toggles are off', async () => {
      const { player, mineId } = await freshPlayer('solo-sources-off');
      const partner = await host('solo-sources-off');
      const theirs = await utils.createAsset(partner.accessToken, {
        assetData: { filename: 'solo-sources-off.png' },
      });
      await utils.createPartner(partner.accessToken, player.userId);
      await updatePartner(
        { id: partner.userId, partnerUpdateDto: { inTimeline: true } },
        { headers: asBearerAuth(player.accessToken) },
      );

      const drawn = await soloAssetIds(player, 2, { includePartners: false, includeSpaces: false });

      expect(drawn).toEqual([mineId]);
      expect(drawn, 'the includePartners toggle is decorative').not.toContain(theirs.id);
    });
  });
});
