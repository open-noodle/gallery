import { AssetVisibility, LoginResponseDto, SharedSpaceRole, updateAssets } from '@immich/sdk';
import { createUserDto } from 'src/fixtures';
import { app, asBearerAuth, utils } from 'src/utils';
import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';

/**
 * The game pool must never surface an asset the owner has taken out of their timeline.
 *
 * These are characterization tests: they pass against the unmodified tree. Every fixture asset in
 * this file is a generated 1x1 PNG with no EXIF GPS, so `GameRepository.getLocationCandidates`'
 * INNER JOIN on `asset_exif`'s lat/lon always excludes them, and every challenge this suite
 * generates comes back as date rounds - meaning it only ever exercises
 * `GameRepository.getDateCandidates`' visibility exclusion. `getLocationCandidates`' own sample
 * stage and `getEligibleRoundAsset`'s correlated predicate carry two further, independent copies
 * of that same exclusion that no fixture here can reach; those are pinned instead by the static
 * guard in `game.repository.spec.ts` ("excludes archived, hidden and locked assets at all three
 * independent sites").
 *
 * The exclusion does real work: the space-membership machinery these queries drive from - the
 * directly-added-asset, linked-library and linked-album access paths - only answers "is this
 * asset reachable through the space", never "is it currently showable". None of those paths
 * filter on the asset's visibility at all, so it is carried entirely by one separate predicate on
 * the asset's own visibility column, independently ANDed in on top.
 */
describe('/games (visibility negatives)', () => {
  let owner: LoginResponseDto;
  let editor: LoginResponseDto;

  beforeAll(async () => {
    await utils.resetDatabase();
    const admin = await utils.adminSetup();
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
});
