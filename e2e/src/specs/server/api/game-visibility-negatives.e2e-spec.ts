import { AssetVisibility, LoginResponseDto, SharedSpaceRole, updateAssets } from '@immich/sdk';
import { createUserDto } from 'src/fixtures';
import { app, asBearerAuth, utils } from 'src/utils';
import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';

/**
 * The game pool must never surface an asset the owner has taken out of their timeline.
 *
 * These are characterization tests: they pass against the unmodified tree. Their job is to fail
 * when a future refactor drops the `visibility = 'timeline'` clause from eligibleSpaceAsset - the
 * clause is the ONLY thing excluding archived, hidden and locked assets, and none of the helpers
 * the predicate is built from exclude them on their own (spaceVisibilityGate admits archive,
 * checkPartnerAccess admits hidden, checkAlbumAccess gates on nothing).
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
        `A ${visibility} asset was drawn into the pool. eligibleSpaceAsset lost its\n` +
          `visibility = 'timeline' clause - that clause is the only thing excluding archived,\n` +
          `hidden and locked assets from the game.`,
      ).toBe(1);

      const assetIds = await revealedAssetIds(challenge.id);
      expect(assetIds).toEqual([visibleId]);
      expect(assetIds).not.toContain(excludedId);
    });
  }
});
