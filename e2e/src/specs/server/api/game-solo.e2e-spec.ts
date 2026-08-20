import { GameChallengeDetailResponseDto, GameChallengeResponseDto, LoginResponseDto } from '@immich/sdk';
import { Socket } from 'socket.io-client';
import { createUserDto } from 'src/fixtures';
import { app, utils } from 'src/utils';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * Solo play: the routes that take no space at all.
 *
 * Every player here is created fresh and joins NO space, which is the point - the space suite
 * proves a member can play, this one proves the game is reachable by someone who has never used
 * the shared-space feature. Nothing in this file adds a member, links an album or creates a space.
 *
 * Every fixture asset is a generated 1x1 PNG with no EXIF GPS, so `getSoloLocationCandidates`'
 * inner join on `asset_exif`'s lat/lon always excludes them and every round generated here is a
 * DATE round - the same property the space suite relies on, and why the guesses below are all
 * `{ date }`.
 */
describe('/games/solo', () => {
  let admin: LoginResponseDto;

  beforeAll(async () => {
    await utils.resetDatabase();
    admin = await utils.adminSetup();
  });

  /** A brand new player with `photoCount` of their own photos and no space membership at all. */
  const freshPlayer = async (
    key: string,
    photoCount: number,
  ): Promise<{ player: LoginResponseDto; assets: Array<{ id: string; filename: string }> }> => {
    const player = await utils.userSetup(admin.accessToken, createUserDto.create(key));
    const assets = await Promise.all(
      Array.from({ length: photoCount }, async (_, i) => {
        const filename = `${key}-${i}.png`;
        const asset = await utils.createAsset(player.accessToken, { assetData: { filename } });
        return { id: asset.id, filename };
      }),
    );
    return { player, assets };
  };

  const createSolo = async (player: LoginResponseDto, body: Record<string, unknown> = {}) =>
    request(app).post('/games/solo').set('Authorization', `Bearer ${player.accessToken}`).send(body);

  const readDaily = (player: LoginResponseDto) =>
    request(app).get('/games/solo/daily').set('Authorization', `Bearer ${player.accessToken}`);

  const getDetail = async (challengeId: string, player: LoginResponseDto): Promise<GameChallengeDetailResponseDto> => {
    const { status, body } = await request(app)
      .get(`/games/${challengeId}`)
      .set('Authorization', `Bearer ${player.accessToken}`);
    expect(status).toBe(200);
    return body as GameChallengeDetailResponseDto;
  };

  describe('POST /games/solo', () => {
    it('scopes the challenge to the player, with no space involved', async () => {
      const { player } = await freshPlayer('solo-create', 4);

      const { status, body } = await createSolo(player, { roundCount: 4 });

      expect(status).toBe(201);
      expect(body).toEqual(
        expect.objectContaining({
          id: expect.any(String),
          spaceId: null,
          ownerId: player.userId,
          roundCount: expect.any(Number),
          dailyOn: null,
        }),
      );
      expect(body.roundCount).toBeGreaterThan(0);
      // The source toggles are COLUMNS on the row, frozen at generation - they are not fields of
      // this response, and a spread of the scope object into it would ship them silently.
      expect(body).not.toHaveProperty('includePartners');
      expect(body).not.toHaveProperty('includeSpaces');
    });

    // The generator returns what it could actually build rather than failing, and the response has
    // to report that real number - a client that trusted the requested count would render five
    // rounds over a two-round challenge.
    it('returns a shorter challenge, honestly counted, when the pool is thinner than the request', async () => {
      const { player } = await freshPlayer('solo-thin-pool', 2);

      const { status, body } = await createSolo(player, { roundCount: 10 });

      expect(status).toBe(201);
      expect(body.roundCount).toBe(2);

      const detail = await getDetail(body.id, player);
      expect(detail.rounds).toHaveLength(2);
    });

    // The wording is the whole point of PersonalPool having its own message: a solo player may
    // have no spaces at all, so "This space has no photos usable for a challenge" sends them to a
    // page that does not exist for them.
    it('explains an empty pool in personal terms, never a space one', async () => {
      const { player } = await freshPlayer('solo-no-photos', 0);

      const { status, body } = await createSolo(player, {});

      expect(status).toBe(400);
      expect(body.message).toContain('None of your photos');
      expect(body.message).not.toContain('This space');
    });
  });

  describe('GET /games/solo/daily', () => {
    it('generates the daily on first read and returns the same one on the second', async () => {
      const { player } = await freshPlayer('solo-daily', 4);

      const first = await readDaily(player);
      expect(first.status).toBe(200);
      expect(first.body.challenge).toEqual(
        expect.objectContaining({
          id: expect.any(String),
          spaceId: null,
          ownerId: player.userId,
          // A calendar day, not a timestamp. Deliberately the shape and not today's actual date,
          // the same choice the space suite makes: pinning the date makes the suite fail once a
          // day, at UTC midnight, for no real reason. WHICH day is the UTC one is pinned in
          // game.service.spec.ts, under fake timers, where it can be asserted without a race.
          dailyOn: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
          answered: 0,
          total: 0,
        }),
      );

      const second = await readDaily(player);
      expect(second.status).toBe(200);
      // The same challenge, not merely an equivalent one: a second id would mean two dailies for
      // one player and one day, and the streak would count the day twice.
      expect(second.body.challenge.id).toBe(first.body.challenge.id);
    });

    // Two of the player's own devices opening the page at once. Postgres treats NULLs as distinct
    // in a unique index, so the space's (spaceId, dailyOn) index does not constrain solo rows at
    // all - game_challenge_owner_daily_uq is what makes the loser fail, and the loser must then
    // re-read the winner rather than surfacing a 500 or a second, divergent daily.
    it('yields one challenge when two reads race', async () => {
      const { player } = await freshPlayer('solo-daily-race', 4);

      const [first, second] = await Promise.all([readDaily(player), readDaily(player)]);

      expect(first.status).toBe(200);
      expect(second.status).toBe(200);
      expect(first.body.challenge).not.toBeNull();
      expect(second.body.challenge.id).toBe(first.body.challenge.id);
    });

    // Not a 404 and not a 400: a player with nothing playable has no daily today, which is an
    // ordinary state of the page the client renders on its own.
    it('reports no daily, rather than an error, for a player with no usable photos', async () => {
      const { player } = await freshPlayer('solo-daily-empty', 0);

      const { status, body } = await readDaily(player);

      expect(status).toBe(200);
      expect(body).toEqual({ challenge: null });
    });
  });

  describe('playing a solo challenge', () => {
    // Only this block expects GET .../image to serve a real file, so the websocket wait that
    // needs is scoped here.
    let websocket: Socket;
    let player: LoginResponseDto;
    let assets: Array<{ id: string; filename: string }>;
    let challenge: GameChallengeResponseDto;

    beforeAll(async () => {
      ({ player, assets } = await freshPlayer('solo-play', 4));
      websocket = await utils.connectWebsocket(player.accessToken);
      // getRoundImage 404s until the round's asset has a Preview file, which the async
      // thumbnailGeneration job writes - and which it re-checks on every request, not just at
      // generation. Which photo lands on which round is deliberately hidden until it is guessed,
      // so every uploaded photo is waited on rather than one targeted id.
      await Promise.all(assets.map((asset) => utils.waitForWebsocketEvent({ event: 'assetUpload', id: asset.id })));

      const created = await createSolo(player, { roundCount: 4 });
      expect(created.status).toBe(201);
      challenge = created.body as GameChallengeResponseDto;
    });

    afterAll(() => {
      utils.disconnectWebsocket(websocket);
    });

    it('withholds every unguessed round: no coordinates, date, asset id or filename', async () => {
      const detail = await getDetail(challenge.id, player);
      expect(detail.rounds.length).toBeGreaterThan(0);

      const unguessed = detail.rounds.filter((round) => !round.answer);
      // Non-vacuous: nothing has been guessed yet, so every round must still be withheld. A
      // shorter list here would mean the filter is broken and the checks below cover too little.
      expect(unguessed).toHaveLength(detail.rounds.length);

      for (const round of unguessed) {
        // Structural, not just a substring search: a withheld round carries index and type and
        // nothing else, so an unexpected extra field fails here rather than slipping through.
        expect(Object.keys(round).toSorted((a, b) => a.localeCompare(b))).toEqual(['index', 'type']);
      }

      const serialised = JSON.stringify(unguessed);
      for (const asset of assets) {
        expect(serialised).not.toContain(asset.id);
        expect(serialised).not.toContain(asset.filename);
      }
      expect(serialised).not.toMatch(/answerLat|answerLon|answerDate|latitude|longitude/);
    });

    it('walks create -> detail -> round image -> guess every round -> leaderboard', async () => {
      const detail = await getDetail(challenge.id, player);

      for (const round of detail.rounds) {
        const image = await request(app)
          .get(`/games/${challenge.id}/rounds/${round.index}/image`)
          .set('Authorization', `Bearer ${player.accessToken}`);
        expect(image.status).toBe(200);
        expect(image.headers['content-type']).toMatch(/^image\//);
        expect(image.body.length).toBeGreaterThan(0);
        // A generic, index-keyed filename - never the photo's real one.
        expect(image.headers['content-disposition']).toContain(`round-${round.index}`);

        const guess = await request(app)
          .post(`/games/${challenge.id}/rounds/${round.index}/guess`)
          .set('Authorization', `Bearer ${player.accessToken}`)
          .send({ date: new Date('2020-06-15T00:00:00.000Z').toISOString() });
        expect(guess.status).toBe(201);
        expect(guess.body.score).toEqual(expect.any(Number));
      }

      const played = await getDetail(challenge.id, player);
      for (const round of played.rounds) {
        expect(round.answer).toBeDefined();
        expect(round.assetId).toEqual(expect.any(String));
      }

      const leaderboard = await request(app)
        .get(`/games/${challenge.id}/leaderboard`)
        .set('Authorization', `Bearer ${player.accessToken}`);
      expect(leaderboard.status).toBe(200);
      // One player, so one row - the player's own, with what they actually scored.
      expect(leaderboard.body.entries).toHaveLength(1);
      expect(leaderboard.body.entries[0]).toEqual(
        expect.objectContaining({ userId: player.userId, answered: played.rounds.length }),
      );
    });
  });

  describe('solo challenge authorization', () => {
    it("404s a stranger on every route of someone else's solo challenge", async () => {
      const { player: alice } = await freshPlayer('solo-auth-alice', 4);
      const { player: bob } = await freshPlayer('solo-auth-bob', 0);

      const created = await createSolo(alice, { roundCount: 4 });
      // Asserted before the stranger touches it: a create that silently failed would make every
      // 404 below true for the wrong reason (id never existed at all, rather than access refused).
      expect(created.status).toBe(201);
      const challenge = created.body as GameChallengeResponseDto;

      for (const call of [
        request(app).get(`/games/${challenge.id}`),
        request(app).post(`/games/${challenge.id}/rounds/0/guess`).send({ date: new Date().toISOString() }),
        request(app).get(`/games/${challenge.id}/rounds/0/image`),
        request(app).get(`/games/${challenge.id}/leaderboard`),
        request(app).delete(`/games/${challenge.id}`),
      ]) {
        const { status } = await call.set('Authorization', `Bearer ${bob.accessToken}`);
        // 404 and not 403: a 403 confirms the id exists, which is an enumeration leak the space
        // routes already avoid.
        expect(status).toBe(404);
      }
    });

    // Scope-blind by construction (game.service.ts delete refuses both a space daily and a solo
    // one) - this is the solo half of that refusal, so a re-roll of the streak cannot be forced
    // through the owner's own DELETE.
    it('refuses to delete a solo daily, so the streak cannot be re-rolled', async () => {
      const { player: alice } = await freshPlayer('solo-auth-daily', 4);

      const daily = await readDaily(alice);
      // Asserted before deleting it: the refusal below is meaningless if the daily this test
      // depends on was never generated.
      expect(daily.status).toBe(200);
      expect(daily.body.challenge).not.toBeNull();

      const { status } = await request(app)
        .delete(`/games/${daily.body.challenge.id}`)
        .set('Authorization', `Bearer ${alice.accessToken}`);
      expect(status).toBe(400);
    });
  });
});
