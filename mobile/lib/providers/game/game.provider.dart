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
