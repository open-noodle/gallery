import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Insertable } from 'kysely';
import { DateTime } from 'luxon';
import { PostgresError } from 'postgres';
import { OnEvent, OnJob } from 'src/decorators';
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
  GameSoloCreateDto,
  GameSoloHistoryQueryDto,
  GameSoloHistoryResponseDto,
  GameSoloStatsResponseDto,
  GameStandingsResponseDto,
} from 'src/dtos/game.dto';
import { CacheControl, JobName, QueueName, SharedSpaceRole } from 'src/enum';
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
import { PersonalPool } from 'src/services/game/personal-pool';
import { SpacePool } from 'src/services/game/space-pool';
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
import { computeStreak } from 'src/utils/game-streak';
import { mimeTypes } from 'src/utils/mime-types';
import { isSmartSearchEnabled } from 'src/utils/misc';
import { getPreferences } from 'src/utils/preferences';
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

/** Postgres constraints behind the lazy daily generation race - see the migration. There are two
 * because Postgres treats NULLs as distinct in a unique index, so one partial index over
 * (spaceId, dailyOn) does not constrain solo rows at all. */
const SPACE_DAILY_UNIQUE_CONSTRAINT = 'game_challenge_daily_uq';
const SOLO_DAILY_UNIQUE_CONSTRAINT = 'game_challenge_owner_daily_uq';

/** How many rounds a challenge has when the request does not say - both scopes, one number, so
 * the two create panels cannot drift apart. Mirrors the zod `.default(5)` on the create DTOs,
 * which cannot be relied on for the TS type - see `create`. */
const DEFAULT_ROUND_COUNT = 5;

/** How long an unplayed challenge survives before the nightly prune deletes it - see
 * onGameChallengeCleanup. A solo game is ~11 rows and a daily a day accumulates forever once
 * played, so games are kept indefinitely; this window only bounds the pile a challenge that
 * nobody ever opened leaves behind. */
const UNPLAYED_CHALLENGE_RETENTION_DAYS = 7;

/** A challenge drawn from one shared space's photos. */
type SpaceScope = { spaceId: string; ownerId: null };

/**
 * A challenge drawn from one player's own scope, carrying the source toggles FROZEN onto the row.
 * They live here rather than on every scope because they only mean something for a solo
 * challenge - a shared space has no sources to choose between.
 */
type SoloScope = { spaceId: null; ownerId: string; includePartners: boolean; includeSpaces: boolean };

/**
 * One challenge's scope: a shared space OR one user, never both and never neither -
 * `game_challenge_scope_chk` expressed in the type system, so every branch that dispatches on
 * scope gets a non-null id out of it rather than re-deriving one from two nullable columns.
 */
type ChallengeScope = SpaceScope | SoloScope;

/**
 * Today's date as the UTC calendar day, `YYYY-MM-DD`.
 *
 * UTC rather than the caller's local day, and this is the whole point of the choice: members of one
 * space can be in different timezones, and a per-viewer day would give them different "today"s -
 * two people comparing scores on the same leaderboard while playing different challenges.
 */
const utcDateKey = (now: Date): string => now.toISOString().slice(0, 10);

/**
 * A stored `dailyOn` as the `YYYY-MM-DD` string the API reports.
 *
 * Deliberately NOT the shared `asDateString`: that encodes through Luxon's DEFAULT zone
 * (`DateTime.fromJSDate(date).toFormat('yyyy-MM-dd')`), which is the server's `TZ` - an admin-set,
 * documented deployment option (docker/example.env). The driver hands a `date` column back as a
 * Date at UTC MIDNIGHT (postgres.js parses '2026-08-19' with `new Date(x)`), so re-formatting it in
 * a local zone reports the PREVIOUS day on any server west of Greenwich. Every day this game keys
 * on is a UTC calendar day - `utcDateKey` stamps the row, the streak counts off it, the two partial
 * unique indexes dedupe on it, and both clients key "already played today" on it - so the wire value
 * has to be read off the UTC calendar fields, not reconstructed in whatever zone the host is set to.
 *
 * Kept local to this file rather than fixing `asDateString`: `person.birthDate` encodes through that
 * same helper and is a different question (a birthday is a local-calendar fact, not a UTC instant),
 * so widening the change would touch a contract this branch has no business moving.
 */
const asUtcDateString = (date: Date | string | null): string | null =>
  date instanceof Date ? date.toISOString().slice(0, 10) : date;

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

/** How many of the scope's most recent challenges to avoid repeating assets from. */
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

  /**
   * Nightly prune of challenges nobody ever played - see `GameRepository.deleteUnplayedChallenges`
   * for what "unplayed" means and why it is zero guesses rather than not finished. Queued from
   * `QueueService.handleNightlyJobs` inside the `nightlyTasks.databaseCleanup` block, next to
   * `MemoryCleanup` - the same admin opt-out that grouping is built on.
   */
  @OnJob({ name: JobName.GameChallengeCleanup, queue: QueueName.BackgroundTask })
  async onGameChallengeCleanup() {
    await this.gameRepository.deleteUnplayedChallenges(
      DateTime.now().minus({ days: UNPLAYED_CHALLENGE_RETENTION_DAYS }).toJSDate(),
    );
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
      requestedRoundCount: dto.roundCount ?? DEFAULT_ROUND_COUNT,
      type: dto.type ?? 'mixed',
      seed: `${await pool.seedKey()}:${challengeCount}`,
      dailyOn: null,
      name: dto.name?.trim() || `Challenge ${challengeCount + 1}`,
    });
  }

  /**
   * Free play: one challenge drawn from the player's own scope, with no space involved at all.
   *
   * `createdById` stays null - `ownerId` already carries the authorship, and setting both would
   * point two different FK actions (CASCADE and SET NULL) at one row for one user-deletion event.
   */
  async createSolo(auth: AuthDto, dto: GameSoloCreateDto): Promise<GameChallengeResponseDto> {
    // The stored preference is the default a request falls back to, not a value this request
    // writes back - overriding per-game here must never mutate the preference, or starting one
    // wide game would silently widen every future daily too.
    const { photoGuesser } = getPreferences(await this.userRepository.getMetadata(auth.user.id));
    // Field by field rather than a spread of `dto.sources`, so a partial override ("include my
    // partners") keeps the default for the toggle it does not mention.
    const scope: SoloScope = {
      spaceId: null,
      ownerId: auth.user.id,
      includePartners: dto.sources?.includePartners ?? photoGuesser.includePartners,
      includeSpaces: dto.sources?.includeSpaces ?? photoGuesser.includeSpaces,
    };

    const pool = this.personalPool(scope);
    // Before the candidate queries, for the same reason `create` resolves it early: the count is
    // half of the seed, and the seed decides which slice of a large library they return.
    const challengeCount = await pool.challengeCount();

    return this.generateChallenge({
      pool,
      scope,
      createdById: null,
      requestedRoundCount: dto.roundCount ?? DEFAULT_ROUND_COUNT,
      type: dto.type ?? 'mixed',
      seed: `${await pool.seedKey()}:${challengeCount}`,
      dailyOn: null,
      name: `Challenge ${challengeCount + 1}`,
    });
  }

  /**
   * The player's own pool, translated from the row's vocabulary (`includePartners`) into the
   * pool's (`withPartners`). One conversion point, so a challenge being generated and the same
   * challenge being served a round image later cannot disagree about what the toggles meant.
   */
  private personalPool(scope: SoloScope): PersonalPool {
    return new PersonalPool(this.gameRepository, scope.ownerId, {
      withPartners: scope.includePartners,
      withSpaces: scope.includeSpaces,
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
    // write it - `create`/`createSolo`/`generateDaily` are the ones that know whether this
    // challenge belongs to a space or to a user, so they build this alongside the pool.
    scope: ChallengeScope;
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

    // Prefer excluding assets used by recent challenges in this scope, but never at the cost of
    // being unable to fill the request. The decision is made per candidate pool, and for the date
    // pool against the round count the location pool actually delivered - a well-stocked pool keeps
    // its exclusion even when the other pool has to give it up to reach requestedRoundCount, and a
    // location shortfall doesn't wrongly count against the date pool's own supply.
    const recentlyUsed = new Set(recentlyUsedAssetIds);
    const withoutRecent = (candidates: GameCandidate[]) =>
      candidates.filter((candidate) => !recentlyUsed.has(candidate.assetId));

    // Seeded from the scope and its existing challenge count, not wall-clock or Math.random, so
    // generation is reproducible and successive challenges for the same scope still differ.
    const random = mulberry32(hashSeed(seed));

    // Still floored, which is exact for the explicit types (a share of 1 or 0 cannot have a
    // fractional part) and leaves 'mixed' rounding exactly as it always did.
    const locationShare = Math.floor(requestedRoundCount * LOCATION_SHARE_BY_TYPE[type]);
    const filteredLocationPool = withoutRecent(rawLocationPool);
    const locationNeeded = Math.min(locationShare, rawLocationPool.length);
    const locationPool = filteredLocationPool.length >= locationNeeded ? filteredLocationPool : rawLocationPool;

    // Frozen here, once, from the location pool actually used to generate this challenge. Scoring
    // divides by this later - recomputing it as the scope gains photos would rewrite every score
    // already recorded against this challenge.
    const scaleKm = poolScaleKm(toPoints(locationPool), random);

    const locationTarget = Math.min(locationShare, locationPool.length);
    const locationRounds = selectLocationRounds(locationPool, locationTarget, scaleKm, random);

    const usedAssetIds = new Set(locationRounds.map((candidate) => candidate.assetId));
    // Only 'mixed' lets the date pool cover a location shortfall. For an explicit 'location'
    // request the remainder must stay 0, or a GPS-poor scope would answer a location game with
    // date rounds and look like the type picker did nothing.
    const dateRemaining = type === 'location' ? 0 : requestedRoundCount - locationRounds.length;

    const filteredDatePool = withoutRecent(rawDatePool);
    const availableExcludingUsed = (candidates: GameCandidate[]) =>
      candidates.filter((candidate) => !usedAssetIds.has(candidate.assetId)).length;
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
      // Field by field, never `...scope`, for the same reason the response below is built that way:
      // TypeScript's excess-property check does not fire through a spread, so a third field added
      // to the `photoGuesser` preference would ride `SoloScope` into this insert and reach Kysely as
      // an unknown column - a runtime failure on every solo create, with nothing red at compile
      // time. `createSolo` builds its scope the same way, for the same reason.
      spaceId: scope.spaceId,
      ownerId: scope.ownerId,
      // A space challenge has no sources to choose between, so it freezes the column default the
      // spread used to leave behind (`false`) rather than inventing a toggle for it.
      includePartners: scope.ownerId === null ? false : scope.includePartners,
      includeSpaces: scope.ownerId === null ? false : scope.includeSpaces,
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
      // Field by field, never `...scope`: the scope also carries the frozen source toggles, which
      // are columns on the row but NOT fields of this response, and a spread does not get an
      // excess-property check - they would have shipped to every client silently. Reading from
      // `scope` rather than `challenge` is still deliberate: Insertable<GameChallengeTable> types
      // nullable columns as `T | null | undefined` (undefined = "let the DB default apply"), while
      // `scope` is the exact `string | null` this DTO field wants, and is what we actually wrote.
      spaceId: scope.spaceId,
      ownerId: scope.ownerId,
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
      // Both read straight off the row, exactly one of them non-null: this shape serves the space
      // list, the space daily and the personal daily, and it is the caller's gate - not this
      // mapper - that decides who may see a given scope.
      spaceId: challenge.spaceId,
      ownerId: challenge.ownerId,
      name: challenge.name,
      roundCount: challenge.roundCount,
      scaleKm: challenge.scaleKm,
      scaleDays: challenge.scaleDays,
      createdAt: challenge.createdAt,
      closedAt: challenge.closedAt,
      dailyOn: asUtcDateString(challenge.dailyOn),
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
    const scope: SpaceScope = { spaceId, ownerId: null };
    const existing = await this.readDaily(scope, dailyOn);
    const challenge =
      existing ?? (await this.generateDaily({ pool: new SpacePool(this.gameRepository, spaceId), scope, dailyOn }));

    return this.toDailyResponse(auth, challenge);
  }

  /**
   * The player's own daily for today, generated on first read.
   *
   * Lazy for the same reasons the space daily is - nothing to schedule for an account nobody
   * opens, a missed day heals itself - and keyed to the UTC calendar day, the same boundary, so
   * the two dailies roll over together rather than a player's "today" depending on which one they
   * opened. Always available: there is no per-user opt-in, because unlike a space's daily this one
   * is nobody else's business to enable.
   */
  async getSoloDaily(auth: AuthDto): Promise<GameDailyResponseDto> {
    const dailyOn = utcDateKey(new Date());
    // The toggles are read from the stored preference once, here, and frozen onto the row by
    // generateChallenge - so flipping a source later in the day cannot make the daily already in
    // flight unplayable, and there is no per-request override: the daily takes no request body, so
    // the preference is the only source of truth for what it draws from.
    const { photoGuesser } = getPreferences(await this.userRepository.getMetadata(auth.user.id));
    // Field by field rather than `...photoGuesser`, matching `createSolo`: a spread gets no
    // excess-property check, so a third field on the preference would ride this scope into the
    // insert in `generateChallenge` and reach Kysely as an unknown column.
    const scope: SoloScope = {
      spaceId: null,
      ownerId: auth.user.id,
      includePartners: photoGuesser.includePartners,
      includeSpaces: photoGuesser.includeSpaces,
    };
    const existing = await this.readDaily(scope, dailyOn);
    const challenge = existing ?? (await this.generateDaily({ pool: this.personalPool(scope), scope, dailyOn }));

    return this.toDailyResponse(auth, challenge);
  }

  /** A daily, annotated with the caller's own progress - or the "no daily today" shape. */
  private async toDailyResponse(auth: AuthDto, challenge: GameChallengeRow | undefined): Promise<GameDailyResponseDto> {
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
   * Generates today's daily for one scope, or returns undefined when that scope has nothing
   * playable.
   *
   * One generator for both scopes, so the seed shape and the race recovery cannot drift apart -
   * they are exactly the two things nothing downstream would notice diverging.
   *
   * Two behaviours are deliberate. A scope with no usable photos yields `undefined` rather than
   * the 400 `generateChallenge` throws: "no daily today" is an ordinary state of the page, not a
   * failed request. And a lost race - two readers generating at once, the scope's partial unique
   * index rejecting the second - is resolved by re-reading the winner, so both reads land on the
   * SAME challenge instead of one of them seeing a 500.
   *
   * The index to watch for and the row to re-read are DERIVED from the scope rather than passed
   * in beside it. As parameters they were two more things a caller had to keep in agreement with
   * the scope, and the wrong pairing compiled silently: watching for the space constraint on the
   * solo path would turn a lost race into a 500 instead of a clean re-read - a failure that only
   * appears under concurrency, which is exactly where nobody is watching. That closes off one
   * mismatch, not every one: `pool` is still passed independently, and a `SpacePool` paired with
   * a solo `scope` still compiles.
   */
  private async generateDaily({
    pool,
    scope,
    dailyOn,
  }: {
    pool: ChallengePool;
    scope: ChallengeScope;
    dailyOn: string;
  }): Promise<GameChallengeRow | undefined> {
    // The partial unique index this scope races on - the two scopes have one each, because Postgres
    // treats NULLs as distinct and neither index constrains the other's rows.
    const uniqueConstraint = scope.spaceId === null ? SOLO_DAILY_UNIQUE_CONSTRAINT : SPACE_DAILY_UNIQUE_CONSTRAINT;

    try {
      await this.generateChallenge({
        pool,
        scope,
        // No human author: the daily is the scope's, not the first reader's - and for a solo
        // challenge `ownerId` already carries who it belongs to.
        createdById: null,
        requestedRoundCount: DAILY_ROUND_COUNT,
        type: 'mixed',
        // Keyed to the date, so every "first" generation for this scope builds an identical
        // challenge.
        seed: `${await pool.seedKey()}:daily:${dailyOn}`,
        dailyOn,
        name: dailyOn,
      });
    } catch (error) {
      // postgres.js surfaces the violated constraint as `constraint_name`, the same pattern
      // `guess` uses for the already-guessed conflict.
      if ((error as PostgresError)?.constraint_name === uniqueConstraint) {
        return this.readDaily(scope, dailyOn);
      }
      if (error instanceof BadRequestException) {
        return undefined;
      }
      throw error;
    }

    return this.readDaily(scope, dailyOn);
  }

  /**
   * Today's stored daily for one scope, whoever wrote it.
   *
   * Two repository methods rather than one taking both ids, for the reason
   * `getSoloDailyChallenge` documents: the scopes are enforced by two different partial unique
   * indexes, and a single query taking both would be one `where` away from reading across scopes.
   */
  private readDaily(scope: ChallengeScope, dailyOn: string): Promise<GameChallengeRow | undefined> {
    return scope.spaceId === null
      ? this.gameRepository.getSoloDailyChallenge(scope.ownerId, dailyOn)
      : this.gameRepository.getDailyChallenge(scope.spaceId, dailyOn);
  }

  /**
   * The withheld-answer view of a challenge: `answer`, `score` and `assetId` are present only
   * for rounds the caller has already submitted a guess for. This is the security property of
   * the endpoint, so it lives here in the service rather than being trusted to the client.
   */
  async get(auth: AuthDto, challengeId: string): Promise<GameChallengeDetailResponseDto> {
    const challenge = await this.loadChallenge(challengeId);
    await this.requireChallengeAccess(auth, challenge, { editor: false });

    const [rounds, guesses] = await Promise.all([
      this.gameRepository.getRounds(challengeId),
      this.gameRepository.getGuessesForUser(challengeId, auth.user.id),
    ]);

    const guessByRoundId = new Map(guesses.map((guess) => [guess.roundId, guess]));

    return {
      id: challenge.id,
      // Straight off the row, exactly one of them non-null - same reasoning as toListItem.
      spaceId: challenge.spaceId,
      ownerId: challenge.ownerId,
      name: challenge.name,
      dailyOn: asUtcDateString(challenge.dailyOn),
      roundCount: challenge.roundCount,
      scaleKm: challenge.scaleKm,
      scaleDays: challenge.scaleDays,
      createdAt: challenge.createdAt,
      closedAt: challenge.closedAt,
      rounds: rounds.map((round) => this.toRoundDetail(round, guessByRoundId.get(round.id))),
    };
  }

  /**
   * Submits one round's guess. Membership (any role) for a space challenge, ownership for a solo
   * one - unlike `create`/`delete`, playing a challenge is not an editor-only action. The score is
   * computed here, once, from the challenge's frozen `scaleKm`/`scaleDays`, then persisted; it is
   * never recomputed on read.
   */
  async guess(auth: AuthDto, challengeId: string, index: number, dto: GameGuessDto): Promise<GameGuessResponseDto> {
    const challenge = await this.loadChallenge(challengeId);
    await this.requireChallengeAccess(auth, challenge, { editor: false });

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
   * filename; the original file and the real filename are never touched here. Gated like
   * `get`/`guess`/`leaderboard` - a space viewer can view every round's image, a solo owner their
   * own.
   */
  async getRoundImage(auth: AuthDto, challengeId: string, index: number): Promise<ImmichMediaResponse> {
    const challenge = await this.loadChallenge(challengeId);
    const scope = await this.requireChallengeAccess(auth, challenge, { editor: false });

    const round = await this.gameRepository.getRound(challengeId, index);
    if (!round) {
      throw new BadRequestException('Round not found');
    }

    // The asset backing this round was deleted after the challenge was created - fail cleanly
    // rather than querying the repository with a null id.
    if (!round.assetId) {
      throw new NotFoundException('Round image not available');
    }

    // Scope-scoped, and re-checked on EVERY request - deliberately not AssetRepository.getById,
    // which applies no deletedAt, no visibility and no scope predicate. Rounds are frozen by
    // design (§4.1) so this assetId is permanent; resolving it unscoped meant that once a photo
    // entered a challenge, removing it from the space, trashing it, or moving it to the locked
    // folder did not stop the game serving it to every member, forever. resolveRoundAsset
    // re-applies the exact predicate the candidate queries used, so eligibility to be served
    // and eligibility to be picked cannot diverge.
    //
    // The solo pool is rebuilt from the toggles FROZEN on the row, not from the player's current
    // preference: re-resolving them live would 404 every round image of a game in flight the
    // moment they turned a source off.
    //
    // A miss is a normal outcome, not corruption: the round remains scoreable from its
    // denormalised answer (§9), so this 404s the image and leaves the challenge intact.
    const pool = scope.spaceId === null ? this.personalPool(scope) : new SpacePool(this.gameRepository, scope.spaceId);
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
   * Today's-challenge board: one entry per CURRENT member, zero-filled - or, for a solo
   * challenge, the one player it belongs to.
   *
   * Members who have not played are included rather than omitted, so this board and the monthly
   * standings show the same people - a member who is absent from one tab and present on the other
   * reads as a bug. Rows belonging to someone who has left the space are dropped; they used to
   * render under a hardcoded English 'Unknown'.
   */
  async leaderboard(auth: AuthDto, challengeId: string): Promise<GameLeaderboardResponseDto> {
    const challenge = await this.loadChallenge(challengeId);
    const scope = await this.requireChallengeAccess(auth, challenge, { editor: false });

    if (scope.spaceId === null) {
      // A solo challenge has exactly one player, and the gate above has just proved it is this
      // caller - so the board is their own row, zero-filled like every other member row here.
      // Not an empty board: the client renders the same component either way, and "no entries"
      // would read as "you have not played" once they have.
      const rows = await this.gameRepository.getLeaderboard(challengeId);
      const row = rows.find((entry) => entry.userId === scope.ownerId);
      return {
        entries: [
          {
            userId: scope.ownerId,
            name: auth.user.name,
            total: row?.total ?? 0,
            answered: row?.answered ?? 0,
          },
        ],
      };
    }

    const [rows, members] = await Promise.all([
      this.gameRepository.getLeaderboard(challengeId),
      this.sharedSpaceRepository.getMembers(scope.spaceId),
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

  /**
   * Solo play's answer to the leaderboard and the standings: the player's own record.
   *
   * COMPUTED on every read, never stored, so no counter can drift away from the guesses it claims
   * to summarise - a stored streak survives a deleted game, a corrected score, or a bug in the
   * increment, and there would be nothing to reconcile it against. It is two queries per read of a
   * page nobody refreshes in a loop, which is a cheap price for that.
   *
   * The streak counts only dailies, and only fully played ones (`getSoloCompletedDailyDates`);
   * every other number counts every game with a guess in it, free play included. Those two answers
   * can legitimately disagree - a half-played daily raises `gamesPlayed` and breaks the streak -
   * and the client must not paper over that.
   */
  async soloStats(auth: AuthDto): Promise<GameSoloStatsResponseDto> {
    const [completedDays, summary] = await Promise.all([
      this.gameRepository.getSoloCompletedDailyDates(auth.user.id),
      this.gameRepository.getSoloScoreSummary(auth.user.id),
    ]);

    // Measured against the UTC day, the same boundary `dailyOn` is stamped with - a local-day
    // "today" would end a player's streak hours early or late depending on where they live.
    const streak = computeStreak(completedDays, utcDateKey(new Date()));

    return {
      currentStreak: streak.current,
      bestStreak: streak.best,
      bestScore: summary.bestScore,
      // Whole points, like every score the game shows: rounds are scored in integers, and rendering
      // an average as 4212.3333333333335 would be the only fractional number on the panel.
      averageScore: Math.round(summary.averageScore),
      gamesPlayed: summary.gamesPlayed,
    };
  }

  /**
   * One page of the player's own finished games, newest first.
   *
   * Paged rather than complete because a daily a day accumulates forever, and offset paging rather
   * than a cursor because this list is browsed from the top and appended to at the top - the drift
   * a cursor protects against needs a page boundary to cross, which is not how anyone reads their
   * own history.
   *
   * One row past the requested page is fetched to answer `hasNextPage` without a second count over
   * every game the player has ever played (`person.service.ts` pages faces the same way).
   */
  async soloHistory(auth: AuthDto, dto: GameSoloHistoryQueryDto): Promise<GameSoloHistoryResponseDto> {
    const take = dto.size;
    const rows = await this.gameRepository.getSoloHistory(auth.user.id, {
      skip: (dto.page - 1) * dto.size,
      take: take + 1,
    });

    // Past the last page this is simply empty, which is the honest answer to "page 40 of 3" - the
    // request is well formed, the player just has nothing there, and 404ing it would make a stale
    // page number in a bookmark look like a broken endpoint.
    return {
      // Field by field rather than a spread of the row, the same rule `generateChallenge` follows:
      // TypeScript's excess-property check does not fire on a spread, so a column added to the
      // repository row later would ship to every client without anyone deciding it should.
      items: rows.slice(0, take).map((row) => ({
        id: row.id,
        name: row.name,
        dailyOn: row.dailyOn,
        createdAt: row.createdAt,
        roundCount: row.roundCount,
        answered: row.answered,
        total: row.total,
      })),
      hasNextPage: rows.length > take,
    };
  }

  async delete(auth: AuthDto, challengeId: string): Promise<void> {
    const challenge = await this.loadChallenge(challengeId);
    await this.requireChallengeAccess(auth, challenge, { editor: true });
    // Refused for both scopes, for two different reasons that land in the same place. A space
    // daily is shared state, not one member's row: deleting it would take away a game the rest of
    // the space may already have played today, and it would regenerate on the next read anyway -
    // with a different id, orphaning the leaderboard everyone was competing on. A personal daily
    // is one player's, but a deletable daily is a re-rollable one, which is exactly what a streak
    // has to be safe from.
    if (challenge.dailyOn !== null) {
      throw new BadRequestException('The daily challenge cannot be deleted');
    }
    await this.gameRepository.deleteChallenge(challengeId);
  }

  /**
   * The single gate on one challenge, and the single place that dispatches on its scope: a space
   * challenge resolves through membership, a solo challenge through ownership. Returns the scope
   * it resolved, so a caller that needs a non-null id (the round-image pool, the leaderboard's
   * member list) gets it from the check rather than re-deriving it from two nullable columns.
   *
   * `editor` is the space side's write gate, for `delete`. There is no solo counterpart: an owner
   * is an owner, and a solo challenge has no other role to hold. It is REQUIRED, and deliberately
   * has no default: the safe value and the common value are opposites here, so a default would be
   * permissive, and a future mutating route that simply forgot the flag would silently settle for
   * member-level access on the space arm. Stating it at every call site is the cost of that not
   * being possible.
   *
   * A solo challenge belonging to someone else is MISSING, not forbidden. Ownership has no "you
   * are not a member of X" answer that is safe to give: there is no group to be outside of, so the
   * only true 403 would be "this challenge exists and is somebody's", which tells a stranger
   * exactly what they were probing for. (The space arm does answer 403 - `loadChallenge` 404s an
   * unknown id before this gate runs, so a space challenge's existence is already distinguishable.
   * That is deliberate and pinned by e2e; it is simply not a precedent the solo arm can borrow.)
   */
  private async requireChallengeAccess(
    auth: AuthDto,
    challenge: GameChallengeRow,
    { editor }: { editor: boolean },
  ): Promise<ChallengeScope> {
    if (challenge.spaceId !== null) {
      await (editor
        ? this.requireEditor(challenge.spaceId, auth.user.id)
        : this.requireMember(challenge.spaceId, auth.user.id));
      return { spaceId: challenge.spaceId, ownerId: null };
    }

    // Covers a row with neither scope as well, which `game_challenge_scope_chk` forbids: it has
    // no owner to match, so it is unreachable rather than a crash waiting to happen.
    if (challenge.ownerId !== auth.user.id) {
      throw new NotFoundException('Challenge not found');
    }

    return {
      spaceId: null,
      ownerId: challenge.ownerId,
      includePartners: challenge.includePartners,
      includeSpaces: challenge.includeSpaces,
    };
  }

  private async loadChallenge(challengeId: string): Promise<GameChallengeRow> {
    const challenge = await this.gameRepository.getChallenge(challengeId);
    if (!challenge) {
      throw new NotFoundException('Challenge not found');
    }
    return challenge;
  }

  // The only place allowed to attach `answer`/`score`/`assetId`/`guess` to a round - and only once a
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
      guess: {
        lat: guess.guessLat,
        lon: guess.guessLon,
        date: guess.guessDate,
        distanceKm: guess.distanceKm,
        offsetDays: guess.offsetDays,
      },
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
