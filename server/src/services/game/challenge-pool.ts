import { GameChallengeType } from 'src/dtos/game.dto.js';
import { ScenePromptEmbeddings } from 'src/repositories/game.repository.js';
import { GameCandidate } from 'src/utils/game-scoring.js';

export type { ScenePromptEmbeddings } from 'src/repositories/game.repository.js';
export type { GameCandidate } from 'src/utils/game-scoring.js';

/**
 * The scope a challenge is generated against: today, a shared space (`SpacePool`); a later task
 * adds a solo user's own library (`PersonalPool`). `GameService.generateChallenge` is written
 * against this interface only, so the generator itself never names a space - candidate fetching,
 * eligibility, the seed key and the "no rounds" wording are all scope-specific and live in the
 * implementations instead.
 */
export interface ChallengePool {
  seedKey(): Promise<string>;
  challengeCount(): Promise<number>;
  locationCandidates(limit: number, seed: string, scenePrompts?: ScenePromptEmbeddings): Promise<GameCandidate[]>;
  dateCandidates(limit: number, seed: string): Promise<GameCandidate[]>;
  resolveRoundAsset(assetId: string): Promise<{ previewPath: string } | undefined>;
  recentlyUsedAssetIds(lookback: number): Promise<string[]>;
  noRoundsMessage(type: GameChallengeType): string;
}
