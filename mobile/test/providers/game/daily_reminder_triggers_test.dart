import 'package:flutter_test/flutter_test.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/providers/game/daily_reminder.provider.dart';
import 'package:immich_mobile/providers/game/game_session.provider.dart';
import 'package:immich_mobile/repositories/game_api.repository.dart';
import 'package:mocktail/mocktail.dart';
import 'package:openapi/api.dart';

class _MockController extends Mock implements DailyReminderController {}

class _MockGameApiRepository extends Mock implements GameApiRepository {}

void main() {
  test('finishing a daily reports its completion to the reminder', () async {
    final reminder = _MockController();
    when(() => reminder.recordDailyCompleted(any(), isSolo: any(named: 'isSolo'))).thenAnswer((_) async {});

    final repository = _MockGameApiRepository();
    var fetches = 0;
    when(() => repository.getChallenge('c1')).thenAnswer((_) async {
      fetches++;
      return GameChallengeDetailResponseDto(
        id: 'c1',
        spaceId: 's1',
        ownerId: null,
        name: 'daily',
        roundCount: 1,
        scaleKm: 1,
        scaleDays: 1,
        createdAt: DateTime.utc(2026, 8, 18),
        closedAt: null,
        dailyOn: DateTime.utc(2026, 8, 18),
        rounds: [
          GameRoundDetailResponseDto(
            index: 0,
            type: GameRoundType.location,
            score: fetches == 1 ? const Optional.absent() : const Optional.present(10),
          ),
        ],
      );
    });
    when(
      () => repository.guessLocation(
        any(),
        any(),
        lat: any(named: 'lat'),
        lon: any(named: 'lon'),
      ),
    ).thenAnswer(
      (_) async => GameGuessResponseDto(
        roundId: 'r',
        userId: 'u',
        score: 10,
        distanceKm: null,
        guessDate: null,
        guessLat: null,
        guessLon: null,
        offsetDays: null,
      ),
    );
    when(() => repository.getLeaderboard(any())).thenAnswer((_) async => GameLeaderboardResponseDto(entries: []));

    final container = ProviderContainer(
      overrides: [
        gameApiRepositoryProvider.overrideWithValue(repository),
        dailyReminderProvider.overrideWithValue(reminder),
      ],
    );
    addTearDown(container.dispose);

    await container.read(gameSessionProvider('c1').future);
    final controller = container.read(gameSessionProvider('c1').notifier)
      ..onDailyCompleted = (dailyOn, {required isSolo}) =>
          container.read(dailyReminderProvider).recordDailyCompleted(dailyOn, isSolo: isSolo);
    await controller.guessLocation(lat: 1, lon: 1);
    controller.next();
    await Future<void>.delayed(Duration.zero);

    // spaceId: 's1' above makes this a SPACE daily, not solo.
    verify(() => reminder.recordDailyCompleted(DateTime.utc(2026, 8, 18), isSolo: false)).called(1);
  });
}
