import { GameRepository } from 'src/repositories/game.repository';

describe('GameRepository', () => {
  it('is constructible and exposes the query surface the service depends on', () => {
    // A cheap guard on the registration trap: if the repository is not exported
    // and importable under its expected name, every downstream task fails in a
    // confusing place instead of here.
    expect(typeof GameRepository).toBe('function');
    for (const method of [
      'getLocationCandidates',
      'getDateCandidates',
      'getRecentlyUsedAssetIds',
      'createChallenge',
      'getChallenge',
      'getChallengesForSpace',
      'getRounds',
      'getRound',
      'getGuessesForUser',
      'createGuess',
      'getLeaderboard',
      'deleteChallenge',
    ]) {
      expect(typeof GameRepository.prototype[method as keyof GameRepository]).toBe('function');
    }
  });
});
