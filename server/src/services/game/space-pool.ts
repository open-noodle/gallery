import { GameChallengeType } from 'src/dtos/game.dto';
import { GameRepository } from 'src/repositories/game.repository';
import { ChallengePool, GameCandidate, ScenePromptEmbeddings } from 'src/services/game/challenge-pool';

/**
 * Why no rounds could be built, phrased per requested type. The remedy differs - a location game
 * needs GPS data specifically - so a single generic sentence would send half of these callers after
 * the wrong thing.
 */
export const SPACE_NO_ROUNDS_MESSAGE: Record<GameChallengeType, string> = {
  mixed: 'This space has no photos usable for a challenge - add photos with GPS data or capture dates to play',
  location: 'This space has no photos with GPS data - a location game needs photos that know where they were taken',
  date: 'This space has no photos with capture dates - a date game needs photos that know when they were taken',
};

/**
 * The shared-space scope. Every method is a thin delegation to the space-scoped repository
 * queries, which is the point: this class exists so GameService stops naming a space, not to add
 * behaviour. Any logic that appears here should be examined for whether it belongs in the
 * scope-blind generator instead.
 */
export class SpacePool implements ChallengePool {
  constructor(
    private repository: GameRepository,
    private spaceId: string,
  ) {}

  // Byte-for-byte the string GameService.create built before this refactor. The seed decides
  // which slice of a large space the candidate queries return, so a different shape here silently
  // re-rolls every future challenge in every existing space. Promise.resolve, not `async`, because
  // there is nothing to await - the interface still requires a Promise<string>.
  seedKey = () => Promise.resolve(this.spaceId);

  challengeCount = async () => {
    const challenges = await this.repository.getChallengesForSpace(this.spaceId);
    return challenges?.length ?? 0;
  };

  locationCandidates = (limit: number, seed: string, scenePrompts?: ScenePromptEmbeddings) =>
    this.repository.getLocationCandidates(this.spaceId, limit, seed, scenePrompts);

  dateCandidates = (limit: number, seed: string): Promise<GameCandidate[]> =>
    this.repository.getDateCandidates(this.spaceId, limit, seed);

  resolveRoundAsset = (assetId: string) => this.repository.getEligibleRoundAsset(this.spaceId, assetId);

  recentlyUsedAssetIds = (lookback: number) => this.repository.getRecentlyUsedAssetIds(this.spaceId, lookback);

  noRoundsMessage = (type: GameChallengeType) => SPACE_NO_ROUNDS_MESSAGE[type];
}
