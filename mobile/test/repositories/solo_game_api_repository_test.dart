import 'package:flutter_test/flutter_test.dart';
import 'package:immich_mobile/constants/errors.dart';
import 'package:immich_mobile/repositories/solo_game_api.repository.dart';
import 'package:immich_mobile/services/api.service.dart';
import 'package:mocktail/mocktail.dart';
import 'package:openapi/api.dart';

class _MockApiService extends Mock implements ApiService {}

class _MockGamesApi extends Mock implements GamesApi {}

void main() {
  late _MockApiService apiService;
  late _MockGamesApi gamesApi;
  late SoloGameApiRepository repository;

  setUpAll(() {
    registerFallbackValue(GameSoloCreateDto());
  });

  setUp(() {
    apiService = _MockApiService();
    gamesApi = _MockGamesApi();
    when(() => apiService.gamesApi).thenReturn(gamesApi);
    repository = SoloGameApiRepository(apiService);
  });

  test('getDaily returns null when the library cannot fill one today', () async {
    when(() => gamesApi.getSoloDailyChallenge()).thenAnswer((_) async => GameDailyResponseDto(challenge: null));

    expect(await repository.getDaily(), isNull);
  });

  test('a solo create never sends sources', () async {
    when(() => gamesApi.createSoloChallenge(any())).thenAnswer(
      (_) async => GameChallengeResponseDto(
        id: 'c1',
        spaceId: null,
        ownerId: 'u1',
        name: 'c1',
        roundCount: 5,
        scaleKm: 1,
        scaleDays: 1,
        createdAt: DateTime.utc(2026, 8, 19),
        dailyOn: null,
      ),
    );

    await repository.create(roundCount: 10, type: GameChallengeType.location);

    final dto = verify(() => gamesApi.createSoloChallenge(captureAny())).captured.single as GameSoloCreateDto;
    expect(dto.roundCount.orElse(null), 10);
    expect(dto.type.orElse(null), GameChallengeType.location);
    // Absent, not `{false, false}`: absent is what makes the server fall back to the player's
    // stored source preference — the same preference their daily is generated from. Sending an
    // override from a client that cannot read that preference would silently narrow the pool for
    // anyone who had widened it elsewhere.
    expect(dto.sources.isPresent, isFalse);
  });

  test('history asks for the page and size it was given', () async {
    when(
      () => gamesApi.getSoloHistory(
        page: any(named: 'page'),
        size: any(named: 'size'),
      ),
    ).thenAnswer((_) async => GameSoloHistoryResponseDto(hasNextPage: false, items: []));

    await repository.getHistory(page: 3, size: 10);

    verify(() => gamesApi.getSoloHistory(page: 3, size: 10)).called(1);
  });

  test('a null body is an error, not a silently empty stats panel', () async {
    when(() => gamesApi.getSoloStats()).thenAnswer((_) async => null);

    expect(repository.getStats(), throwsA(isA<NoResponseDtoError>()));
  });
}
