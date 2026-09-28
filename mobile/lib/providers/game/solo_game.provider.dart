import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/repositories/solo_game_api.repository.dart';
import 'package:openapi/api.dart';

/// How many past games one page of solo history holds.
///
/// Shared by the first page (fetched through [soloHistoryProvider]) and every "load more" the page
/// asks for directly — asking for different sizes would make the pages different lengths and the
/// `hasNextPage` flag they come back with meaningless.
const int kSoloHistoryPageSize = 10;

/// Today's personal daily, or null when the player's library cannot fill one.
///
/// Reading this GENERATES the daily server-side, which runs the candidate queries and the CLIP
/// prompts. It is watched unconditionally because it is the reason the page exists, but that cost
/// is why nothing else on the page waits on it.
final soloDailyProvider = FutureProvider<GameChallengeListItemResponseDto?>((ref) {
  return ref.watch(soloGameApiRepositoryProvider).getDaily();
});

final soloStatsProvider = FutureProvider<GameSoloStatsResponseDto>((ref) {
  return ref.watch(soloGameApiRepositoryProvider).getStats();
});

/// The FIRST page of history only. Later pages are fetched by the page itself and held in its own
/// state — a family keyed by page number would leave each page cached independently, so a game
/// played after the fact would push every row down by one and duplicate a row across the seam.
final soloHistoryProvider = FutureProvider<GameSoloHistoryResponseDto>((ref) {
  return ref.watch(soloGameApiRepositoryProvider).getHistory(page: 1, size: kSoloHistoryPageSize);
});

/// Refreshes everything a play session can have changed.
///
/// Call this when returning from the play route. Playing moves all three of these at once and the
/// player lands back on a surface showing all three: the daily's `answered` count (which is what
/// flips the card from Play to a countdown), the stats, and history's newest row. None is
/// push-updated — they are plain `FutureProvider`s whose cached value survives the pop — so
/// without this the page redraws the pre-play snapshot and a finished daily still reads "Play".
void invalidateSoloGames(WidgetRef ref) {
  ref.invalidate(soloDailyProvider);
  ref.invalidate(soloStatsProvider);
  ref.invalidate(soloHistoryProvider);
}
