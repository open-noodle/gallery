import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/providers/api.provider.dart';
import 'package:immich_mobile/repositories/api.repository.dart';
import 'package:immich_mobile/services/api.service.dart';
import 'package:openapi/api.dart';

final soloGameApiRepositoryProvider = Provider((ref) => SoloGameApiRepository(ref.watch(apiServiceProvider)));

/// The solo half of `GamesApi` — the games a player owns rather than a space's.
///
/// Kept apart from `GameApiRepository` rather than folded into it: every method there takes a
/// space id, and a repository whose methods differ on whether that argument exists is the shape
/// that lets a solo call reach a space endpoint by accident. The two halves share the generated
/// api and nothing else.
///
/// Same lazy `_api` getter as its sibling: `ApiService.setEndpoint()` reassigns the `*Api` fields
/// to new instances tied to a fresh ApiClient, so capturing `gamesApi` once would pin this
/// repository to a stale client if it is first read before login.
class SoloGameApiRepository extends ApiRepository {
  final ApiService _apiService;

  SoloGameApiRepository(this._apiService);

  GamesApi get _api => _apiService.gamesApi;

  /// Today's personal daily, or null when the player's own library cannot fill one.
  ///
  /// Reading this GENERATES the daily server-side when none exists yet, from the player's STORED
  /// source preference — not from anything this client sends. That is why a null here must not be
  /// reported with the copy that offers the per-game source toggles as the remedy: they would not
  /// change this call's outcome.
  Future<GameChallengeListItemResponseDto?> getDaily() async {
    final response = await checkNull(_api.getSoloDailyChallenge());
    return response.challenge;
  }

  /// Zeroes, never nulls, for a player who has never played.
  Future<GameSoloStatsResponseDto> getStats() async {
    return await checkNull(_api.getSoloStats());
  }

  /// One page of past games, newest first. [page] is 1-based.
  Future<GameSoloHistoryResponseDto> getHistory({required int page, required int size}) async {
    return await checkNull(_api.getSoloHistory(page: page, size: size));
  }

  /// A free-play game.
  ///
  /// `sources` is deliberately never sent: absent, the server falls back to the player's stored
  /// PhotoGuesser preference, which is also what generates their daily. Sending a per-game
  /// override from a client that cannot read that preference would silently narrow the pool for
  /// anyone who had widened it elsewhere.
  Future<GameChallengeResponseDto> create({required int roundCount, required GameChallengeType type}) async {
    final dto = GameSoloCreateDto(roundCount: Optional.present(roundCount), type: Optional.present(type));
    return await checkNull(_api.createSoloChallenge(dto));
  }
}
