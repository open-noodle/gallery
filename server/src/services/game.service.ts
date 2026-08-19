import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Insertable } from 'kysely';
import { PostgresError } from 'postgres';
import { OnEvent } from 'src/decorators';
import { AuthDto } from 'src/dtos/auth.dto';
import {
  GameChallengeDetailResponseDto,
  GameChallengeListItemResponseDto,
  GameChallengeResponseDto,
  GameChallengeType,
  GameCreateDto,
  GameDailyResponseDto,
  GameGuessDto,
  GameGuessResponseDto,
  GameLeaderboardResponseDto,
  GameRoundDetailResponseDto,
  GameStandingsResponseDto,
} from 'src/dtos/game.dto';
import { CacheControl, SharedSpaceRole } from 'src/enum';
import { ArgOf } from 'src/repositories/event.repository';
import {
  GameChallengeRow,
  GameGuessRow,
  GameRoundRow,
  NOT_PLACE_PROMPT_EMBEDDING,
  PLACE_PROMPT_EMBEDDING,
  ScenePromptEmbeddings,
} from 'src/repositories/game.repository';
import { GameChallengeTable } from 'src/schema/tables/game-challenge.table';
import { GameGuessTable } from 'src/schema/tables/game-guess.table';
import { GameRoundTable, GameRoundType } from 'src/schema/tables/game-round.table';
import { BaseService } from 'src/services/base.service';
import { ChallengePool } from 'src/services/game/challenge-pool';
import { SpacePool } from 'src/services/game/space-pool';
import { asDateString } from 'src/utils/date';
import { getFilenameExtension, ImmichMediaResponse } from 'src/utils/file';
import {
  GameCandidate,
  haversineKm,
  LatLon,
  monthOffsetDays,
  mulberry32,
  poolScaleDays,
  poolScaleKm,
  scoreFromError,
  selectLocationRounds,
} from 'src/utils/game-scoring';
import { compareStandings } from 'src/utils/game-standings';
import { mimeTypes } from 'src/utils/mime-types';
import { isSmartSearchEnabled } from 'src/utils/misc';
import { hasSharedSpaceRole } from 'src/utils/shared-space-role';

/** Location rounds fill up to this fraction of the requested round count; the rest are date
 * rounds. See design doc §7.4 - this is what keeps a GPS-poor space playable. */
const LOCATION_ROUND_SHARE = 0.6;

/**
 * The share of location rounds for each requested challenge type.
 *
 * 'mixed' keeps the historical 0.6 and its cross-pool fallback: a shortfall in one pool is made up
 * from the other, because the player asked for "whatever you have". 'location' and 'date' are
 * explicit requests, so they get 1 and 0 and NO fallback - see buildRounds, where honouring an
 * explicit request means returning fewer rounds (or refusing) rather than quietly handing back the
 * other kind, which would make the type picker look inert.
 */
const LOCATION_SHARE_BY_TYPE: Record<GameChallengeType, number> = {
  mixed: LOCATION_ROUND_SHARE,
  location: 1,
  date: 0,
};

/** The daily is always this size; it is the same game for everyone, so it takes no parameters. */
const DAILY_ROUND_COUNT = 5;

/** Postgres constraint behind the lazy daily generation race - see the migration. */
const DAILY_UNIQUE_CONSTRAINT = 'game_challenge_daily_uq';

/**
 * Today's date as the UTC calendar day, `YYYY-MM-DD`.
 *
 * UTC rather than the caller's local day, and this is the whole point of the choice: members of one
 * space can be in different timezones, and a per-viewer day would give them different "today"s -
 * two people comparing scores on the same leaderboard while playing different challenges.
 */
const utcDateKey = (now: Date): string => now.toISOString().slice(0, 10);

/**
 * The current UTC calendar month as `{ key: 'YYYY-MM', start: 'YYYY-MM-DD', endExclusive:
 * 'YYYY-MM-DD' }`.
 *
 * UTC for the same reason `utcDateKey` is: one space's members can sit in different timezones, and
 * a per-viewer month would give them different boards. `Date.UTC` with a month index of 12 rolls
 * into January of the next year on its own, so December needs no special case.
 */
const utcMonthBounds = (now: Date) => {
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth();
  const asDay = (date: number) => new Date(date).toISOString().slice(0, 10);
  return {
    key: now.toISOString().slice(0, 7),
    start: asDay(Date.UTC(year, month, 1)),
    endExclusive: asDay(Date.UTC(year, month + 1, 1)),
  };
};

/**
 * Candidates fetched per pool per generation - and, for the location pool, **the scene gate's
 * cutoff among the sampled rows**: `getLocationCandidates` ranks the rows stage 1 sampled by the
 * CLIP place-minus-not-place score and truncates exactly here.
 *
 * It is no longer the whole boundary between "ranked into the pool" and "excluded by the gate
 * entirely" - a row can now also be excluded for never having been in the LOCATION_SAMPLE_SIZE
 * (4,000-row) sample stage 1 draws before this limit ever gets a look at it (see
 * game.repository.ts). Read the two constants together: raising this one past
 * LOCATION_SAMPLE_SIZE silently stops doing anything, because stage 1 can never hand stage 2 more
 * rows than it sampled.
 *
 * It is NOT a variety knob, despite reading like one - that framing is what hid the fact that
 * the gate had no teeth at all while `selectLocationRounds` sampled the pool uniformly. What
 * actually enforces design §2's "a scene gate is mandatory" is the rank-biased draw inside
 * `selectLocationRounds` (see RANK_BIAS_EXPONENT); this constant only decides how much of the
 * ranked tail that draw can still reach. Moving it changes both, so read §7.1 first.
 */
const CANDIDATE_POOL_LIMIT = 200;

/** How many of the space's most recent challenges to avoid repeating assets from. */
const RECENT_CHALLENGE_LOOKBACK = 3;

/**
 * The scene-gate prompts, and the CLIP model the shipped constant vectors were encoded with.
 * Design §12 flags the wording itself as tunable; the model name is not - it is the contract
 * that makes PLACE_PROMPT_EMBEDDING / NOT_PLACE_PROMPT_EMBEDDING meaningful.
 */
const PLACE_PROMPT = 'an outdoor photo that shows where it was taken';
const NOT_PLACE_PROMPT = 'a close-up of a person or an indoor room';
const SHIPPED_PROMPT_MODEL = 'ViT-B-32__openai';

type TypedRoundCandidate = GameCandidate & { type: GameRoundType };

/** Small, stable string hash (djb2-ish) - not for security, only to turn a (spaceId, challenge
 * count) pair into a deterministic mulberry32 seed. */
const hashSeed = (value: string): number => {
  let hash = 0;
  for (let i = 0; i < value.length; i++) {
    // Wraps to a 32-bit signed int, which Math.trunc does not do; mirrors the identical pattern
    // in game-scoring.ts's mulberry32.
    // eslint-disable-next-line unicorn/prefer-math-trunc
    hash = (Math.imul(hash, 31) + (value.codePointAt(i) ?? 0)) | 0;
  }
  return hash;
};

/** Deterministic Fisher-Yates shuffle driven by the challenge's own seeded random - never
 * Math.random, so the same pool + seed always produces the same challenge. */
const shuffle = <T>(items: T[], random: () => number): T[] => {
  const shuffled = [...items];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    const temp = shuffled[i];
    shuffled[i] = shuffled[j];
    shuffled[j] = temp;
  }
  return shuffled;
};

const toPoints = (pool: GameCandidate[]): LatLon[] =>
  pool.flatMap((candidate) =>
    candidate.lat === null || candidate.lon === null ? [] : [{ lat: candidate.lat, lon: candidate.lon }],
  );

@Injectable()
export class GameService extends BaseService {
  /** Prompt vectors encoded at runtime, keyed by CLIP model name. The shipped constants are not
   * stored here - they are returned directly for SHIPPED_PROMPT_MODEL. */
  private scenePromptCache = new Map<string, ScenePromptEmbeddings>();
  /** Models we have already complained about, so a warn-level line is logged once, not per
   * challenge creation. */
  private scenePromptWarnings = new Set<string>();

  /**
   * The CLIP vectors the scene gate ranks against, for the CURRENTLY configured model.
   *
   * `machineLearning.clip.modelName` is admin-configurable and `DatabaseRepository.setDimensionSize`
   * re-types `smart_search.embedding` to match, so a hardcoded pair of 512-dim ViT-B-32 vectors is
   * wrong in two different ways once an admin changes the model: against a 768-dim model
   * (ViT-L-14) every challenge creation 500s with `different vector dimensions`, and against a
   * *different* 512-dim model there is no error at all - the dot product simply runs in an
   * unrelated embedding space and the gate becomes noise, which is the silent-failure class this
   * feature has already produced three times.
   *
   * So: shipped constants when the configured model is the one they were encoded with (design
   * §7.1's "one dot product per candidate and no new inference" holds for the default install),
   * and otherwise encode the same two prompts against the configured model, cached per model and
   * cleared when the model changes - the precedent set by
   * `ClassificationService.getOrEncodePrompt`. If ML is off or unreachable we return undefined,
   * which drops the ordering rather than ranking against a meaningless vector; the face gate and
   * the spread rules still apply, so a challenge is still generated.
   */
  private async getScenePromptEmbeddings(): Promise<ScenePromptEmbeddings | undefined> {
    const { machineLearning } = await this.getConfig({ withCache: true });
    const modelName = machineLearning.clip.modelName;

    if (modelName === SHIPPED_PROMPT_MODEL) {
      return { place: PLACE_PROMPT_EMBEDDING, notPlace: NOT_PLACE_PROMPT_EMBEDDING };
    }

    const cached = this.scenePromptCache.get(modelName);
    if (cached) {
      return cached;
    }

    if (!isSmartSearchEnabled(machineLearning)) {
      this.warnSceneGateDisabled(
        modelName,
        `smart search is disabled, so the prompts cannot be encoded against '${modelName}'`,
      );
      return undefined;
    }

    try {
      const [place, notPlace] = await Promise.all([
        this.encodeScenePrompt(PLACE_PROMPT, modelName),
        this.encodeScenePrompt(NOT_PLACE_PROMPT, modelName),
      ]);
      const embeddings = { place, notPlace };
      this.scenePromptCache.set(modelName, embeddings);
      return embeddings;
    } catch (error) {
      this.warnSceneGateDisabled(modelName, `encoding them against '${modelName}' failed: ${error}`);
      return undefined;
    }
  }

  private async encodeScenePrompt(prompt: string, modelName: string): Promise<number[]> {
    const raw = await this.machineLearningRepository.encodeText(prompt, { modelName });
    // encodeText hands back the ML service's serialized vector (`[0.1,0.2,...]`); the same
    // parse ClassificationService does before its own dot products.
    return typeof raw === 'string' ? raw.replaceAll(/[[\]]/g, '').split(',').map(Number) : (raw as number[]);
  }

  private warnSceneGateDisabled(modelName: string, reason: string) {
    if (this.scenePromptWarnings.has(modelName)) {
      return;
    }
    this.scenePromptWarnings.add(modelName);
    this.logger.warn(
      `Game scene gate disabled: ${reason}. Location rounds will still be face-gated and spread, but will not be ranked by how much they look like a place.`,
    );
  }

  // The cache is already keyed by model name, so this is not load-bearing for correctness - it
  // keeps a stale model's vectors from lingering, and mirrors ClassificationService.onConfigUpdate.
  @OnEvent({ name: 'ConfigUpdate', server: true })
  onConfigUpdate({ oldConfig, newConfig }: ArgOf<'ConfigUpdate'>) {
    if (oldConfig.machineLearning.clip.modelName === newConfig.machineLearning.clip.modelName) {
      return;
    }
    this.scenePromptCache.clear();
    this.scenePromptWarnings.clear();
  }

  async create(auth: AuthDto, spaceId: string, dto: GameCreateDto): Promise<GameChallengeResponseDto> {
    await this.requireEditor(spaceId, auth.user.id);

    const pool = new SpacePool(this.gameRepository, spaceId);
    // Resolved BEFORE the candidate queries, not alongside them: the challenge count is half of
    // the generation seed, and the seed now drives which slice of a large space the candidate
    // queries return (see GameRepository.seededOrder), not just which of them get picked.
    const challengeCount = await pool.challengeCount();

    return this.generateChallenge({
      pool,
      scope: { spaceId, ownerId: null },
      createdById: auth.user.id,
      // GameCreateDto.roundCount has a zod .default(5), but chaining .optional() after .default()
      // (the codebase's own convention, e.g. SharedSpaceMemberCreateDto.role) keeps the inferred TS
      // type `number | undefined` - the fallback still has to be applied here, same as dto.role ??
      // SharedSpaceRole.Viewer in shared-space.service.ts.
      requestedRoundCount: dto.roundCount ?? 5,
      type: dto.type ?? 'mixed',
      seed: `${await pool.seedKey()}:${challengeCount}`,
      dailyOn: null,
      name: dto.name?.trim() || `Challenge ${challengeCount + 1}`,
    });
  }

  /**
   * Builds and stores one challenge. Shared by the player-created path and the daily, which differ
   * only in their seed, their author and whether `dailyOn` is set - the generation itself is
   * identical, and keeping it in one place is what guarantees the daily is a real challenge rather
   * than a second, subtly different generator.
   */
  private async generateChallenge({
    pool,
    scope,
    createdById,
    requestedRoundCount,
    type,
    seed,
    dailyOn,
    name,
  }: {
    pool: ChallengePool;
    // The row's scope columns. A pool only queries within its scope, it does not know how to
    // write it - `create`/`generateDaily` are the ones that know whether this challenge belongs
    // to a space or (a later task) a user, so they build this alongside the pool.
    scope: { spaceId: string | null; ownerId: string | null };
    createdById: string | null;
    requestedRoundCount: number;
    type: GameChallengeType;
    seed: string;
    dailyOn: string | null;
    name: string;
  }): Promise<GameChallengeResponseDto> {
    const scenePrompts = await this.getScenePromptEmbeddings();

    const [rawLocationPool, rawDatePool, recentlyUsedAssetIds] = await Promise.all([
      pool.locationCandidates(CANDIDATE_POOL_LIMIT, seed, scenePrompts),
      pool.dateCandidates(CANDIDATE_POOL_LIMIT, seed),
      pool.recentlyUsedAssetIds(RECENT_CHALLENGE_LOOKBACK),
    ]);

    // Prefer excluding assets used by recent challenges in this space, but never at the cost of
    // being unable to fill the request. The decision is made per pool, and for the date pool
    // against the round count the location pool actually delivered - a well-stocked pool keeps
    // its exclusion even when the other pool has to give it up to reach requestedRoundCount, and a
    // location shortfall doesn't wrongly count against the date pool's own supply.
    const recentlyUsed = new Set(recentlyUsedAssetIds);
    const withoutRecent = (pool: GameCandidate[]) => pool.filter((candidate) => !recentlyUsed.has(candidate.assetId));

    // Seeded from the space and its existing challenge count, not wall-clock or Math.random, so
    // generation is reproducible and successive challenges for the same space still differ.
    const random = mulberry32(hashSeed(seed));

    // Still floored, which is exact for the explicit types (a share of 1 or 0 cannot have a
    // fractional part) and leaves 'mixed' rounding exactly as it always did.
    const locationShare = Math.floor(requestedRoundCount * LOCATION_SHARE_BY_TYPE[type]);
    const filteredLocationPool = withoutRecent(rawLocationPool);
    const locationNeeded = Math.min(locationShare, rawLocationPool.length);
    const locationPool = filteredLocationPool.length >= locationNeeded ? filteredLocationPool : rawLocationPool;

    // Frozen here, once, from the location pool actually used to generate this challenge. Scoring
    // divides by this later - recomputing it as the space gains photos would rewrite every score
    // already recorded against this challenge.
    const scaleKm = poolScaleKm(toPoints(locationPool), random);

    const locationTarget = Math.min(locationShare, locationPool.length);
    const locationRounds = selectLocationRounds(locationPool, locationTarget, scaleKm, random);

    const usedAssetIds = new Set(locationRounds.map((candidate) => candidate.assetId));
    // Only 'mixed' lets the date pool cover a location shortfall. For an explicit 'location'
    // request the remainder must stay 0, or a GPS-poor space would answer a location game with
    // date rounds and look like the type picker did nothing.
    const dateRemaining = type === 'location' ? 0 : requestedRoundCount - locationRounds.length;

    const filteredDatePool = withoutRecent(rawDatePool);
    const availableExcludingUsed = (pool: GameCandidate[]) =>
      pool.filter((candidate) => !usedAssetIds.has(candidate.assetId)).length;
    const dateNeeded = Math.min(dateRemaining, availableExcludingUsed(rawDatePool));
    const datePool = availableExcludingUsed(filteredDatePool) >= dateNeeded ? filteredDatePool : rawDatePool;

    // Frozen here too, once, from the date pool actually used - same reasoning as scaleKm above.
    const scaleDays = poolScaleDays(
      datePool.map((candidate) => candidate.takenAt),
      random,
    );

    const dateRounds: GameCandidate[] = [];
    for (const candidate of shuffle(datePool, random)) {
      if (dateRounds.length >= dateRemaining) {
        break;
      }
      if (usedAssetIds.has(candidate.assetId)) {
        continue;
      }
      usedAssetIds.add(candidate.assetId);
      dateRounds.push(candidate);
    }

    const typedRounds: TypedRoundCandidate[] = shuffle(
      [
        ...locationRounds.map((candidate): TypedRoundCandidate => ({ ...candidate, type: 'location' })),
        ...dateRounds.map((candidate): TypedRoundCandidate => ({ ...candidate, type: 'date' })),
      ],
      random,
    );

    if (typedRounds.length === 0) {
      // Named by requested type, because the fix differs: a location game needs GPS data
      // specifically, and telling someone to "add photos with capture dates" when they asked for a
      // location game sends them after the wrong thing.
      throw new BadRequestException(pool.noRoundsMessage(type));
    }

    const challenge: Insertable<GameChallengeTable> = {
      ...scope,
      createdById,
      dailyOn,
      name,
      // The actual number of rounds built, not the number requested - a thin pool creates a
      // shorter challenge rather than failing outright.
      roundCount: typedRounds.length,
      scaleKm,
      scaleDays,
    };

    const roundInserts: Insertable<GameRoundTable>[] = typedRounds.map((round, index) => ({
      // Overwritten by GameRepository.createChallenge with the id it just inserted - the caller
      // cannot know that id ahead of time.
      challengeId: '',
      index,
      type: round.type,
      assetId: round.assetId,
      answerLat: round.type === 'location' ? round.lat : null,
      answerLon: round.type === 'location' ? round.lon : null,
      answerDate: round.type === 'date' ? round.takenAt : null,
    }));

    const id = await this.gameRepository.createChallenge(challenge, roundInserts);

    return {
      id,
      // `scope`, not `challenge.spaceId`/`challenge.ownerId`: Insertable<GameChallengeTable> types
      // nullable columns as `T | null | undefined` (undefined = "let the DB default apply"), but
      // `scope` is the exact `string | null` this DTO field wants, and it's what we actually wrote.
      ...scope,
      name: challenge.name,
      roundCount: challenge.roundCount,
      scaleKm: challenge.scaleKm,
      scaleDays: challenge.scaleDays,
      createdAt: new Date(),
      dailyOn,
    };
  }

  /**
   * All of a space's challenges, each annotated with the caller's own progress (rounds answered
   * and total score so far) - never another member's. Membership only, like `get`/`guess` - a
   * viewer can see and play every challenge in the space. One `getGuessesForUser` call per
   * challenge rather than a new aggregate query: the design doc's own numbers put a space at
   * ~19 challenges in the reference library, so this stays cheap without adding a new
   * @GenerateSql-decorated repository method for what is otherwise a thin composition of two
   * calls the service already makes elsewhere (`get`, `leaderboard`).
   */
  async list(auth: AuthDto, spaceId: string): Promise<GameChallengeListItemResponseDto[]> {
    await this.requireMember(spaceId, auth.user.id);

    // getChallengesForSpace excludes dailies in the query - see its own comment for why that is not
    // a filter here.
    const challenges = await this.gameRepository.getChallengesForSpace(spaceId);
    const [guessesByChallenge, locationCounts] = await Promise.all([
      Promise.all(challenges.map((challenge) => this.gameRepository.getGuessesForUser(challenge.id, auth.user.id))),
      this.gameRepository.getLocationRoundCounts(spaceId),
    ]);
    const locationCountById = new Map(locationCounts.map((row) => [row.challengeId, row.locationCount]));

    return challenges.map((challenge, i) => {
      const guesses = guessesByChallenge[i];
      return {
        ...this.toListItem(challenge, guesses, locationCountById.get(challenge.id) ?? 0),
      };
    });
  }

  /** The list shape: a challenge plus the CALLER's progress. Never another member's. */
  private toListItem(
    challenge: GameChallengeRow,
    guesses: { score: number }[],
    locationRoundCount: number,
  ): GameChallengeListItemResponseDto {
    return {
      id: challenge.id,
      spaceId: this.requireSpaceScope(challenge),
      // requireSpaceScope above already guarantees this is a space row, so ownerId is always
      // null here - read from the column rather than hardcoded, so the DTO stays a faithful
      // mirror of the row instead of a second place that has to know that fact.
      ownerId: challenge.ownerId,
      name: challenge.name,
      roundCount: challenge.roundCount,
      scaleKm: challenge.scaleKm,
      scaleDays: challenge.scaleDays,
      createdAt: challenge.createdAt,
      closedAt: challenge.closedAt,
      dailyOn: asDateString(challenge.dailyOn),
      locationRoundCount,
      answered: guesses.length,
      total: guesses.reduce((sum, guess) => sum + guess.score, 0),
    };
  }

  /**
   * The space's daily challenge for today, generated on first read.
   *
   * Generation is lazy rather than scheduled: there is nothing to run for a space nobody opens, a
   * missed day heals itself, and the seed makes every member's "first" generation identical anyway.
   * Membership - not the editor role - is the gate, because the daily belongs to the space and
   * whoever happens to open the page first should not need permission to see it.
   */
  async getDaily(auth: AuthDto, spaceId: string): Promise<GameDailyResponseDto> {
    await this.requireMember(spaceId, auth.user.id);

    // The daily is opt-in per space, and this guard sits AHEAD of the lookup because the lookup is
    // what generates it. `?.` and `!== true` in one expression cover all three of: nobody asked yet,
    // an editor declined, and the space was deleted between the membership check and here.
    const space = await this.sharedSpaceRepository.getById(spaceId);
    if (space?.dailyChallengeEnabled !== true) {
      return { challenge: null };
    }

    const dailyOn = utcDateKey(new Date());
    const existing = await this.gameRepository.getDailyChallenge(spaceId, dailyOn);
    const challenge = existing ?? (await this.generateDaily(spaceId, dailyOn));

    if (!challenge) {
      return { challenge: null };
    }

    const [guesses, rounds] = await Promise.all([
      this.gameRepository.getGuessesForUser(challenge.id, auth.user.id),
      this.gameRepository.getRounds(challenge.id),
    ]);

    return {
      challenge: this.toListItem(challenge, guesses, rounds.filter((round) => round.type === 'location').length),
    };
  }

  /**
   * Generates today's daily, or returns undefined when the space has nothing playable.
   *
   * Two things are deliberate. A space with no usable photos yields `undefined` rather than the
   * 400 `generateChallenge` throws: "no daily today" is an ordinary state of the page, not a failed
   * request. And a lost race - two members generating at once, the partial unique index rejecting
   * the second - is resolved by re-reading the winner, so both players get the SAME challenge
   * instead of one of them seeing a 500.
   */
  private async generateDaily(spaceId: string, dailyOn: string): Promise<GameChallengeRow | undefined> {
    const pool = new SpacePool(this.gameRepository, spaceId);
    try {
      await this.generateChallenge({
        pool,
        scope: { spaceId, ownerId: null },
        // No human author: the daily is the space's, not the first reader's.
        createdById: null,
        requestedRoundCount: DAILY_ROUND_COUNT,
        type: 'mixed',
        // Keyed to the date, so every member generating "first" builds an identical challenge.
        seed: `${await pool.seedKey()}:daily:${dailyOn}`,
        dailyOn,
        name: dailyOn,
      });
    } catch (error) {
      if ((error as PostgresError)?.constraint_name === DAILY_UNIQUE_CONSTRAINT) {
        return this.gameRepository.getDailyChallenge(spaceId, dailyOn);
      }
      if (error instanceof BadRequestException) {
        return undefined;
      }
      throw error;
    }

    return this.gameRepository.getDailyChallenge(spaceId, dailyOn);
  }

  /**
   * The withheld-answer view of a challenge: `answer`, `score` and `assetId` are present only
   * for rounds the caller has already submitted a guess for. This is the security property of
   * the endpoint, so it lives here in the service rather than being trusted to the client.
   */
  async get(auth: AuthDto, challengeId: string): Promise<GameChallengeDetailResponseDto> {
    const challenge = await this.loadChallenge(challengeId);
    const spaceId = this.requireSpaceScope(challenge);
    await this.requireMember(spaceId, auth.user.id);

    const [rounds, guesses] = await Promise.all([
      this.gameRepository.getRounds(challengeId),
      this.gameRepository.getGuessesForUser(challengeId, auth.user.id),
    ]);

    const guessByRoundId = new Map(guesses.map((guess) => [guess.roundId, guess]));

    return {
      id: challenge.id,
      spaceId,
      // requireSpaceScope above already guarantees this is a space row, so ownerId is always
      // null here - read from the column rather than hardcoded, same as toListItem.
      ownerId: challenge.ownerId,
      name: challenge.name,
      dailyOn: asDateString(challenge.dailyOn),
      roundCount: challenge.roundCount,
      scaleKm: challenge.scaleKm,
      scaleDays: challenge.scaleDays,
      createdAt: challenge.createdAt,
      closedAt: challenge.closedAt,
      rounds: rounds.map((round) => this.toRoundDetail(round, guessByRoundId.get(round.id))),
    };
  }

  /**
   * Submits one round's guess. Membership only (any role) - unlike `create`/`delete`, playing a
   * challenge is not an editor-only action. The score is computed here, once, from the
   * challenge's frozen `scaleKm`/`scaleDays`, then persisted; it is never recomputed on read.
   */
  async guess(auth: AuthDto, challengeId: string, index: number, dto: GameGuessDto): Promise<GameGuessResponseDto> {
    const challenge = await this.loadChallenge(challengeId);
    await this.requireMember(this.requireSpaceScope(challenge), auth.user.id);

    const round = await this.gameRepository.getRound(challengeId, index);
    if (!round) {
      throw new NotFoundException('Round not found');
    }

    const insert = this.buildGuessInsert(challenge, round, auth.user.id, dto);

    try {
      const guess = await this.gameRepository.createGuess(insert);
      return {
        roundId: guess.roundId,
        userId: guess.userId,
        guessLat: guess.guessLat,
        guessLon: guess.guessLon,
        guessDate: guess.guessDate,
        distanceKm: guess.distanceKm,
        offsetDays: guess.offsetDays,
        score: guess.score,
      };
    } catch (error) {
      // The UNIQUE (roundId, userId) constraint is the source of truth for "already guessed" -
      // deliberately not pre-checked with a SELECT, which would race two concurrent submits.
      // postgres.js surfaces the violated constraint as `constraint_name` (see the identical
      // pattern in shared-link.service.ts / face-repair-scan.repository.ts).
      if ((error as PostgresError)?.constraint_name === 'game_guess_round_user_uq') {
        throw new ConflictException('Already guessed');
      }
      throw error;
    }
  }

  /**
   * The only path by which a round's photo ever reaches a client. Keyed by `(challengeId,
   * index)` - the asset id never appears in the request, so a client cannot pivot from a round
   * straight to `/api/assets/:id`. Serves the asset's existing **preview** derivative (already
   * re-encoded, EXIF-stripped by the thumbnail generator) under a generic `round-<index>`
   * filename; the original file and the real filename are never touched here. Membership only
   * (any role), like `get`/`guess`/`leaderboard` - a viewer can view every round's image.
   */
  async getRoundImage(auth: AuthDto, challengeId: string, index: number): Promise<ImmichMediaResponse> {
    const challenge = await this.loadChallenge(challengeId);
    const spaceId = this.requireSpaceScope(challenge);
    await this.requireMember(spaceId, auth.user.id);

    const round = await this.gameRepository.getRound(challengeId, index);
    if (!round) {
      throw new BadRequestException('Round not found');
    }

    // The asset backing this round was deleted after the challenge was created - fail cleanly
    // rather than querying the repository with a null id.
    if (!round.assetId) {
      throw new NotFoundException('Round image not available');
    }

    // Space-scoped, and re-checked on EVERY request - deliberately not AssetRepository.getById,
    // which applies no deletedAt, no visibility and no space predicate. Rounds are frozen by
    // design (§4.1) so this assetId is permanent; resolving it unscoped meant that once a photo
    // entered a challenge, removing it from the space, trashing it, or moving it to the locked
    // folder did not stop the game serving it to every member, forever. resolveRoundAsset
    // re-applies the exact predicate the candidate queries used, so eligibility to be served
    // and eligibility to be picked cannot diverge.
    //
    // A miss is a normal outcome, not corruption: the round remains scoreable from its
    // denormalised answer (§9), so this 404s the image and leaves the challenge intact.
    const pool = new SpacePool(this.gameRepository, spaceId);
    const previewFile = await pool.resolveRoundAsset(round.assetId);
    if (!previewFile) {
      throw new NotFoundException('Round image not available');
    }

    // Routed through serveFromBackend - not a bare `new ImmichFileResponse` - so this resolves
    // correctly on both disk and S3-backed instances, exactly like AssetMediaService.viewThumbnail
    // does for the identical preview-file case (constructing ImmichFileResponse directly only
    // works for disk paths; serveFromBackend picks disk vs S3 and returns a redirect/stream there
    // instead). The filename stays generic (`round-<index>`, never the asset's real filename).
    //
    // Known gap: under IMMICH_S3_SERVE_MODE=redirect, the presigned URL this returns has the
    // asset id in its path (preview files are keyed `<assetId>_preview.jpeg`, see
    // StorageCore.getImagePath), so a player can read a round's answer off the Location header
    // instead of guessing. This is cheating, not disclosure - they're already a space member and
    // could view the photo directly anyway, just not for free. Proxy mode (the reference
    // deployment) streams the bytes server-side and is unaffected. Closing the redirect-mode gap
    // needs a force-proxy option on serveFromBackend or route-specific streaming - a deliberate
    // follow-up, not an oversight.
    return this.serveFromBackend(
      previewFile.previewPath,
      mimeTypes.lookup(previewFile.previewPath),
      // Private, not public: this is membership-gated content pulled from a private shared space,
      // so a shared/CDN cache must never serve it across sessions or to a non-member. Long
      // browser-side caching is still safe within that: once a challenge is created its rounds are
      // frozen (assetId per round never changes), so the same (challengeId, index) always resolves
      // to the same bytes. Matches AssetMediaService.viewThumbnail's own choice for the same reason.
      //
      // Note the eligibility re-check above governs the SERVER; a member who already loaded a
      // round keeps it in their own private browser cache for up to the max-age after the photo
      // leaves the space. That is one user re-seeing a photo they were already shown, exactly as
      // for any other thumbnail in the app - not a path by which a new viewer can reach it.
      CacheControl.PrivateWithCache,
      `round-${index}${getFilenameExtension(previewFile.previewPath)}`,
    );
  }

  /**
   * Today's-challenge board: one entry per CURRENT member, zero-filled.
   *
   * Members who have not played are included rather than omitted, so this board and the monthly
   * standings show the same people - a member who is absent from one tab and present on the other
   * reads as a bug. Rows belonging to someone who has left the space are dropped; they used to
   * render under a hardcoded English 'Unknown'.
   */
  async leaderboard(auth: AuthDto, challengeId: string): Promise<GameLeaderboardResponseDto> {
    const challenge = await this.loadChallenge(challengeId);
    const spaceId = this.requireSpaceScope(challenge);
    await this.requireMember(spaceId, auth.user.id);

    const [rows, members] = await Promise.all([
      this.gameRepository.getLeaderboard(challengeId),
      this.sharedSpaceRepository.getMembers(spaceId),
    ]);

    const rowByUserId = new Map(rows.map((row) => [row.userId, row]));

    const entries = members
      .map((member) => ({
        userId: member.userId,
        name: member.name,
        total: rowByUserId.get(member.userId)?.total ?? 0,
        answered: rowByUserId.get(member.userId)?.answered ?? 0,
      }))
      .sort((a, b) => compareStandings({ ...a, played: a.answered }, { ...b, played: b.answered }));

    return { entries };
  }

  /**
   * The space's monthly standings: total points across THIS UTC calendar month's dailies.
   *
   * Dailies only, because they are the only level field - every member gets the identical
   * challenge, one attempt each - while custom challenges are created on demand by editors and
   * scored on a per-challenge frozen scale. See the design doc for the whole argument.
   *
   * Zero-filled from the member list so the board shows the space, not just the people who have
   * played, and so an aggregate row belonging to someone who has since left the space is dropped
   * rather than rendered under a placeholder name.
   */
  async standings(auth: AuthDto, spaceId: string): Promise<GameStandingsResponseDto> {
    await this.requireMember(spaceId, auth.user.id);

    const month = utcMonthBounds(new Date());
    const [rows, members] = await Promise.all([
      this.gameRepository.getMonthlyStandings(spaceId, month.start, month.endExclusive),
      this.sharedSpaceRepository.getMembers(spaceId),
    ]);

    const rowByUserId = new Map(rows.map((row) => [row.userId, row]));

    const entries = members
      .map((member) => ({
        userId: member.userId,
        name: member.name,
        total: rowByUserId.get(member.userId)?.total ?? 0,
        daysPlayed: rowByUserId.get(member.userId)?.daysPlayed ?? 0,
      }))
      .sort((a, b) => compareStandings({ ...a, played: a.daysPlayed }, { ...b, played: b.daysPlayed }));

    return { month: month.key, entries };
  }

  async delete(auth: AuthDto, challengeId: string): Promise<void> {
    const challenge = await this.loadChallenge(challengeId);
    await this.requireEditor(this.requireSpaceScope(challenge), auth.user.id);
    // The daily is shared state, not one member's row: deleting it would take away a game the rest
    // of the space may already have played today, and it would simply regenerate on the next read
    // anyway - with a different id, orphaning the leaderboard everyone was competing on.
    if (challenge.dailyOn !== null) {
      throw new BadRequestException('The daily challenge cannot be deleted');
    }
    await this.gameRepository.deleteChallenge(challengeId);
  }

  /**
   * A challenge's space, for the paths that resolve authorization through space membership.
   *
   * `spaceId` is nullable - a challenge belongs to a space OR to a user - and a challenge with no
   * space cannot be reached by a membership check at all. Missing rather than forbidden is the
   * deliberate wording: a 403 would confirm the id exists, which is an enumeration leak these
   * routes otherwise avoid.
   */
  private requireSpaceScope(challenge: GameChallengeRow): string {
    if (challenge.spaceId === null) {
      throw new NotFoundException('Challenge not found');
    }
    return challenge.spaceId;
  }

  private async loadChallenge(challengeId: string): Promise<GameChallengeRow> {
    const challenge = await this.gameRepository.getChallenge(challengeId);
    if (!challenge) {
      throw new NotFoundException('Challenge not found');
    }
    return challenge;
  }

  // The only place allowed to attach `answer`/`score`/`assetId` to a round - and only once a
  // `game_guess` row for this caller proves they already played it.
  private toRoundDetail(round: GameRoundRow, guess: GameGuessRow | undefined): GameRoundDetailResponseDto {
    if (!guess) {
      return { index: round.index, type: round.type };
    }
    return {
      index: round.index,
      type: round.type,
      assetId: round.assetId ?? undefined,
      score: guess.score,
      answer: { lat: round.answerLat, lon: round.answerLon, date: round.answerDate },
    };
  }

  private buildGuessInsert(
    challenge: GameChallengeRow,
    round: GameRoundRow,
    userId: string,
    dto: GameGuessDto,
  ): Insertable<GameGuessTable> {
    if (round.type === 'location') {
      if (typeof dto.lat !== 'number' || typeof dto.lon !== 'number') {
        throw new BadRequestException('This round expects a location guess');
      }
      if (round.answerLat === null || round.answerLon === null) {
        throw new BadRequestException('This round has no location answer');
      }

      const distanceKm = haversineKm({ lat: dto.lat, lon: dto.lon }, { lat: round.answerLat, lon: round.answerLon });
      return {
        roundId: round.id,
        userId,
        guessLat: dto.lat,
        guessLon: dto.lon,
        guessDate: null,
        distanceKm,
        offsetDays: null,
        score: scoreFromError(distanceKm, challenge.scaleKm),
      };
    }

    if (!dto.date) {
      throw new BadRequestException('This round expects a date guess');
    }
    if (!round.answerDate) {
      throw new BadRequestException('This round has no date answer');
    }

    // Already a Date by construction - GameGuessDto validates and parses `date` at the HTTP
    // boundary (isoDatetimeToDate), so an unparseable string 400s before ever reaching this code
    // rather than becoming an Invalid Date that fails the `score integer NOT NULL` column.
    const guessDate = dto.date;
    // Graded at MONTH granularity, because that is the granularity the player can actually pick
    // (date-round.svelte offers a year and a month, and emits the 1st of it). Scoring the exact day
    // charged the player for a day they had no way to name: the emitted date missed the real
    // capture day by up to half a month, which against a narrow pool scale could zero the round
    // however well they guessed. Still a whole-day count, so the stored integer offsetDays agrees
    // with the value scored below and keeps meaning days. See monthOffsetDays.
    const offsetDays = monthOffsetDays(guessDate, round.answerDate);
    return {
      roundId: round.id,
      userId,
      guessLat: null,
      guessLon: null,
      guessDate,
      distanceKm: null,
      offsetDays,
      score: scoreFromError(offsetDays, challenge.scaleDays),
    };
  }

  private async requireMember(spaceId: string, userId: string) {
    const member = await this.sharedSpaceRepository.getMember(spaceId, userId);
    if (!member) {
      throw new ForbiddenException('Not a member of this space');
    }
    return member;
  }

  private async requireEditor(spaceId: string, userId: string): Promise<void> {
    const member = await this.requireMember(spaceId, userId);
    if (!hasSharedSpaceRole(member.role, SharedSpaceRole.Editor)) {
      throw new ForbiddenException('Insufficient role');
    }
  }
}
