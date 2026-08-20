import {
  GameChallengeDetailResponseDto,
  GameChallengeResponseDto,
  LoginResponseDto,
  ManualJobName,
  createJob,
  deleteUserAdmin,
  getMyPreferences,
  removePartner,
  updatePartner,
} from '@immich/sdk';
import { Socket } from 'socket.io-client';
import { createUserDto } from 'src/fixtures';
import { app, asBearerAuth, utils } from 'src/utils';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/** Compare asset-id sets without asserting a round ORDER, which the generation seed decides. */
const sorted = (ids: string[]) => ids.toSorted((a, b) => a.localeCompare(b));

/**
 * Solo play: the routes that take no space at all.
 *
 * Every player here is created fresh and joins NO space, which is the point - the space suite
 * proves a member can play, this one proves the game is reachable by someone who has never used
 * the shared-space feature. Only the `challenge scopes never cross` block at the bottom creates a
 * space, and it has to: proving a space challenge stays out of solo history needs one to exist.
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

  const readStats = (player: LoginResponseDto) =>
    request(app).get('/games/solo/stats').set('Authorization', `Bearer ${player.accessToken}`);

  const readHistory = (player: LoginResponseDto, query: Record<string, number> = {}) =>
    request(app).get('/games/solo/history').query(query).set('Authorization', `Bearer ${player.accessToken}`);

  /** A date guess on one round. Every fixture asset is GPS-free, so every round is a date round. */
  const guessRound = (player: LoginResponseDto, challengeId: string, index: number) =>
    request(app)
      .post(`/games/${challengeId}/rounds/${index}/guess`)
      .set('Authorization', `Bearer ${player.accessToken}`)
      .send({ date: new Date('2020-06-15T00:00:00.000Z').toISOString() });

  const getDetail = async (challengeId: string, player: LoginResponseDto): Promise<GameChallengeDetailResponseDto> => {
    const { status, body } = await request(app)
      .get(`/games/${challengeId}`)
      .set('Authorization', `Bearer ${player.accessToken}`);
    expect(status).toBe(200);
    return body as GameChallengeDetailResponseDto;
  };

  /** Guess every round of a challenge, so it counts as fully played. */
  const playEveryRound = async (player: LoginResponseDto, challengeId: string): Promise<void> => {
    const detail = await getDetail(challengeId, player);
    // Non-vacuous: a zero-round challenge would make every "played it all" assertion downstream
    // true without a single guess ever being submitted.
    expect(detail.rounds.length).toBeGreaterThan(0);

    for (const round of detail.rounds) {
      const guess = await guessRound(player, challengeId, round.index);
      expect(guess.status).toBe(201);
      expect(guess.body.score).toEqual(expect.any(Number));
    }
  };

  /**
   * Create a solo challenge, play it out, and return the asset ids it actually drew.
   *
   * A round's assetId is withheld until the caller has guessed on it, so playing the challenge is
   * the only way to see what it was built from. Deliberately a second, file-local copy of what
   * game-visibility-negatives.e2e-spec.ts calls `soloAssetIds` rather than a shared export: two
   * specs sharing a fixture helper couples them, and the duplication is a few lines.
   */
  const drawnAssetIds = async (
    player: LoginResponseDto,
    roundCount: number,
    sources?: { includePartners: boolean; includeSpaces: boolean },
  ): Promise<string[]> => {
    const created = await createSolo(player, sources ? { roundCount, sources } : { roundCount });
    expect(created.status).toBe(201);

    await playEveryRound(player, created.body.id);

    const played = await getDetail(created.body.id, player);
    return played.rounds.map((round) => round.assetId as string);
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

  describe('GET /games/solo/stats', () => {
    // Zeroes rather than nulls, and the whole object rather than field-by-field: the stats panel
    // renders the same shape on day one as on day one hundred, so a null - or a field quietly
    // dropped from the response - would give it a state it has no branch for.
    it('reports zeroes, never nulls, for a player who has never played', async () => {
      const { player } = await freshPlayer('solo-stats-empty', 0);

      const { status, body } = await readStats(player);

      expect(status).toBe(200);
      expect(body).toEqual({
        currentStreak: 0,
        bestStreak: 0,
        bestScore: 0,
        averageScore: 0,
        gamesPlayed: 0,
      });
    });

    // The deliberate asymmetry: history and the streak can legitimately disagree, because a daily
    // extends the streak only when EVERY round has a guess. Playing one round of five is a real
    // game with a real score - it counts as played and it is browsable - but it is not a day
    // defended, and a client that treated "it is in my history" as "my streak is safe" would tell
    // the player their streak was alive while it was already broken.
    it('counts a partially played daily as a game, but not as a day of the streak', async () => {
      const { player } = await freshPlayer('solo-stats-partial', 5);

      const daily = await readDaily(player);
      expect(daily.status).toBe(200);
      expect(daily.body.challenge).not.toBeNull();
      const challenge = daily.body.challenge;
      // Otherwise a single guess would FINISH the daily and this test would prove the opposite of
      // what it claims.
      expect(challenge.roundCount).toBeGreaterThan(1);

      const guess = await guessRound(player, challenge.id, 0);
      expect(guess.status).toBe(201);

      const stats = await readStats(player);
      expect(stats.status).toBe(200);
      expect(stats.body.currentStreak).toBe(0);
      expect(stats.body.bestStreak).toBe(0);
      expect(stats.body.gamesPlayed).toBe(1);

      const history = await readHistory(player);
      expect(history.status).toBe(200);
      const item = history.body.items.find((entry: { id: string }) => entry.id === challenge.id);
      expect(item, 'the partially played daily is missing from history').toBeDefined();
      expect(item.answered).toBe(1);
      expect(item.dailyOn).toBe(challenge.dailyOn);
    });
  });

  describe('GET /games/solo/history', () => {
    // A challenge that was generated and never touched is not a game the player remembers playing
    // - it is what the nightly prune deletes - so history is the games they actually played.
    it('leaves out a challenge the player never guessed on', async () => {
      const { player } = await freshPlayer('solo-history-unplayed', 3);

      const created = await createSolo(player, { roundCount: 3 });
      expect(created.status).toBe(201);

      const { status, body } = await readHistory(player);

      expect(status).toBe(200);
      expect(body).toEqual({ items: [], hasNextPage: false });
    });

    // A stale page number in a bookmark is a well-formed request with nothing behind it. The first
    // page is asserted non-empty first, so "empty" past the end cannot pass because history is
    // broken for this player entirely.
    it('returns an empty page past the end rather than an error', async () => {
      const { player } = await freshPlayer('solo-history-paging', 3);

      const created = await createSolo(player, { roundCount: 3 });
      expect(created.status).toBe(201);
      const guess = await guessRound(player, created.body.id, 0);
      expect(guess.status).toBe(201);

      const first = await readHistory(player, { page: 1, size: 20 });
      expect(first.status).toBe(200);
      expect(first.body.items.map((entry: { id: string }) => entry.id)).toEqual([created.body.id]);
      expect(first.body.hasNextPage).toBe(false);

      const past = await readHistory(player, { page: 99, size: 20 });

      expect(past.status).toBe(200);
      expect(past.body).toEqual({ items: [], hasNextPage: false });
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

  /**
   * The one walkthrough that runs a player all the way through their DAILY.
   *
   * `playing a solo challenge` above already covers create -> detail -> image -> guess for a
   * free-play challenge, but only the daily reaches the streak and the history row - which is
   * exactly what a first-time player sees after their first game, and the one path where the
   * challenge, the stats query and the history query all have to agree about the same day.
   */
  describe('a full solo playthrough', () => {
    let websocket: Socket;
    let player: LoginResponseDto;
    let assets: Array<{ id: string; filename: string }>;

    beforeAll(async () => {
      ({ player, assets } = await freshPlayer('solo-walkthrough', 4));
      websocket = await utils.connectWebsocket(player.accessToken);
      // Same reason as the free-play block: getRoundImage 404s until the async thumbnailGeneration
      // job has written a Preview file, and which photo lands on which round is hidden until it is
      // guessed - so every upload is waited on rather than one targeted id.
      await Promise.all(assets.map((asset) => utils.waitForWebsocketEvent({ event: 'assetUpload', id: asset.id })));
    });

    afterAll(() => {
      utils.disconnectWebsocket(websocket);
    });

    it('takes a player from their daily to a streak of 1 and a history row', async () => {
      const daily = await readDaily(player);
      expect(daily.status).toBe(200);
      // Asserted before anything is played: a null daily would make the streak and history checks
      // below fail for a setup reason dressed up as a product one.
      expect(daily.body.challenge, 'the daily was never generated, so nothing below proves anything').not.toBeNull();
      const challengeId = daily.body.challenge.id as string;
      const dailyOn = daily.body.challenge.dailyOn as string;

      const detail = await getDetail(challengeId, player);
      expect(detail.rounds).toHaveLength(daily.body.challenge.roundCount);
      expect(detail.rounds.length).toBeGreaterThan(0);

      let expectedTotal = 0;
      for (const round of detail.rounds) {
        // Fetched BEFORE the guess, while the round's assetId is still withheld from the detail
        // response - the point of the checks below is that the image itself does not hand the
        // player what the detail response is deliberately keeping back.
        const image = await request(app)
          .get(`/games/${challengeId}/rounds/${round.index}/image`)
          .set('Authorization', `Bearer ${player.accessToken}`);
        expect(image.status).toBe(200);
        expect(image.headers['content-type']).toMatch(/^image\//);
        expect(image.body.length).toBeGreaterThan(0);
        // A generic, index-keyed filename - never the photo's real one.
        expect(image.headers['content-disposition']).toContain(`round-${round.index}`);

        // EVERY header, not just content-disposition: an asset id or a real filename surfacing in
        // any of them - an ETag, a Location, a filename* - both spoils the round and hands the
        // player a pivot straight to /assets/:id.
        const headers = JSON.stringify(image.headers);
        for (const asset of assets) {
          expect(headers, 'the round image response disclosed its asset id').not.toContain(asset.id);
          expect(headers, "the round image response disclosed the photo's real filename").not.toContain(asset.filename);
        }

        const guess = await guessRound(player, challengeId, round.index);
        expect(guess.status).toBe(201);
        expect(guess.body.score).toEqual(expect.any(Number));
        expectedTotal += guess.body.score as number;
      }

      const stats = await readStats(player);
      expect(stats.status).toBe(200);
      // The whole object, not field by field: this is the panel's first-ever render, and a field
      // quietly dropped from the response would give it a state it has no branch for.
      expect(stats.body).toEqual({
        // One fully played daily is one day defended, and it is the first - so both streaks are 1.
        currentStreak: 1,
        bestStreak: 1,
        bestScore: expectedTotal,
        // One game, so the mean IS the total - and it is a whole number, because rounds score in
        // integers and soloStats rounds.
        averageScore: expectedTotal,
        gamesPlayed: 1,
      });

      const history = await readHistory(player);
      expect(history.status).toBe(200);
      const item = history.body.items.find((entry: { id: string }) => entry.id === challengeId);
      expect(item, 'the daily the player just finished is missing from their history').toBeDefined();
      // The same day string the challenge carries: history and the streak must name the same day,
      // or a player reading their history cannot tell which day their streak is standing on.
      expect(item.dailyOn).toBe(dailyOn);
      expect(item.answered).toBe(detail.rounds.length);
      expect(item.total).toBe(expectedTotal);
    });
  });

  describe('solo edge cases', () => {
    it('handles a library smaller than the 4,000-row sample', async () => {
      // Stage 1's LIMIT is an upper bound, not a target. A three-photo library must produce a
      // three-round challenge, not an empty one.
      const { player, assets } = await freshPlayer('solo-tiny-library', 3);

      const drawn = await drawnAssetIds(player, 3, { includePartners: false, includeSpaces: false });

      expect(drawn).toHaveLength(3);
      // The set, not just the count: three rounds over the same photo three times would satisfy a
      // length check and be a different bug.
      expect(sorted(drawn)).toEqual(sorted(assets.map((asset) => asset.id)));
    });

    it('lets the request body override the stored source preference for one game', async () => {
      // The preference drives the DAILY, which is generated lazily server-side. Free play may
      // override per game, and doing so must not mutate the preference - otherwise starting one
      // wide game silently rewrites every future daily.
      const { player, assets } = await freshPlayer('solo-sources-override', 1);
      const partner = await utils.userSetup(admin.accessToken, createUserDto.create('solo-sources-override-partner'));
      const theirs = await utils.createAsset(partner.accessToken, {
        assetData: { filename: 'solo-sources-override-partner.png' },
      });
      await utils.createPartner(partner.accessToken, player.userId);
      // partner.inTimeline defaults to FALSE, and the partner arm honours it - without this the
      // override below would draw nothing and the test would prove only that nothing happened.
      await updatePartner(
        { id: partner.userId, partnerUpdateDto: { inTimeline: true } },
        { headers: asBearerAuth(player.accessToken) },
      );

      await utils.updateMyPreferences(player.accessToken, {
        photoGuesser: { includePartners: false, includeSpaces: false },
      });

      const drawn = await drawnAssetIds(player, 2, { includePartners: true, includeSpaces: false });

      // The positive control: the override has to have actually widened THIS game, or "the
      // preference was not mutated" is true of an override that did nothing at all.
      expect(sorted(drawn), 'the per-request sources override did not widen the pool').toEqual(
        sorted([assets[0].id, theirs.id]),
      );

      const after = await getMyPreferences({ headers: asBearerAuth(player.accessToken) });
      expect(after.photoGuesser.includePartners, 'free play mutated the stored preference').toBe(false);
      expect(after.photoGuesser.includeSpaces, 'free play mutated the stored preference').toBe(false);
    });

    it('keeps a daily keyed to its own dailyOn when play crosses UTC midnight', async () => {
      // dailyOn is frozen at generation. A game started at 23:58 UTC and finished at 00:03 counts
      // for the day it was GENERATED for, not the day it was finished - otherwise the streak
      // silently skips a day for anyone who plays late.
      //
      // An e2e run cannot move the server's clock, so what this pins is the half that lives in the
      // database: the daily is keyed to the frozen `dailyOn` on its own row, a re-read resolves to
      // that same row rather than re-rolling, and a fully played daily is worth exactly one day of
      // streak. WHICH UTC day the clock names is pinned under fake timers in game.service.spec.ts,
      // and the streak's own midnight/month/year boundaries in game-streak.spec.ts.
      const { player } = await freshPlayer('solo-daily-midnight', 4);

      const daily = await readDaily(player);
      expect(daily.status).toBe(200);
      expect(daily.body.challenge, 'the daily was never generated, so nothing below proves anything').not.toBeNull();
      expect(daily.body.challenge.dailyOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);

      await playEveryRound(player, daily.body.challenge.id);

      const stats = await readStats(player);
      expect(stats.status).toBe(200);
      expect(stats.body.currentStreak).toBe(1);

      const again = await readDaily(player);
      expect(again.status).toBe(200);
      expect(again.body.challenge, 'the daily must not re-roll').not.toBeNull();
      expect(again.body.challenge.id, 'the daily must not re-roll').toBe(daily.body.challenge.id);
      expect(again.body.challenge.dailyOn, 'the daily was re-keyed to a different day').toBe(
        daily.body.challenge.dailyOn,
      );
    });

    it('removes a solo challenge, its rounds and its guesses when the owner is deleted', async () => {
      // ownerId is ON DELETE CASCADE, unlike createdById which is SET NULL so that deleting one
      // member cannot destroy a shared space's challenges.
      const { player: doomed } = await freshPlayer('solo-doomed', 3);
      const created = await createSolo(doomed, { roundCount: 3 });
      expect(created.status).toBe(201);
      const challengeId = created.body.id as string;
      await playEveryRound(doomed, challengeId);

      // Counted in the DATABASE, not through the API: the admin was never this challenge's owner,
      // so /games/:id 404s for them whether the row is gone or merely out of reach - which would
      // make an API-only version of this test pass against a cascade that never fired.
      const db = await utils.connectDatabase();
      const countRows = async () => {
        const challenges = await db.query('SELECT count(*)::int AS n FROM "game_challenge" WHERE "id" = $1', [
          challengeId,
        ]);
        const rounds = await db.query('SELECT count(*)::int AS n FROM "game_round" WHERE "challengeId" = $1', [
          challengeId,
        ]);
        // Joined back to the challenge's own rounds rather than counted by userId: game_guess
        // cascades from the USER too, so counting by userId would go to zero even if the
        // challenge's cascade had done nothing.
        const guesses = await db.query(
          'SELECT count(*)::int AS n FROM "game_guess" g JOIN "game_round" r ON r."id" = g."roundId" WHERE r."challengeId" = $1',
          [challengeId],
        );
        return {
          challenges: Number(challenges.rows[0].n),
          rounds: Number(rounds.rows[0].n),
          guesses: Number(guesses.rows[0].n),
        };
      };

      // Asserted before the deletion: three zeroes afterwards mean nothing unless there was
      // something there to cascade in the first place.
      expect(await countRows()).toEqual({ challenges: 1, rounds: 3, guesses: 3 });

      await deleteUserAdmin(
        { id: doomed.userId, userAdminDeleteDto: { force: true } },
        { headers: asBearerAuth(admin.accessToken) },
      );
      await createJob(
        { jobCreateDto: { name: ManualJobName.UserCleanup } },
        { headers: asBearerAuth(admin.accessToken) },
      );
      await utils.waitForQueueFinish(admin.accessToken, 'backgroundTask');

      expect(await countRows()).toEqual({ challenges: 0, rounds: 0, guesses: 0 });

      // Necessary but not sufficient on its own - the admin was never this challenge's owner, so
      // they would get a 404 either way. It is here because a 200 would be a real leak; the row
      // counts above are what actually distinguish "deleted" from "hidden".
      const { status } = await request(app)
        .get(`/games/${challengeId}`)
        .set('Authorization', `Bearer ${admin.accessToken}`);
      expect(status).toBe(404);
    });

    describe('a partner revoking sharing mid-game', () => {
      // Its own block because it is the only edge case that needs a round IMAGE, and the preview
      // file that needs is written by an async job for the PARTNER's upload - so the socket this
      // waits on has to be the partner's, not the player's.
      let websocket: Socket;
      let player: LoginResponseDto;
      let partner: LoginResponseDto;
      let theirAssetId: string;

      beforeAll(async () => {
        // The player owns NO photos of their own, so every round the pool can build is over the
        // partner's photo - which is what makes the revocation below reach the round under test.
        ({ player } = await freshPlayer('solo-partner-revoke', 0));
        partner = await utils.userSetup(admin.accessToken, createUserDto.create('solo-partner-revoke-partner'));
        websocket = await utils.connectWebsocket(partner.accessToken);

        const theirs = await utils.createAsset(partner.accessToken, {
          assetData: { filename: 'solo-partner-revoke-partner.png' },
        });
        theirAssetId = theirs.id;
        await utils.waitForWebsocketEvent({ event: 'assetUpload', id: theirs.id });

        await utils.createPartner(partner.accessToken, player.userId);
        await updatePartner(
          { id: partner.userId, partnerUpdateDto: { inTimeline: true } },
          { headers: asBearerAuth(player.accessToken) },
        );
      });

      afterAll(() => {
        utils.disconnectWebsocket(websocket);
      });

      it('keeps a round scoreable after the partner revokes sharing mid-game', async () => {
        // Frozen flags keep the challenge coherent, but the round IMAGE must re-resolve eligibility
        // live - the photo is genuinely no longer readable. Same contract the space game has for a
        // photo removed from a space: the round survives its photo.
        const created = await createSolo(player, {
          roundCount: 1,
          sources: { includePartners: true, includeSpaces: false },
        });
        expect(created.status).toBe(201);
        expect(created.body.roundCount, 'the partner arm drew nothing, so this case proves nothing').toBe(1);
        const challengeId = created.body.id as string;

        // The positive control, and it is load-bearing: getRoundImage 404s just as readily for a
        // preview file that was never written, so without a 200 here the 404 below would prove
        // nothing about eligibility at all.
        const before = await request(app)
          .get(`/games/${challengeId}/rounds/0/image`)
          .set('Authorization', `Bearer ${player.accessToken}`);
        expect(before.status).toBe(200);

        await removePartner({ id: player.userId }, { headers: asBearerAuth(partner.accessToken) });

        const image = await request(app)
          .get(`/games/${challengeId}/rounds/0/image`)
          .set('Authorization', `Bearer ${player.accessToken}`);
        expect(image.status).toBe(404);

        const guess = await request(app)
          .post(`/games/${challengeId}/rounds/0/guess`)
          .set('Authorization', `Bearer ${player.accessToken}`)
          .send({ date: new Date('2020-01-01').toISOString() });
        expect(guess.status, 'the round must stay scoreable from its frozen answer').toBe(201);

        // The round really was over the revoked photo. Without this the 404 above could be any
        // round of any photo, and the case would be about nothing in particular.
        const played = await getDetail(challengeId, player);
        expect(played.rounds.map((round) => round.assetId)).toEqual([theirAssetId]);
      });
    });
  });

  describe('challenge scopes never cross', () => {
    // The cross-scope 404 is covered on the web side in Task 13; it is asserted here too because
    // the routes are what actually enforce it.
    it('keeps a solo challenge out of a space list, and a space challenge out of solo history', async () => {
      const { player, assets } = await freshPlayer('solo-cross-scope', 4);
      const space = await utils.createSpace(player.accessToken, { name: 'solo-cross-scope' });
      await utils.addSpaceAssets(
        player.accessToken,
        space.id,
        assets.map((asset) => asset.id),
      );

      const spaceCreated = await request(app)
        .post(`/shared-spaces/${space.id}/games`)
        .set('Authorization', `Bearer ${player.accessToken}`)
        .send({ roundCount: 2 });
      expect(spaceCreated.status).toBe(201);
      const spaceChallengeId = spaceCreated.body.id as string;

      const soloCreated = await createSolo(player, { roundCount: 2 });
      expect(soloCreated.status).toBe(201);
      const soloChallengeId = soloCreated.body.id as string;

      // BOTH are played out. Solo history leaves out a challenge nobody has guessed on, so an
      // unplayed space challenge would be absent for a reason that has nothing to do with scope -
      // and this test would stay green against a history query that had lost its ownerId filter.
      await playEveryRound(player, spaceChallengeId);
      await playEveryRound(player, soloChallengeId);

      const spaceList = await request(app)
        .get(`/shared-spaces/${space.id}/games`)
        .set('Authorization', `Bearer ${player.accessToken}`);
      expect(spaceList.status).toBe(200);
      const spaceIds = spaceList.body.map((challenge: { id: string }) => challenge.id);
      expect(spaceIds, "the space's own challenge is missing, so the exclusion below proves nothing").toContain(
        spaceChallengeId,
      );
      // A solo challenge is not a space challenge, whatever the URL claims.
      expect(spaceIds, 'a solo challenge leaked into a space list').not.toContain(soloChallengeId);

      const history = await readHistory(player);
      expect(history.status).toBe(200);
      const historyIds = history.body.items.map((item: { id: string }) => item.id);
      expect(historyIds, 'the solo game the player just played is missing from history').toContain(soloChallengeId);
      expect(historyIds, 'a space challenge leaked into solo history').not.toContain(spaceChallengeId);
    });
  });
});
