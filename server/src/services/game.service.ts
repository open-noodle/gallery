import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { Insertable } from 'kysely';
import { AuthDto } from 'src/dtos/auth.dto';
import { SharedSpaceRole } from 'src/enum';
import { GameChallengeTable } from 'src/schema/tables/game-challenge.table';
import { GameRoundTable, GameRoundType } from 'src/schema/tables/game-round.table';
import { BaseService } from 'src/services/base.service';
import {
  GameCandidate,
  LatLon,
  mulberry32,
  poolScaleDays,
  poolScaleKm,
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

/** Location rounds fill up to this fraction of the requested round count; the rest are date
 * rounds. See design doc §7.4 - this is what keeps a GPS-poor space playable. */
const LOCATION_ROUND_SHARE = 0.6;

/** Candidates fetched per pool per generation. Generous relative to any realistic roundCount so
 * both selectLocationRounds' relaxation ladder and the date-round shuffle have real choice. */
const CANDIDATE_POOL_LIMIT = 200;

/** How many of the space's most recent challenges to avoid repeating assets from. */
const RECENT_CHALLENGE_LOOKBACK = 3;

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

  private async requireEditor(spaceId: string, userId: string): Promise<void> {
    const member = await this.sharedSpaceRepository.getMember(spaceId, userId);
    if (!member) {
      throw new ForbiddenException('Not a member of this space');
    }
    if (!hasSharedSpaceRole(member.role, SharedSpaceRole.Editor)) {
      throw new ForbiddenException('Insufficient role');
    }
  }
}
