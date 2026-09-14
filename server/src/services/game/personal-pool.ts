import { GameChallengeType } from 'src/dtos/game.dto';
import { GameRepository } from 'src/repositories/game.repository';
import { ChallengePool, GameCandidate, ScenePromptEmbeddings } from 'src/services/game/challenge-pool';
import { SoloPoolSources } from 'src/utils/game-solo-eligibility';

/**
 * Why no rounds could be built, phrased per requested type - the solo counterpart to
 * SPACE_NO_ROUNDS_MESSAGE. Two things differ from the space wording, and both are the point of
 * having a second copy: it never tells a player to add photos to a space they may not have, and it
 * names the source toggles, which are a real remedy here and do not exist for a space.
 */
export const PERSONAL_NO_ROUNDS_MESSAGE: Record<GameChallengeType, string> = {
  mixed:
    'None of your photos can be used for a challenge - add photos with GPS data or capture dates, or include partner and shared-space photos when you start a game',
  location:
    'None of your photos have GPS data - a location game needs photos that know where they were taken, or include partner and shared-space photos when you start a game',
  date: 'None of your photos have capture dates - a date game needs photos that know when they were taken, or include partner and shared-space photos when you start a game',
};

/**
 * One player's own scope: their library, plus whichever of partner and shared-space photos they
 * asked for. Like `SpacePool`, every method is a thin delegation to the scope's repository
 * queries - the generator above it stays scope-blind, and any logic that appears here should be
 * examined for whether it belongs there instead.
 *
 * `sources` are the toggles FROZEN onto the challenge row at generation, so a pool rebuilt later
 * to serve a round image resolves the same set the rounds were drawn from.
 */
export class PersonalPool implements ChallengePool {
  private sources: SoloPoolSources;

  constructor(
    private repository: GameRepository,
    private userId: string,
    sources: { withPartners: boolean; withSpaces: boolean },
  ) {
    // Spread first, id last: the declared type cannot carry a userId, but if it ever grows one a
    // caller-supplied field must not be able to win over the id this pool was constructed for.
    this.sources = { ...sources, userId };
  }

  // Prefixed rather than the bare id: this string is half of the generation seed, and a bare uuid
  // would collide with SpacePool's key space the day a space id and a user id happen to match -
  // both are v4/v7 uuids drawn from the same alphabet. Promise.resolve, not `async`, because there
  // is nothing to await; the interface still requires a Promise<string>.
  seedKey = () => Promise.resolve(`user:${this.userId}`);

  challengeCount = () => this.repository.getSoloChallengeCount(this.userId);

  locationCandidates = (limit: number, seed: string, scenePrompts?: ScenePromptEmbeddings) =>
    this.repository.getSoloLocationCandidates(this.sources, limit, seed, scenePrompts);

  dateCandidates = (limit: number, seed: string): Promise<GameCandidate[]> =>
    this.repository.getSoloDateCandidates(this.sources, limit, seed);

  resolveRoundAsset = (assetId: string) => this.repository.getSoloEligibleRoundAsset(this.sources, assetId);

  recentlyUsedAssetIds = (lookback: number) => this.repository.getSoloRecentlyUsedAssetIds(this.userId, lookback);

  noRoundsMessage = (type: GameChallengeType) => PERSONAL_NO_ROUNDS_MESSAGE[type];
}
