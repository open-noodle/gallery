import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/repositories/game_api.repository.dart';
import 'package:openapi/api.dart';

/// Today's daily for a space, or null when it has none.
///
/// Reading this generates the daily server-side, so only watch it for a space whose
/// `dailyChallengeEnabled` is true.
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
