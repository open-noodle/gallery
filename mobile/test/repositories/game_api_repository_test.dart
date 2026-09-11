import 'package:flutter_test/flutter_test.dart';
import 'package:immich_mobile/repositories/game_api.repository.dart';
import 'package:immich_mobile/services/api.service.dart';
import 'package:mocktail/mocktail.dart';
import 'package:openapi/api.dart';

class _MockApiService extends Mock implements ApiService {}

class _MockGamesApi extends Mock implements GamesApi {}

void main() {
  late _MockApiService apiService;
  late _MockGamesApi gamesApi;
  late GameApiRepository repository;

  setUpAll(() {
    registerFallbackValue(GameCreateDto());
    registerFallbackValue(GameGuessDto());
  });

  setUp(() {
    apiService = _MockApiService();
    gamesApi = _MockGamesApi();
    when(() => apiService.gamesApi).thenReturn(gamesApi);
    repository = GameApiRepository(apiService);
  });

  test('getDaily returns null when the space has no daily today', () async {
    when(() => gamesApi.getDailyChallenge('space-1')).thenAnswer((_) async => GameDailyResponseDto(challenge: null));

    expect(await repository.getDaily('space-1'), isNull);
  });

  test('a location guess sends lat and lon and leaves date absent', () async {
    when(() => gamesApi.guessRound(any(), any(), any())).thenAnswer(
      (_) async => GameGuessResponseDto(
        distanceKm: null,
        guessDate: null,
        guessLat: null,
        guessLon: null,
        offsetDays: null,
        roundId: 'r',
        score: 4000,
        userId: 'u',
      ),
    );

    await repository.guessLocation('challenge-1', 2, lat: 12.5, lon: -3.25);

    final dto = verify(() => gamesApi.guessRound('challenge-1', 2, captureAny())).captured.single as GameGuessDto;
    expect(dto.lat.orElse(null), 12.5);
    expect(dto.lon.orElse(null), -3.25);
    expect(dto.date.isPresent, isFalse, reason: 'A location guess must not carry a date at all');
  });

  test('a date guess sends the date and leaves lat/lon absent', () async {
    when(() => gamesApi.guessRound(any(), any(), any())).thenAnswer(
      (_) async => GameGuessResponseDto(
        distanceKm: null,
        guessDate: null,
        guessLat: null,
        guessLon: null,
        offsetDays: null,
        roundId: 'r',
        score: 3000,
        userId: 'u',
      ),
    );

    await repository.guessDate('challenge-1', 0, utcMonthStart: DateTime.utc(2019, 7, 1));

    final dto = verify(() => gamesApi.guessRound('challenge-1', 0, captureAny())).captured.single as GameGuessDto;
    expect(dto.date.orElse(null), DateTime.utc(2019, 7, 1));
    expect(dto.lat.isPresent, isFalse, reason: 'A date guess must not carry a latitude at all');
    expect(dto.lon.isPresent, isFalse, reason: 'A date guess must not carry a longitude at all');
  });

  test('createChallenge sends the requested round count and type', () async {
    when(() => gamesApi.createChallenge(any(), any())).thenAnswer(
      (_) async => GameChallengeResponseDto(
        id: 'c',
        spaceId: 'space-1',
        ownerId: null,
        name: 'Challenge 1',
        roundCount: 5,
        dailyOn: null,
        scaleKm: 1,
        scaleDays: 1,
        createdAt: DateTime.utc(2026),
      ),
    );

    await repository.createChallenge('space-1', roundCount: 10, type: GameChallengeType.date);

    final dto = verify(() => gamesApi.createChallenge('space-1', captureAny())).captured.single as GameCreateDto;
    expect(dto.roundCount.orElse(null), 10);
    expect(dto.type.orElse(null), GameChallengeType.date);
  });

  test('a null body from a non-nullable endpoint is an error, not a silent null', () async {
    when(() => gamesApi.getChallenge('missing')).thenAnswer((_) async => null);

    expect(repository.getChallenge('missing'), throwsA(isA<Exception>()));
  });
}
