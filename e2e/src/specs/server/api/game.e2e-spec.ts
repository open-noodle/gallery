import {
  GameChallengeDetailResponseDto,
  GameChallengeListItemResponseDto,
  GameChallengeResponseDto,
  GameLeaderboardResponseDto,
  GameRoundDetailResponseDto,
  GameRoundType,
  GameStandingsResponseDto,
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
 *
 * The default date deliberately scores ZERO. Every fixture photo is uploaded seconds before the
 * challenge, so the pool's day spread collapses to poolScaleDays' floor of 1 and a guess six years
 * out decays to nothing (scoreFromError). Tests that need a player to actually put points on the
 * board pass a date inside the photos' own month instead, which monthOffsetDays grades as a direct
 * hit - see the standings ordering test.
 */
const guessPayloadFor = (
  round: GameRoundDetailResponseDto,
  date = '2020-06-15T00:00:00.000Z',
): { lat: number; lon: number } | { date: string } =>
  round.type === GameRoundType.Location ? { lat: 12.34, lon: 56.78 } : { date };

const getDaily = async (
  spaceId: string,
  accessToken: string,
): Promise<{ challenge: (GameChallengeListItemResponseDto & { dailyOn: string | null }) | null }> => {
  const { status, body } = await request(app)
    .get(`/shared-spaces/${spaceId}/games/daily`)
    .set('Authorization', `Bearer ${accessToken}`);
  expect(status).toBe(200);
  return body as { challenge: (GameChallengeListItemResponseDto & { dailyOn: string | null }) | null };
};

const getStandings = async (spaceId: string, accessToken: string): Promise<GameStandingsResponseDto> => {
  const { status, body } = await request(app)
    .get(`/shared-spaces/${spaceId}/games/standings`)
    .set('Authorization', `Bearer ${accessToken}`);
  expect(status).toBe(200);
  return body as GameStandingsResponseDto;
};

const getDetail = async (challengeId: string, accessToken: string): Promise<GameChallengeDetailResponseDto> => {
  const { status, body } = await request(app)
    .get(`/games/${challengeId}`)
    .set('Authorization', `Bearer ${accessToken}`);
  expect(status).toBe(200);
  return body as GameChallengeDetailResponseDto;
};

const setDailyEnabled = async (spaceId: string, accessToken: string, enabled: boolean) => {
  // PATCH, not PUT: SharedSpaceController's update route is `@Patch(':id')` (shared-space.controller.ts),
  // matching the generated SDK's updateSpace, which the web app's toggle actually calls.
  const { status } = await request(app)
    .patch(`/shared-spaces/${spaceId}`)
    .set('Authorization', `Bearer ${accessToken}`)
    .send({ dailyChallengeEnabled: enabled });
  expect(status).toBe(200);
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

      // The guess comes back too, and matches what was actually submitted. `firstRound` is a
      // 'date' round here (per the guessPayloadFor comment above: this file's fixtures never
      // carry GPS EXIF, so every generated round is 'date'), so the location half of the pair is
      // null - offsetDays is left to `expect.any(Number)` since its exact value depends on how far
      // the fixed guess date falls from the fixture photos' upload time.
      expect(guessedRound?.guess).toEqual({
        lat: null,
        lon: null,
        date: '2020-06-15T00:00:00.000Z',
        distanceKm: null,
        offsetDays: expect.any(Number),
      });
    });

    it('never returns another player guess', async () => {
      const { spaceId } = await freshSpaceWithPhotos('leakage-isolation', 4);
      const challenge = await createChallenge(spaceId, 4);
      const initialDetail = await getDetail(challenge.id, owner.accessToken);
      const [round] = initialDetail.rounds;

      // Two members of the same space guess round 0 differently. `round` is a 'date' round here
      // (per the guessPayloadFor comment above: this file's fixtures never carry GPS EXIF), so the
      // two guesses are distinguished by date rather than by coordinates.
      for (const [player, date] of [
        [owner, '2020-06-15T00:00:00.000Z'],
        [editor, '2021-09-03T00:00:00.000Z'],
      ] as const) {
        const { status } = await request(app)
          .post(`/games/${challenge.id}/rounds/0/guess`)
          .set('Authorization', `Bearer ${player.accessToken}`)
          .send(guessPayloadFor(round, date));
        expect(status).toBe(201);
      }

      const asOwner = await getDetail(challenge.id, owner.accessToken);
      const ownerRound = asOwner.rounds.find((r) => r.index === round.index);

      expect(ownerRound?.guess?.date).toBe('2020-06-15T00:00:00.000Z');
      // The editor's guess must appear nowhere in the owner's payload, under any key.
      expect(JSON.stringify(asOwner)).not.toContain('2021-09-03');
    });
  });

  describe('the daily challenge', () => {
    // The one thing unit tests cannot prove: the daily is generated lazily by whoever opens the
    // page first, so two members arriving together really do both try to insert one. The partial
    // unique index on (spaceId, dailyOn) is what makes the loser re-read the winner instead of
    // creating a second, divergent daily - if that broke, these two players would be competing on
    // different photos while sharing a leaderboard.
    it('hands every member the same daily, even when two of them generate it at once', async () => {
      const { spaceId } = await freshSpaceWithPhotos('daily-race', 6);
      await setDailyEnabled(spaceId, editor.accessToken, true);

      const [first, second, third] = await Promise.all([
        getDaily(spaceId, viewer.accessToken),
        getDaily(spaceId, editor.accessToken),
        getDaily(spaceId, owner.accessToken),
      ]);

      expect(first.challenge).not.toBeNull();
      expect(second.challenge?.id).toBe(first.challenge?.id);
      expect(third.challenge?.id).toBe(first.challenge?.id);
      // Stamped with a UTC calendar day, not a timestamp.
      expect(first.challenge?.dailyOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });

    it('keeps handing back the same daily on a later read', async () => {
      const { spaceId } = await freshSpaceWithPhotos('daily-stable', 6);
      await setDailyEnabled(spaceId, editor.accessToken, true);

      const first = await getDaily(spaceId, viewer.accessToken);
      const second = await getDaily(spaceId, viewer.accessToken);

      // Guard the premise: without a real daily on both sides, `undefined === undefined` would pass
      // vacuously and prove nothing about stability.
      expect(first.challenge).not.toBeNull();
      expect(second.challenge?.id).toBe(first.challenge?.id);
    });

    // The daily belongs to the space, so it must not turn up in the player-created list - where it
    // would carry a delete control the server then refuses.
    it('never appears in the space challenge list', async () => {
      const { spaceId } = await freshSpaceWithPhotos('daily-not-listed', 6);
      await setDailyEnabled(spaceId, editor.accessToken, true);
      const daily = await getDaily(spaceId, viewer.accessToken);
      // Guard the premise: with no real daily, `not.toContain(undefined)` below would pass
      // vacuously regardless of whether the exclusion actually works.
      expect(daily.challenge).not.toBeNull();
      await createChallenge(spaceId, 2);

      const { status, body } = await request(app)
        .get(`/shared-spaces/${spaceId}/games`)
        .set('Authorization', `Bearer ${viewer.accessToken}`);

      expect(status).toBe(200);
      const ids = (body as GameChallengeListItemResponseDto[]).map((item) => item.id);
      expect(ids).not.toHaveLength(0);
      expect(ids).not.toContain(daily.challenge?.id);
    });

    it('refuses to delete the daily, even for an editor', async () => {
      const { spaceId } = await freshSpaceWithPhotos('daily-undeletable', 6);
      await setDailyEnabled(spaceId, editor.accessToken, true);
      const daily = await getDaily(spaceId, viewer.accessToken);
      // Guard the premise: a null challenge would DELETE /games/undefined, which 400s on malformed
      // id format alone - passing the assertion below for the wrong reason.
      expect(daily.challenge).not.toBeNull();

      const { status } = await request(app)
        .delete(`/games/${daily.challenge?.id}`)
        .set('Authorization', `Bearer ${editor.accessToken}`);

      expect(status).toBe(400);
    });

    it('rejects a non-member reading the daily', async () => {
      const { spaceId } = await freshSpaceWithPhotos('daily-nonmember', 6);

      const { status } = await request(app)
        .get(`/shared-spaces/${spaceId}/games/daily`)
        .set('Authorization', `Bearer ${nonMember.accessToken}`);

      expect(status).toBe(403);
    });
  });

  describe('daily challenge opt-in', () => {
    it('returns no daily and creates nothing until a space opts in', async () => {
      const { spaceId } = await freshSpaceWithPhotos('daily-optin-unasked', 4);

      const daily = await getDaily(spaceId, viewer.accessToken);
      expect(daily.challenge).toBeNull();

      // The response alone would also be satisfied by a guard placed after the lookup, which would
      // still have generated the challenge. The list is what proves nothing was created.
      const { body } = await request(app)
        .get(`/shared-spaces/${spaceId}/games`)
        .set('Authorization', `Bearer ${viewer.accessToken}`);
      expect(body).toHaveLength(0);
    });

    it('generates the daily once an editor opts in', async () => {
      const { spaceId } = await freshSpaceWithPhotos('daily-optin-enabled', 4);

      await setDailyEnabled(spaceId, editor.accessToken, true);

      const daily = await getDaily(spaceId, viewer.accessToken);
      expect(daily.challenge).not.toBeNull();
    });

    it('rejects a viewer changing the setting', async () => {
      const { spaceId } = await freshSpaceWithPhotos('daily-optin-viewer', 4);

      const { status } = await request(app)
        .patch(`/shared-spaces/${spaceId}`)
        .set('Authorization', `Bearer ${viewer.accessToken}`)
        .send({ dailyChallengeEnabled: true });

      expect(status).toBe(403);
    });

    it('keeps the standings board across a disable and re-enable', async () => {
      const { spaceId } = await freshSpaceWithPhotos('daily-optin-roundtrip', 4);
      await setDailyEnabled(spaceId, editor.accessToken, true);

      const daily = await getDaily(spaceId, viewer.accessToken);
      const detail = await getDetail(daily.challenge!.id, viewer.accessToken);
      for (const round of detail.rounds) {
        const { status } = await request(app)
          .post(`/games/${daily.challenge!.id}/rounds/${round.index}/guess`)
          .set('Authorization', `Bearer ${viewer.accessToken}`)
          .send(guessPayloadFor(round, new Date().toISOString()));
        expect(status).toBe(201);
      }

      const standings = await getStandings(spaceId, viewer.accessToken);
      const earned = standings.entries.find((entry) => entry.userId === viewer.userId)!;
      // Guard the premise: the default guess date scores zero, which would make every assertion
      // below compare 0 to 0 and prove nothing.
      expect(earned.total).toBeGreaterThan(0);

      await setDailyEnabled(spaceId, editor.accessToken, false);
      const standingsAfterDisable = await getStandings(spaceId, viewer.accessToken);
      const afterDisable = standingsAfterDisable.entries.find((entry) => entry.userId === viewer.userId)!;
      expect(afterDisable.total).toBe(earned.total);
      expect(afterDisable.daysPlayed).toBe(earned.daysPlayed);

      await setDailyEnabled(spaceId, editor.accessToken, true);
      const standingsAfterReEnable = await getStandings(spaceId, viewer.accessToken);
      const afterReEnable = standingsAfterReEnable.entries.find((entry) => entry.userId === viewer.userId)!;
      expect(afterReEnable.total).toBe(earned.total);
    });
  });

  describe('game type', () => {
    // Every fixture photo here is a generated PNG with no EXIF GPS, so this space can only make
    // date rounds - which is exactly what makes it a real test of both branches.
    it('builds only date rounds when a date game is requested', async () => {
      const { spaceId } = await freshSpaceWithPhotos('type-date', 4);

      const { status, body } = await request(app)
        .post(`/shared-spaces/${spaceId}/games`)
        .set('Authorization', `Bearer ${editor.accessToken}`)
        .send({ roundCount: 4, type: 'date' });

      expect(status).toBe(201);
      const detail = await getDetail(body.id, editor.accessToken);
      expect(detail.rounds).not.toHaveLength(0);
      expect(detail.rounds.every((round) => round.type === GameRoundType.Date)).toBe(true);
    });

    // The request is explicit, so it must be refused rather than filled with the date rounds this
    // space does have - otherwise the type picker silently does nothing.
    it('refuses a location game in a space with no GPS photos', async () => {
      const { spaceId } = await freshSpaceWithPhotos('type-location-impossible', 4);

      const { status } = await request(app)
        .post(`/shared-spaces/${spaceId}/games`)
        .set('Authorization', `Bearer ${editor.accessToken}`)
        .send({ roundCount: 4, type: 'location' });

      expect(status).toBe(400);
    });
  });

  describe('challenge id format', () => {
    // Regression guard for the v4/v7 mismatch that made every challenge-scoped route 400 with
    // "Invalid UUID": game_challenge.id is @PrimaryGeneratedUuidV7Column (DEFAULT immich_uuid_v7()),
    // but the routes keyed by that id validated it as a v4 uuid, so no real id could ever pass.
    // Asserted here as an explicit contract because the failure otherwise surfaces as a bare
    // "expected 400 to be 200" in every other test in this file, which does not name the cause.
    it('issues a v7 challenge id that every challenge-scoped route accepts', async () => {
      const { spaceId } = await freshSpaceWithPhotos('id-format', 4);
      const challenge = await createChallenge(spaceId, 4);

      // Version nibble (first character of the 3rd group) must be 7 - this is what the route
      // validators have to agree with.
      expect(challenge.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);

      const auth = `Bearer ${editor.accessToken}`;
      const routes: Array<() => request.Test> = [
        () => request(app).get(`/games/${challenge.id}`).set('Authorization', auth),
        () => request(app).get(`/games/${challenge.id}/rounds/0/image`).set('Authorization', auth),
        () => request(app).get(`/games/${challenge.id}/leaderboard`).set('Authorization', auth),
        () =>
          request(app)
            .post(`/games/${challenge.id}/rounds/0/guess`)
            .set('Authorization', auth)
            .send({ date: '2020-06-15T00:00:00.000Z' }),
        () => request(app).delete(`/games/${challenge.id}`).set('Authorization', auth),
      ];
      for (const route of routes) {
        const { status } = await route();
        // Asserting "not a validation rejection" rather than a specific success code: these five
        // routes answer with a spread of codes (200/201/204), and GET .../image additionally 404s
        // unless the round's photo already has a Preview file - a timing concern this test
        // deliberately does not take on, since all it needs to prove is that the id reached the
        // handler instead of being rejected at the param boundary. The malformed-id test below is
        // the control that keeps this non-vacuous.
        expect(status).not.toBe(400);
      }
    });

    it('still rejects a malformed challenge id with 400', async () => {
      // Positive control: proves the assertions above pass because the id is valid, not because
      // param validation stopped running altogether.
      const { status } = await request(app)
        .get('/games/not-a-uuid')
        .set('Authorization', `Bearer ${editor.accessToken}`);
      expect(status).toBe(400);
    });
  });

  describe('full play-through', () => {
    // Needs GET .../image to serve a real file, so the uploaded photos' Preview files must exist -
    // same websocket wait (and reasoning) as the 'viewer permissions' block above.
    let websocket: Socket;

    beforeAll(async () => {
      websocket = await utils.connectWebsocket(owner.accessToken);
    });

    afterAll(() => {
      utils.disconnectWebsocket(websocket);
    });

    it('walks create -> list -> detail -> round image -> guess every round -> leaderboard', async () => {
      const { spaceId, assets } = await freshSpaceWithPhotos('full-flow', 4);
      await Promise.all(assets.map((asset) => utils.waitForWebsocketEvent({ event: 'assetUpload', id: asset.id })));

      const challenge = await createChallenge(spaceId, 4);

      // 1. The challenge appears in its space's listing, with the caller's progress zeroed. The
      // list endpoint's body is otherwise unasserted in this file - only its status code is.
      const listBefore = await request(app)
        .get(`/shared-spaces/${spaceId}/games`)
        .set('Authorization', `Bearer ${viewer.accessToken}`);
      expect(listBefore.status).toBe(200);
      const entryBefore = (listBefore.body as GameChallengeListItemResponseDto[]).find(
        (item) => item.id === challenge.id,
      );
      expect(entryBefore).toBeDefined();
      expect(entryBefore?.answered).toBe(0);
      expect(entryBefore?.total).toBe(0);
      expect(entryBefore?.closedAt).toBeNull();

      // 2. Detail returns every generated round.
      const detail = await getDetail(challenge.id, viewer.accessToken);
      expect(detail.rounds).toHaveLength(challenge.roundCount);

      // 3. Each round's photo is actually servable as an image.
      for (const round of detail.rounds) {
        const imageRes = await request(app)
          .get(`/games/${challenge.id}/rounds/${round.index}/image`)
          .set('Authorization', `Bearer ${viewer.accessToken}`);
        expect(imageRes.status).toBe(200);
        expect(imageRes.headers['content-type']).toMatch(/^image\//);
        expect(imageRes.body.length).toBeGreaterThan(0);
      }

      // 4. Guessing every round scores each one and reveals that round's answer.
      let expectedTotal = 0;
      for (const round of detail.rounds) {
        const { status, body } = await request(app)
          .post(`/games/${challenge.id}/rounds/${round.index}/guess`)
          .set('Authorization', `Bearer ${viewer.accessToken}`)
          .send(guessPayloadFor(round));
        expect(status).toBe(201);
        expect(body.score).toBeGreaterThanOrEqual(0);
        expect(body.score).toBeLessThanOrEqual(5000);
        expectedTotal += body.score as number;
      }

      // 5. Every round now carries its answer and asset id.
      const played = await getDetail(challenge.id, viewer.accessToken);
      for (const round of played.rounds) {
        expect(round.answer).toBeDefined();
        expect(round.assetId).toBeDefined();
        expect(round.score).toBeGreaterThanOrEqual(0);
      }

      // 6. The leaderboard totals the caller's rounds.
      const leaderboardRes = await request(app)
        .get(`/games/${challenge.id}/leaderboard`)
        .set('Authorization', `Bearer ${viewer.accessToken}`);
      expect(leaderboardRes.status).toBe(200);
      const standing = (leaderboardRes.body.entries as Array<{ userId: string; total: number; answered: number }>).find(
        (e) => e.userId === viewer.userId,
      );
      expect(standing?.answered).toBe(detail.rounds.length);
      expect(standing?.total).toBe(expectedTotal);

      // 7. ...and the space listing reflects the same finished progress.
      const listAfter = await request(app)
        .get(`/shared-spaces/${spaceId}/games`)
        .set('Authorization', `Bearer ${viewer.accessToken}`);
      expect(listAfter.status).toBe(200);
      const entryAfter = (listAfter.body as GameChallengeListItemResponseDto[]).find(
        (item) => item.id === challenge.id,
      );
      expect(entryAfter?.answered).toBe(detail.rounds.length);
      expect(entryAfter?.total).toBe(expectedTotal);
    });
  });

  describe('GET /shared-spaces/:spaceId/games/standings', () => {
    it('rejects a non-member', async () => {
      const { spaceId } = await freshSpaceWithPhotos('standings-nonmember', 4);

      const { status } = await request(app)
        .get(`/shared-spaces/${spaceId}/games/standings`)
        .set('Authorization', `Bearer ${nonMember.accessToken}`);

      expect(status).toBe(403);
    });

    it('lists every member of the space, zero-filled, before anyone has played', async () => {
      const { spaceId } = await freshSpaceWithPhotos('standings-zero-fill', 4);

      const standings = await getStandings(spaceId, viewer.accessToken);

      expect(standings.month).toMatch(/^\d{4}-\d{2}$/);
      expect(standings.entries).toHaveLength(3); // owner + editor + viewer
      // Paired with the length above, so an empty board cannot satisfy this vacuously.
      expect(standings.entries.every((entry) => entry.total === 0 && entry.daysPlayed === 0)).toBe(true);
      // Zero-filled rows carry the real member names, not a placeholder.
      expect(standings.entries.map((entry) => entry.name).toSorted((a, b) => a.localeCompare(b))).toEqual(
        [owner.name, editor.name, viewer.name].toSorted((a, b) => a.localeCompare(b)),
      );
    });

    it("counts a member's daily score and orders the board by it", async () => {
      const { spaceId } = await freshSpaceWithPhotos('standings-order', 4);
      await setDailyEnabled(spaceId, editor.accessToken, true);
      const daily = await getDaily(spaceId, viewer.accessToken);
      expect(daily.challenge).not.toBeNull();

      // Three genuinely different states on one board: the viewer answers every round with a date
      // in the photos' own month and scores, the editor answers one round with the far-off default
      // and scores nothing, and the owner never plays at all.
      const detail = await getDetail(daily.challenge!.id, viewer.accessToken);
      expect(detail.rounds).not.toHaveLength(0);

      let viewerTotal = 0;
      for (const round of detail.rounds) {
        const { status, body } = await request(app)
          .post(`/games/${daily.challenge!.id}/rounds/${round.index}/guess`)
          .set('Authorization', `Bearer ${viewer.accessToken}`)
          .send(guessPayloadFor(round, new Date().toISOString()));
        expect(status).toBe(201);
        viewerTotal += body.score as number;
      }
      // Guard on the premise: if the viewer's guesses ever stopped scoring, every total on the
      // board would be 0 and the ordering below would be settled by the name tie-break instead of
      // by the points - passing while proving nothing about the standings query.
      expect(viewerTotal).toBeGreaterThan(0);

      const [firstRound] = detail.rounds;
      const { status: editorStatus } = await request(app)
        .post(`/games/${daily.challenge!.id}/rounds/${firstRound.index}/guess`)
        .set('Authorization', `Bearer ${editor.accessToken}`)
        .send(guessPayloadFor(firstRound));
      expect(editorStatus).toBe(201);

      const standings = await getStandings(spaceId, viewer.accessToken);

      expect(standings.entries).toHaveLength(3);
      expect(standings.entries[0].userId).toBe(viewer.userId);
      // The board totals the guesses themselves, not the number of rounds touched.
      expect(standings.entries[0].total).toBe(viewerTotal);
      expect(standings.entries[0].daysPlayed).toBe(1);
      // The editor scored nothing, so they and the owner are level on points: only the
      // never-played rule in compareStandings can separate these two rows.
      expect(standings.entries[1].userId).toBe(editor.userId);
      expect(standings.entries[1].total).toBe(0);
      expect(standings.entries[1].daysPlayed).toBe(1);
      expect(standings.entries[2].userId).toBe(owner.userId);
      expect(standings.entries[2].daysPlayed).toBe(0);
    });

    it('never counts points earned on a player-created challenge', async () => {
      const { spaceId } = await freshSpaceWithPhotos('standings-custom-excluded', 4);
      const challenge = await createChallenge(spaceId, 4);
      const detail = await getDetail(challenge.id, viewer.accessToken);

      // Scoring guesses, so a standings query that forgot its `dailyOn IS NOT NULL` filter would
      // show up in BOTH halves of the assertion below rather than only in daysPlayed. The 201
      // check keeps the test honest: guesses that silently failed would leave nothing to leak.
      let earned = 0;
      for (const round of detail.rounds) {
        const { status, body } = await request(app)
          .post(`/games/${challenge.id}/rounds/${round.index}/guess`)
          .set('Authorization', `Bearer ${viewer.accessToken}`)
          .send(guessPayloadFor(round, new Date().toISOString()));
        expect(status).toBe(201);
        earned += body.score as number;
      }
      expect(earned).toBeGreaterThan(0);

      const standings = await getStandings(spaceId, viewer.accessToken);

      expect(standings.entries).toHaveLength(3);
      expect(standings.entries.every((entry) => entry.total === 0 && entry.daysPlayed === 0)).toBe(true);
    });

    it('puts every member on a challenge leaderboard, played or not', async () => {
      const { spaceId } = await freshSpaceWithPhotos('leaderboard-zero-fill', 4);
      const challenge = await createChallenge(spaceId, 4);
      const detail = await getDetail(challenge.id, viewer.accessToken);
      const [firstRound] = detail.rounds;

      const guessRes = await request(app)
        .post(`/games/${challenge.id}/rounds/${firstRound.index}/guess`)
        .set('Authorization', `Bearer ${viewer.accessToken}`)
        .send(guessPayloadFor(firstRound));
      expect(guessRes.status).toBe(201);

      const { status, body } = await request(app)
        .get(`/games/${challenge.id}/leaderboard`)
        .set('Authorization', `Bearer ${viewer.accessToken}`);

      expect(status).toBe(200);
      const { entries } = body as GameLeaderboardResponseDto;
      expect(entries).toHaveLength(3);
      // The one player who turned up leads, even on nil points - the editor and owner never
      // guessed, so nothing but the never-played rule puts the viewer first.
      expect(entries[0].userId).toBe(viewer.userId);
      // Members the leaderboard zero-fills keep their real names; 'Unknown' was the placeholder
      // the old implementation emitted for anyone with no rows of their own.
      expect(entries.map((entry) => entry.name).toSorted((a, b) => a.localeCompare(b))).toEqual(
        [owner.name, editor.name, viewer.name].toSorted((a, b) => a.localeCompare(b)),
      );
    });
  });
});
