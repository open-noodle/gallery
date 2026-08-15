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

// Minimal shapes for the service surface this task owns. Task 9 (DTO/controller) formalises these
// as real class-validator DTOs in src/dtos/game.dto.ts; keep this type in sync with that file once
// it exists rather than letting the two drift.
export type GameCreateDto = {
  name?: string;
  roundCount: number;
};

export type GameChallengeResponseDto = {
  id: string;
  spaceId: string;
  name: string;
  roundCount: number;
  scaleKm: number;
  scaleDays: number;
  createdAt: Date;
};

export type GameGuessDto = {
  lat?: number;
  lon?: number;
  date?: string;
};

export type GameGuessResponseDto = {
  roundId: string;
  userId: string;
  guessLat: number | null;
  guessLon: number | null;
  guessDate: Date | null;
  distanceKm: number | null;
  offsetDays: number | null;
  score: number;
};

// The withheld shape for a round the caller has not guessed yet: only `index` and `type`. No
// coordinates, date, asset id or filename - see `toRoundDetail` below, which is the only place
// that is allowed to add the rest.
export type GameRoundDetailDto = {
  index: number;
  type: GameRoundType;
  assetId?: string;
  score?: number;
  answer?: {
    lat: number | null;
    lon: number | null;
    date: Date | null;
  };
};

export type GameChallengeDetailResponseDto = {
  id: string;
  spaceId: string;
  name: string;
  roundCount: number;
  scaleKm: number;
  scaleDays: number;
  createdAt: Date;
  closedAt: Date | null;
  rounds: GameRoundDetailDto[];
};

export type GameLeaderboardResponseDto = {
  entries: {
    userId: string;
    name: string;
    total: number;
    answered: number;
  }[];
};

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

    const requestedRoundCount = dto.roundCount;

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
      // postgres.js surfaces the violated constraint as `constraint_name`; `constraint` is
      // checked too so a differently-shaped driver/mock error is still mapped correctly.
      const constraintName =
        (error as PostgresError)?.constraint_name ?? (error as { constraint?: string })?.constraint;
      if (constraintName === 'game_guess_round_user_uq') {
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
  private toRoundDetail(round: GameRoundRow, guess: GameGuessRow | undefined): GameRoundDetailDto {
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

    const guessDate = new Date(dto.date);
    const offsetDays = Math.abs(guessDate.getTime() - round.answerDate.getTime()) / MS_PER_DAY;
    return {
      roundId: round.id,
      userId,
      guessLat: null,
      guessLon: null,
      guessDate,
      distanceKm: null,
      // The integer column stores whole days; scoring uses the unrounded offset above so a
      // fractional-day difference isn't double-rounded away before it reaches the decay curve.
      offsetDays: Math.round(offsetDays),
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
