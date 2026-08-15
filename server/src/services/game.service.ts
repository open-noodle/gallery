import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Insertable } from 'kysely';
import { PostgresError } from 'postgres';
import { AuthDto } from 'src/dtos/auth.dto';
import {
  GameChallengeDetailResponseDto,
  GameChallengeListItemResponseDto,
  GameChallengeResponseDto,
  GameCreateDto,
  GameGuessDto,
  GameGuessResponseDto,
  GameLeaderboardResponseDto,
  GameRoundDetailResponseDto,
} from 'src/dtos/game.dto';
import { SharedSpaceRole } from 'src/enum';
import { GameChallengeRow, GameGuessRow, GameRoundRow } from 'src/repositories/game.repository';
import { GameChallengeTable } from 'src/schema/tables/game-challenge.table';
import { GameGuessTable } from 'src/schema/tables/game-guess.table';
import { GameRoundTable, GameRoundType } from 'src/schema/tables/game-round.table';
import { BaseService } from 'src/services/base.service';
import {
  GameCandidate,
  LatLon,
  haversineKm,
  mulberry32,
  poolScaleDays,
  poolScaleKm,
  scoreFromError,
  selectLocationRounds,
} from 'src/utils/game-scoring';
import { hasSharedSpaceRole } from 'src/utils/shared-space-role';

/** Location rounds fill up to this fraction of the requested round count; the rest are date
 * rounds. See design doc §7.4 - this is what keeps a GPS-poor space playable. */
const LOCATION_ROUND_SHARE = 0.6;

/** Candidates fetched per pool per generation. Generous relative to any realistic roundCount so
 * both selectLocationRounds' relaxation ladder and the date-round shuffle have real choice. */
const CANDIDATE_POOL_LIMIT = 200;

/** How many of the space's most recent challenges to avoid repeating assets from. */
const RECENT_CHALLENGE_LOOKBACK = 3;

/** Mirrors the private MS_PER_DAY in game-scoring.ts, which does not export it. */
const MS_PER_DAY = 86_400_000;

/**
 * Calendar-day index (days since the UTC epoch) for a Date, not a raw ms/MS_PER_DAY division on
 * the instant. `answerDate` (`asset.localDateTime`, frozen onto the round) carries a full
 * capture timestamp - e.g. 14:23 - that a player who names the correct calendar day cannot know
 * and must not be charged for. Both the answer and the guess are normalised to their UTC
 * calendar day before differencing, matching the `(localDateTime at time zone 'UTC')::date`
 * convention the rest of the codebase already uses for this column (see the index expressions in
 * asset.table.ts) - so "the same day" scores 5000 regardless of either timestamp's time of day.
 */
const toUtcDayIndex = (date: Date): number =>
  Math.floor(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()) / MS_PER_DAY);

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
  async create(auth: AuthDto, spaceId: string, dto: GameCreateDto): Promise<GameChallengeResponseDto> {
    await this.requireEditor(spaceId, auth.user.id);

    // GameCreateDto.roundCount has a zod .default(5), but chaining .optional() after .default()
    // (the codebase's own convention, e.g. SharedSpaceMemberCreateDto.role) keeps the inferred TS
    // type `number | undefined` - the fallback still has to be applied here, same as dto.role ??
    // SharedSpaceRole.Viewer in shared-space.service.ts.
    const requestedRoundCount = dto.roundCount ?? 5;

    const [rawLocationPool, rawDatePool, recentlyUsedAssetIds, existingChallenges] = await Promise.all([
      this.gameRepository.getLocationCandidates(spaceId, CANDIDATE_POOL_LIMIT),
      this.gameRepository.getDateCandidates(spaceId, CANDIDATE_POOL_LIMIT),
      this.gameRepository.getRecentlyUsedAssetIds(spaceId, RECENT_CHALLENGE_LOOKBACK),
      this.gameRepository.getChallengesForSpace(spaceId),
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
    const challengeCount = existingChallenges?.length ?? 0;
    const random = mulberry32(hashSeed(`${spaceId}:${challengeCount}`));

    const locationShare = Math.floor(requestedRoundCount * LOCATION_ROUND_SHARE);
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
    const dateRemaining = requestedRoundCount - locationRounds.length;

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
      throw new BadRequestException(
        'This space has no photos usable for a challenge - add photos with GPS data or capture dates to play',
      );
    }

    const challenge: Insertable<GameChallengeTable> = {
      spaceId,
      createdById: auth.user.id,
      name: dto.name?.trim() || `Challenge ${challengeCount + 1}`,
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
      spaceId,
      name: challenge.name,
      roundCount: challenge.roundCount,
      scaleKm: challenge.scaleKm,
      scaleDays: challenge.scaleDays,
      createdAt: new Date(),
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

    const challenges = await this.gameRepository.getChallengesForSpace(spaceId);
    const guessesByChallenge = await Promise.all(
      challenges.map((challenge) => this.gameRepository.getGuessesForUser(challenge.id, auth.user.id)),
    );

    return challenges.map((challenge, i) => {
      const guesses = guessesByChallenge[i];
      return {
        id: challenge.id,
        spaceId: challenge.spaceId,
        name: challenge.name,
        roundCount: challenge.roundCount,
        scaleKm: challenge.scaleKm,
        scaleDays: challenge.scaleDays,
        createdAt: challenge.createdAt,
        closedAt: challenge.closedAt,
        answered: guesses.length,
        total: guesses.reduce((sum, guess) => sum + guess.score, 0),
      };
    });
  }

  /**
   * The withheld-answer view of a challenge: `answer`, `score` and `assetId` are present only
   * for rounds the caller has already submitted a guess for. This is the security property of
   * the endpoint, so it lives here in the service rather than being trusted to the client.
   */
  async get(auth: AuthDto, challengeId: string): Promise<GameChallengeDetailResponseDto> {
    const challenge = await this.loadChallenge(challengeId);
    await this.requireMember(challenge.spaceId, auth.user.id);

    const [rounds, guesses] = await Promise.all([
      this.gameRepository.getRounds(challengeId),
      this.gameRepository.getGuessesForUser(challengeId, auth.user.id),
    ]);

    const guessByRoundId = new Map(guesses.map((guess) => [guess.roundId, guess]));

    return {
      id: challenge.id,
      spaceId: challenge.spaceId,
      name: challenge.name,
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
    await this.requireMember(challenge.spaceId, auth.user.id);

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

  async leaderboard(auth: AuthDto, challengeId: string): Promise<GameLeaderboardResponseDto> {
    const challenge = await this.loadChallenge(challengeId);
    await this.requireMember(challenge.spaceId, auth.user.id);

    const [rows, members] = await Promise.all([
      this.gameRepository.getLeaderboard(challengeId),
      this.sharedSpaceRepository.getMembers(challenge.spaceId),
    ]);

    const nameByUserId = new Map(members.map((member) => [member.userId, member.name]));

    return {
      entries: rows.map((row) => ({
        userId: row.userId,
        name: nameByUserId.get(row.userId) ?? 'Unknown',
        total: row.total,
        answered: row.answered,
      })),
    };
  }

  async delete(auth: AuthDto, challengeId: string): Promise<void> {
    const challenge = await this.loadChallenge(challengeId);
    await this.requireEditor(challenge.spaceId, auth.user.id);
    await this.gameRepository.deleteChallenge(challengeId);
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
    // Whole-day count already, by construction (toUtcDayIndex subtracts two day boundaries) -
    // no separate rounding step, so the stored integer offsetDays always agrees with the value
    // actually scored below.
    const offsetDays = Math.abs(toUtcDayIndex(guessDate) - toUtcDayIndex(round.answerDate));
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
