import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/providers/api.provider.dart';
import 'package:immich_mobile/repositories/api.repository.dart';
import 'package:immich_mobile/services/api.service.dart';
import 'package:openapi/api.dart';

final gameApiRepositoryProvider = Provider((ref) => GameApiRepository(ref.watch(apiServiceProvider)));

/// The only place in the app that talks to [GamesApi].
///
/// Mirrors SharedSpaceApiRepository, including the lazy `_api` getter: `ApiService.setEndpoint()`
/// reassigns the `*Api` fields to new instances tied to a fresh ApiClient, so capturing `gamesApi`
/// once would pin this repository to a stale client if it is first read before login.
class GameApiRepository extends ApiRepository {
  final ApiService _apiService;

  GameApiRepository(this._apiService);

  GamesApi get _api => _apiService.gamesApi;

  /// Today's daily for [spaceId], or null when the space has none.
  ///
  /// Reading this GENERATES the daily server-side when the space has opted in and none exists yet.
  /// For a space that has not opted in, the server returns a null challenge immediately, before any
  /// generation or DB write, so calling this unconditionally is cheap and harmless.
  Future<GameChallengeListItemResponseDto?> getDaily(String spaceId) async {
    final response = await checkNull(_api.getDailyChallenge(spaceId));
    return response.challenge;
  }

  /// Custom challenges only — the server excludes dailies from this list.
  Future<List<GameChallengeListItemResponseDto>> getChallenges(String spaceId) async {
    return await checkNull(_api.getChallenges(spaceId));
  }

  Future<GameChallengeDetailResponseDto> getChallenge(String id) async {
    return await checkNull(_api.getChallenge(id));
  }

  /// A location guess. `date` stays absent — sending all three fields would describe a guess of
  /// both kinds at once.
  Future<GameGuessResponseDto> guessLocation(String id, int index, {required double lat, required double lon}) async {
    final dto = GameGuessDto(lat: Optional.present(lat), lon: Optional.present(lon));
    return await checkNull(_api.guessRound(id, index, dto));
  }

  /// A date guess. [utcMonthStart] must be the 1st of the guessed month at midnight UTC — the
  /// server grades at month granularity, and a local-midnight DateTime lands in the previous month
  /// at a boundary.
  Future<GameGuessResponseDto> guessDate(String id, int index, {required DateTime utcMonthStart}) async {
    final dto = GameGuessDto(date: Optional.present(utcMonthStart));
    return await checkNull(_api.guessRound(id, index, dto));
  }

  Future<GameLeaderboardResponseDto> getLeaderboard(String id) async {
    return await checkNull(_api.getLeaderboard(id));
  }

  Future<GameStandingsResponseDto> getStandings(String spaceId) async {
    return await checkNull(_api.getStandings(spaceId));
  }

  Future<GameChallengeResponseDto> createChallenge(
    String spaceId, {
    required int roundCount,
    required GameChallengeType type,
  }) async {
    final dto = GameCreateDto(roundCount: Optional.present(roundCount), type: Optional.present(type));
    return await checkNull(_api.createChallenge(spaceId, dto));
  }

  Future<void> deleteChallenge(String id) => _api.deleteChallenge(id);
}
