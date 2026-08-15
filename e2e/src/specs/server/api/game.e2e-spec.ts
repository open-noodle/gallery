import {
  GameChallengeDetailResponseDto,
  GameChallengeResponseDto,
  GameRoundDetailResponseDto,
  GameRoundType,
  LoginResponseDto,
  SharedSpaceRole,
} from '@immich/sdk';
import { Socket } from 'socket.io-client';
import { createUserDto } from 'src/fixtures';
import { app, utils } from 'src/utils';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * A round's guess payload, branched on its type (GameGuessDto: `{lat, lon}` for a location round,
 * `{date}` for a date round — see server/src/dtos/game.dto.ts and buildGuessInsert in
 * game.service.ts). Every photo this file uploads is a generated 1x1 PNG (utils.createAsset ->
 * makeRandomImage), which never carries EXIF GPS — GameRepository.getLocationCandidates INNER
 * JOINs asset_exif and requires latitude/longitude IS NOT NULL, so a space built entirely from
 * these fixtures always yields zero location candidates and every generated round is a 'date'
 * round (see LOCATION_ROUND_SHARE / dateRemaining math in GameService.create). The 'location'
 * branch is kept so this stays correct if a future edit adds a GPS-tagged fixture.
 */
const guessPayloadFor = (round: GameRoundDetailResponseDto): { lat: number; lon: number } | { date: string } =>
  round.type === GameRoundType.Location ? { lat: 12.34, lon: 56.78 } : { date: '2020-06-15T00:00:00.000Z' };

const getDetail = async (challengeId: string, accessToken: string): Promise<GameChallengeDetailResponseDto> => {
  const { status, body } = await request(app)
    .get(`/games/${challengeId}`)
    .set('Authorization', `Bearer ${accessToken}`);
  expect(status).toBe(200);
  return body as GameChallengeDetailResponseDto;
};

describe('/games', () => {
  // owner = the space creator (Owner role); editor/viewer are explicit non-owner memberships so
  // "an editor" / "a viewer" in the assertions below exercise those roles specifically, not the
  // Owner role (which also satisfies the editor gate — see hasSharedSpaceRole).
  let owner: LoginResponseDto;
  let editor: LoginResponseDto;
  let viewer: LoginResponseDto;
  let nonMember: LoginResponseDto;

  beforeAll(async () => {
    await utils.resetDatabase();
    const admin = await utils.adminSetup();

    [owner, editor, viewer, nonMember] = await Promise.all([
      utils.userSetup(admin.accessToken, createUserDto.create('game-owner')),
      utils.userSetup(admin.accessToken, createUserDto.create('game-editor')),
      utils.userSetup(admin.accessToken, createUserDto.create('game-viewer')),
      utils.userSetup(admin.accessToken, createUserDto.create('game-nonmember')),
    ]);
  });

  /**
   * Fresh space owned by `owner`, with `editor` added as SharedSpaceRole.Editor and `viewer`
   * added with the default Viewer role; `nonMember` is never added. Uploads `photoCount` fresh
   * photos (unique filenames, so the leakage test can assert on them) and adds them all to the
   * space. A fresh space per test avoids two cross-test hazards: GameService.create's own
   * "recently used assets" exclusion (RECENT_CHALLENGE_LOOKBACK) and its seeded-random challenge
   * count, both of which are scoped per space.
   */
  const freshSpaceWithPhotos = async (
    name: string,
    photoCount: number,
  ): Promise<{ spaceId: string; assets: Array<{ id: string; filename: string }> }> => {
    const space = await utils.createSpace(owner.accessToken, { name });
    await utils.addSpaceMember(owner.accessToken, space.id, { userId: editor.userId, role: SharedSpaceRole.Editor });
    await utils.addSpaceMember(owner.accessToken, space.id, { userId: viewer.userId });

    const assets = await Promise.all(
      Array.from({ length: photoCount }, async (_, i) => {
        const filename = `${name}-${i}.png`;
        const asset = await utils.createAsset(owner.accessToken, { assetData: { filename } });
        return { id: asset.id, filename };
      }),
    );
    await utils.addSpaceAssets(
      owner.accessToken,
      space.id,
      assets.map((asset) => asset.id),
    );

    return { spaceId: space.id, assets };
  };

  /**
   * Create a challenge as `editor` sized to consume every photo `freshSpaceWithPhotos` added.
   * With zero location candidates (no GPS fixtures in this file), GameService.create's
   * `dateRemaining` equals the requested `roundCount` and the date pool is exactly the space's
   * `photoCount` photos (none excluded — first challenge in a fresh space) — so requesting
   * `roundCount === photoCount` deterministically yields exactly that many rounds.
   */
  const createChallenge = async (spaceId: string, roundCount: number): Promise<GameChallengeResponseDto> => {
    const { status, body } = await request(app)
      .post(`/shared-spaces/${spaceId}/games`)
      .set('Authorization', `Bearer ${editor.accessToken}`)
      .send({ roundCount });
    expect(status).toBe(201);
    return body as GameChallengeResponseDto;
  };

  describe('POST /shared-spaces/:spaceId/games', () => {
    it('lets an editor create a challenge that comes back with rounds', async () => {
      // 4 photos vs the default roundCount of 5 - deliberately thin, so this doubles as coverage
      // of "actual rounds may be fewer than requested" (GameChallengeResponseDto.roundCount's own
      // doc comment); expect fewer rounds than requested, not exactly 5.
      const { spaceId } = await freshSpaceWithPhotos('create-challenge', 4);

      const { status, body } = await request(app)
        .post(`/shared-spaces/${spaceId}/games`)
        .set('Authorization', `Bearer ${editor.accessToken}`)
        .send({ name: 'My Challenge' });

      expect(status).toBe(201);
      expect(body).toEqual(
        expect.objectContaining({
          id: expect.any(String),
          spaceId,
          name: 'My Challenge',
          roundCount: expect.any(Number),
          scaleKm: expect.any(Number),
          scaleDays: expect.any(Number),
          createdAt: expect.any(String),
        }),
      );
      expect(body.roundCount).toBeGreaterThan(0);
      // POST returns GameChallengeResponseDto, not the detail DTO - it never carries `rounds`
      // (see server/src/dtos/game.dto.ts: GameChallengeDetailResponseSchema.extend adds `rounds`
      // on top of GameChallengeResponseSchema, and the controller types createChallenge's return
      // as the base DTO).
      expect(body.rounds).toBeUndefined();

      const detail = await getDetail(body.id, editor.accessToken);
      expect(detail.rounds).toHaveLength(body.roundCount);
    });

    it('rejects a viewer creating a challenge (403)', async () => {
      const { spaceId } = await freshSpaceWithPhotos('viewer-create-reject', 4);

      const { status } = await request(app)
        .post(`/shared-spaces/${spaceId}/games`)
        .set('Authorization', `Bearer ${viewer.accessToken}`)
        .send({});

      expect(status).toBe(403);
    });

    it('rejects a non-member creating a challenge (403)', async () => {
      const { spaceId } = await freshSpaceWithPhotos('nonmember-create-reject', 4);

      const { status } = await request(app)
        .post(`/shared-spaces/${spaceId}/games`)
        .set('Authorization', `Bearer ${nonMember.accessToken}`)
        .send({});

      expect(status).toBe(403);
    });
  });

  describe('viewer permissions', () => {
    // Only this block touches GET .../image expecting 200, so the websocket connection needed
    // to wait for it is scoped here rather than to the whole file.
    let websocket: Socket;

    beforeAll(async () => {
      websocket = await utils.connectWebsocket(owner.accessToken);
    });

    afterAll(() => {
      utils.disconnectWebsocket(websocket);
    });

    it('lets a viewer play a challenge, but rejects viewer create and delete with 403', async () => {
      const { spaceId, assets } = await freshSpaceWithPhotos('viewer-play', 4);

      // GameService.getRoundImage (via GameRepository.getEligibleRoundAsset, which inner-joins
      // asset_file) 404s unless the round's asset already has an AssetFileType.Preview file -
      // and it re-checks that on every request, not just at generation. That file is written by the
      // async thumbnailGeneration job, not synchronously at upload (asset-media.service.ts:352-
      // 371 only sets localDateTime/type/visibility on the sync path). `on_upload_success` is
      // emitted from inside the AssetGenerateThumbnails job case (job.service.ts:216-249), i.e.
      // only once that file exists - so waiting for it on every uploaded photo guarantees
      // whichever one the challenge picks for round 0 is already servable, regardless of which
      // asset that turns out to be (round-to-asset assignment is intentionally hidden pre-guess,
      // see the leakage test below, so we can't target the wait at just one asset id).
      await Promise.all(assets.map((asset) => utils.waitForWebsocketEvent({ event: 'assetUpload', id: asset.id })));

      const challenge = await createChallenge(spaceId, 4);

      const detail = await getDetail(challenge.id, viewer.accessToken);
      const [round] = detail.rounds;

      const listRes = await request(app)
        .get(`/shared-spaces/${spaceId}/games`)
        .set('Authorization', `Bearer ${viewer.accessToken}`);
      expect(listRes.status).toBe(200);

      const guessRes = await request(app)
        .post(`/games/${challenge.id}/rounds/${round.index}/guess`)
        .set('Authorization', `Bearer ${viewer.accessToken}`)
        .send(guessPayloadFor(round));
      expect(guessRes.status).toBe(201);

      const imageRes = await request(app)
        .get(`/games/${challenge.id}/rounds/${round.index}/image`)
        .set('Authorization', `Bearer ${viewer.accessToken}`);
      expect(imageRes.status).toBe(200);

      const leaderboardRes = await request(app)
        .get(`/games/${challenge.id}/leaderboard`)
        .set('Authorization', `Bearer ${viewer.accessToken}`);
      expect(leaderboardRes.status).toBe(200);

      const createRes = await request(app)
        .post(`/shared-spaces/${spaceId}/games`)
        .set('Authorization', `Bearer ${viewer.accessToken}`)
        .send({});
      expect(createRes.status).toBe(403);

      const deleteRes = await request(app)
        .delete(`/games/${challenge.id}`)
        .set('Authorization', `Bearer ${viewer.accessToken}`);
      expect(deleteRes.status).toBe(403);
    });
  });

  describe('non-member access', () => {
    it('rejects a non-member on every game route', async () => {
      const { spaceId } = await freshSpaceWithPhotos('nonmember-matrix', 4);
      const challenge = await createChallenge(spaceId, 4);
      const auth = `Bearer ${nonMember.accessToken}`;

      const calls: Array<() => request.Test> = [
        () => request(app).post(`/shared-spaces/${spaceId}/games`).set('Authorization', auth).send({}),
        () => request(app).get(`/shared-spaces/${spaceId}/games`).set('Authorization', auth),
        () => request(app).get(`/games/${challenge.id}`).set('Authorization', auth),
        () =>
          request(app)
            .post(`/games/${challenge.id}/rounds/0/guess`)
            .set('Authorization', auth)
            .send({ date: '2020-06-15T00:00:00.000Z' }),
        () => request(app).get(`/games/${challenge.id}/rounds/0/image`).set('Authorization', auth),
        () => request(app).get(`/games/${challenge.id}/leaderboard`).set('Authorization', auth),
        () => request(app).delete(`/games/${challenge.id}`).set('Authorization', auth),
      ];

      for (const call of calls) {
        const { status } = await call();
        expect(status).toBe(403);
      }
    });
  });

  describe('POST /games/:id/rounds/:index/guess', () => {
    it('scores a guess between 0 and 5000, and rejects a repeat guess on the same round with 409', async () => {
      const { spaceId } = await freshSpaceWithPhotos('guess-flow', 4);
      const challenge = await createChallenge(spaceId, 4);
      const detail = await getDetail(challenge.id, viewer.accessToken);
      const [round] = detail.rounds;
      const guessBody = guessPayloadFor(round);

      const first = await request(app)
        .post(`/games/${challenge.id}/rounds/${round.index}/guess`)
        .set('Authorization', `Bearer ${viewer.accessToken}`)
        .send(guessBody);

      expect(first.status).toBe(201);
      expect(first.body).toEqual(
        expect.objectContaining({
          roundId: expect.any(String),
          userId: viewer.userId,
          score: expect.any(Number),
        }),
      );
      expect(first.body.score).toBeGreaterThanOrEqual(0);
      expect(first.body.score).toBeLessThanOrEqual(5000);

      const second = await request(app)
        .post(`/games/${challenge.id}/rounds/${round.index}/guess`)
        .set('Authorization', `Bearer ${viewer.accessToken}`)
        .send(guessBody);

      expect(second.status).toBe(409);
    });
  });

  describe('GET /games/:id/leaderboard', () => {
    it("totals match the sum of the player's round scores", async () => {
      const { spaceId } = await freshSpaceWithPhotos('leaderboard', 4);
      const challenge = await createChallenge(spaceId, 4);
      const detail = await getDetail(challenge.id, viewer.accessToken);

      // Sequential: each guess targets a distinct round index so there's no unique-constraint
      // race, but keeping this a plain for-of (matching the repo's own preference for
      // deterministic, easy-to-debug sequences over Promise.all in scoring-sensitive flows).
      let expectedTotal = 0;
      for (const round of detail.rounds) {
        const { status, body } = await request(app)
          .post(`/games/${challenge.id}/rounds/${round.index}/guess`)
          .set('Authorization', `Bearer ${viewer.accessToken}`)
          .send(guessPayloadFor(round));
        expect(status).toBe(201);
        expectedTotal += body.score as number;
      }

      const { status, body } = await request(app)
        .get(`/games/${challenge.id}/leaderboard`)
        .set('Authorization', `Bearer ${viewer.accessToken}`);

      expect(status).toBe(200);
      const entry = (body.entries as Array<{ userId: string; total: number; answered: number }>).find(
        (e) => e.userId === viewer.userId,
      );
      expect(entry).toBeDefined();
      expect(entry?.answered).toBe(detail.rounds.length);
      expect(entry?.total).toBe(expectedTotal);
    });
  });

  describe('GET /games/:id (answer leakage)', () => {
    it('never serialises coordinates, dates, asset ids or filenames for unguessed rounds', async () => {
      const { spaceId, assets } = await freshSpaceWithPhotos('leakage-secret', 4);
      const challenge = await createChallenge(spaceId, 4);

      const detail = await getDetail(challenge.id, viewer.accessToken);
      expect(detail.rounds.length).toBeGreaterThan(0);

      const unguessedRounds = detail.rounds.filter((round) => !round.answer);
      // Non-vacuous: nothing has been guessed yet, so every round must still be withheld. If
      // this ever comes back shorter than detail.rounds, the FILTER (not the leak check below)
      // is broken, and the substring assertions that follow would be checking too little.
      expect(unguessedRounds).toHaveLength(detail.rounds.length);

      // Structural check: a withheld round carries only index/type. GameService.toRoundDetail is
      // the sole place allowed to attach assetId/score/answer, and only once a guess exists for
      // this caller - this catches an unexpected extra field a substring search could miss.
      for (const round of unguessedRounds) {
        expect(Object.keys(round).toSorted((a, b) => a.localeCompare(b))).toEqual(['index', 'type']);
      }

      const serialised = JSON.stringify(unguessedRounds);
      for (const asset of assets) {
        expect(serialised).not.toContain(asset.id);
        expect(serialised).not.toContain(asset.filename);
      }
      expect(serialised).not.toMatch(/answerLat|answerLon|answerDate|latitude|longitude/);

      // Positive control: once a round IS guessed, its answer (including the asset id) appears -
      // proving the withholding above is guess-gated, not a field that's simply never returned.
      const [firstRound] = detail.rounds;
      const guessRes = await request(app)
        .post(`/games/${challenge.id}/rounds/${firstRound.index}/guess`)
        .set('Authorization', `Bearer ${viewer.accessToken}`)
        .send(guessPayloadFor(firstRound));
      expect(guessRes.status).toBe(201);

      const after = await getDetail(challenge.id, viewer.accessToken);
      const guessedRound = after.rounds.find((round) => round.index === firstRound.index);
      expect(guessedRound?.assetId).toBeDefined();
      expect(guessedRound?.answer).toBeDefined();
      expect(assets.map((asset) => asset.id)).toContain(guessedRound?.assetId);
    });
  });
});
