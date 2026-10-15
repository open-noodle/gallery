import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/repositories/game_api.repository.dart';
import 'package:openapi/api.dart';

/// Today's daily for a space, or null when it has none.
///
/// Reading this generates the daily server-side when the space has opted in and none exists yet.
/// For a space that has not opted in, the server returns a null challenge immediately, before any
/// generation or DB write, so watching this unconditionally is cheap and harmless.
final gameDailyProvider = FutureProvider.family<GameChallengeListItemResponseDto?, String>((ref, spaceId) {
  return ref.watch(gameApiRepositoryProvider).getDaily(spaceId);
});

final gameChallengesProvider = FutureProvider.family<List<GameChallengeListItemResponseDto>, String>((ref, spaceId) {
  return ref.watch(gameApiRepositoryProvider).getChallenges(spaceId);
});

final gameStandingsProvider = FutureProvider.family<GameStandingsResponseDto, String>((ref, spaceId) {
  return ref.watch(gameApiRepositoryProvider).getStandings(spaceId);
});

final gameLeaderboardProvider = FutureProvider.family<GameLeaderboardResponseDto, String>((ref, challengeId) {
  return ref.watch(gameApiRepositoryProvider).getLeaderboard(challengeId);
});

/// Refreshes everything a play session can have changed for [spaceId].
///
/// Call this when returning from the play route. Playing moves three independent reads at once,
/// and the player lands back on a surface showing all of them: the daily's `answered` count (which
/// is what flips the card from Play to Leaderboard), the challenge list's per-challenge progress,
/// and the month's standings. None of these is push-updated - they are plain `FutureProvider`s
/// whose cached value survives the pop - so without this the space page keeps rendering the
/// pre-play snapshot, and a completed daily still reads "Play".
///
/// Keyed by space: another space's cached game state is left alone.
void invalidateSpaceGames(WidgetRef ref, String spaceId) {
  ref.invalidate(gameDailyProvider(spaceId));
  ref.invalidate(gameChallengesProvider(spaceId));
  ref.invalidate(gameStandingsProvider(spaceId));
}
