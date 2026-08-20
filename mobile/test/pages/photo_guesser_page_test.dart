import 'dart:async';

import 'package:drift/drift.dart' as drift;
import 'package:drift/native.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/domain/models/store.model.dart';
import 'package:immich_mobile/domain/services/store.service.dart';
import 'package:immich_mobile/entities/store.entity.dart';
import 'package:immich_mobile/infrastructure/repositories/db.repository.dart';
import 'package:immich_mobile/infrastructure/repositories/store.repository.dart';
import 'package:immich_mobile/pages/games/photo_guesser.page.dart';
import 'package:immich_mobile/providers/game/daily_reminder.provider.dart';
import 'package:immich_mobile/providers/game/solo_game.provider.dart';
import 'package:immich_mobile/repositories/solo_game_api.repository.dart';
import 'package:mocktail/mocktail.dart';
import 'package:openapi/api.dart';

import '../test_utils.dart';
import '../widget_tester_extensions.dart';

class _MockSoloGameApiRepository extends Mock implements SoloGameApiRepository {}

class _MockDailyReminderController extends Mock implements DailyReminderController {}

/// A solo daily: `spaceId` null, owned by the player.
GameChallengeListItemResponseDto _daily({required int answered, int roundCount = 5}) =>
    GameChallengeListItemResponseDto(
      id: 'daily-1',
      spaceId: null,
      ownerId: 'u1',
      // The raw UTC date the server stores to keep the column non-null — never a title.
      name: '2026-08-19',
      roundCount: roundCount,
      locationRoundCount: 3,
      answered: answered,
      total: 4200,
      scaleKm: 1,
      scaleDays: 1,
      createdAt: DateTime.utc(2026, 8, 19),
      closedAt: null,
      dailyOn: DateTime.utc(2026, 8, 19),
    );

GameSoloStatsResponseDto _stats({
  num currentStreak = 0,
  num bestStreak = 0,
  num bestScore = 0,
  num averageScore = 0,
  num gamesPlayed = 0,
}) => GameSoloStatsResponseDto(
  currentStreak: currentStreak,
  bestStreak: bestStreak,
  bestScore: bestScore,
  averageScore: averageScore,
  gamesPlayed: gamesPlayed,
);

GameSoloHistoryItemResponseDto _historyItem({
  required String id,
  String name = 'Mixed',
  DateTime? dailyOn,
  num total = 4200,
  num answered = 5,
  num roundCount = 5,
}) => GameSoloHistoryItemResponseDto(
  id: id,
  name: name,
  dailyOn: dailyOn,
  createdAt: DateTime.utc(2026, 8, 17),
  total: total,
  answered: answered,
  roundCount: roundCount,
);

void main() {
  // The daily card builds a RemoteImageProvider URL through getGameRoundImageUrl, which reads
  // Store.get(StoreKey.serverEndpoint) and throws unless the Store is initialized. Mirrors
  // space_games_page_test.dart.
  late Drift db;

  setUpAll(() async {
    TestWidgetsFlutterBinding.ensureInitialized();
    TestUtils.init();
    // mocktail needs a fallback instance for a non-primitive type before `any(named: 'type')` can
    // stand in for it.
    registerFallbackValue(GameChallengeType.mixed);
    db = Drift(drift.DatabaseConnection(NativeDatabase.memory(), closeStreamsSynchronously: true));
    await StoreService.init(storeRepository: DriftStoreRepository(db), listenUpdates: false);
  });

  setUp(() async {
    await Store.clear();
    await Store.put(StoreKey.serverEndpoint, 'http://localhost:0');
  });

  tearDownAll(() async {
    await Store.clear();
    await db.close();
  });

  /// Note what is NOT here: no space provider, no space id, no membership. That absence is the
  /// point — PhotoGuesser is the solo scope, and every test below therefore proves the surface
  /// stands up for a player who belongs to no shared space at all.
  ///
  /// `dailyReminderProvider` is always stubbed here, even though most tests never look at it: the
  /// page listens for the solo daily resolving to null and reports it to the reminder (see
  /// photo_guesser.page.dart), so any test that pumps with `daily: null` would otherwise reach the
  /// REAL `DailyReminderController` and its settings/spaces dependencies, neither of which this
  /// file sets up. A caller that wants to assert against the reminder passes its own mock via
  /// `extraOverrides`, which — being later in the overrides list — wins over this default.
  Future<void> pump(
    WidgetTester tester, {
    GameChallengeListItemResponseDto? daily,
    Object? dailyError,
    GameSoloStatsResponseDto? stats,
    GameSoloHistoryResponseDto? history,
    Object? historyError,
    List<Override> extraOverrides = const [],
  }) {
    final defaultReminder = _MockDailyReminderController();
    when(() => defaultReminder.recordSoloDailyUnavailable(now: any(named: 'now'))).thenAnswer((_) async {});

    return tester.pumpConsumerWidget(
      const PhotoGuesserPage(),
      overrides: [
        if (dailyError != null)
          soloDailyProvider.overrideWith((ref) async => throw dailyError)
        else
          soloDailyProvider.overrideWith((ref) async => daily),
        soloStatsProvider.overrideWith((ref) async => stats ?? _stats()),
        if (historyError != null)
          soloHistoryProvider.overrideWith((ref) async => throw historyError)
        else
          soloHistoryProvider.overrideWith(
            (ref) async => history ?? GameSoloHistoryResponseDto(hasNextPage: false, items: []),
          ),
        dailyReminderProvider.overrideWithValue(defaultReminder),
        ...extraOverrides,
      ],
    );
  }

  /// `ImmichToast` schedules a 3s fluttertoast Timer outside the frame scheduler, so a plain
  /// `pumpAndSettle()` leaves it pending and teardown fails with "A Timer is still pending". Pump
  /// past its lifetime instead. Mirrors `space_games_page_test.dart`.
  Future<void> settleToast(WidgetTester tester) async {
    await tester.pumpAndSettle();
    await tester.pump(const Duration(seconds: 4));
    await tester.pumpAndSettle();
  }

  testWidgets('the whole surface stands up with nothing space-scoped behind it', (tester) async {
    await pump(
      tester,
      daily: _daily(answered: 0),
      stats: _stats(gamesPlayed: 3),
      history: GameSoloHistoryResponseDto(hasNextPage: false, items: [_historyItem(id: 'g1')]),
    );

    expect(find.text('PhotoGuesser'), findsOneWidget, reason: 'the page title');
    expect(find.byKey(const Key('solo-daily-card')), findsOneWidget);
    expect(find.byKey(const Key('solo-start-free-play')), findsOneWidget);
    expect(find.byKey(const Key('solo-stats')), findsOneWidget);
    expect(find.byKey(const Key('solo-history-row-g1')), findsOneWidget);
  });

  group('the daily', () {
    testWidgets('offers Play until it has been finished', (tester) async {
      await pump(tester, daily: _daily(answered: 2));

      expect(find.byKey(const Key('solo-daily-play')), findsOneWidget);
      // Scoped to the card: 'Daily challenge' is also the stats group heading further down.
      expect(
        find.descendant(of: find.byKey(const Key('solo-daily-card')), matching: find.text('Daily challenge')),
        findsOneWidget,
      );
      // Two of five rounds answered — the pips are the only progress the card shows.
      expect(find.byKey(const Key('solo-daily-pip-1')), findsOneWidget);
      expect(find.byKey(const Key('solo-daily-pip-4')), findsOneWidget);
    });

    testWidgets('shows the countdown instead of Play once every round is answered', (tester) async {
      await pump(tester, daily: _daily(answered: 5));

      expect(
        find.byKey(const Key('solo-daily-play')),
        findsNothing,
        reason: 'there is no more of today\'s daily to play',
      );
      // textContaining, not text: the {time} placeholder is read off the real clock. Its presence
      // still proves the key resolved — a wrong arg NAME leaves `.t()` rendering the raw key.
      expect(find.textContaining('Next challenge in'), findsOneWidget);
    });

    testWidgets('with no daily today reads as the solo empty state, not the space or free-play one', (tester) async {
      await pump(tester, daily: null);

      expect(find.byKey(const Key('solo-daily-unavailable')), findsOneWidget);
      expect(find.text('No daily today - add photos with GPS data or capture dates to your library'), findsOneWidget);
      // The split between these three is load-bearing. `game_daily_unavailable` says "to this
      // space", which is nonsense for a player who may be in none. `game_solo_no_photos` offers
      // the create sheet's source toggles as the remedy, and those are a per-game override — the
      // daily is generated from the stored preference, so a player who followed it would get a
      // playable free-play game and this same card, unchanged, forever.
      expect(
        find.textContaining('to this space'),
        findsNothing,
        reason: 'the space daily copy must not reach the solo page',
      );
      expect(
        find.textContaining('No photos available for PhotoGuesser'),
        findsNothing,
        reason: 'the free-play copy points at toggles that cannot change the daily',
      );
    });

    testWidgets('a failed load offers a retry, which a genuine absence does not', (tester) async {
      await pump(tester, dailyError: Exception('offline'));

      expect(find.byKey(const Key('solo-daily-retry')), findsOneWidget);
      expect(find.byKey(const Key('solo-daily-unavailable')), findsNothing);
    });

    // The write side of the Critical reminder fix: without this, soloDailyEnabled being
    // unconditionally true asserted a guarantee the product does not make, and a day the library
    // genuinely could not fill would be permanently unskippable. This is the ONE place that
    // discovers "unavailable" — reading the daily again just to check would be the exact
    // GENERATING call the reminder file avoids everywhere else, so this must piggyback on the
    // fetch the page already makes for its own reasons.
    testWidgets('an unavailable daily reports it to the reminder', (tester) async {
      final reminder = _MockDailyReminderController();
      when(() => reminder.recordSoloDailyUnavailable(now: any(named: 'now'))).thenAnswer((_) async {});

      await pump(tester, daily: null, extraOverrides: [dailyReminderProvider.overrideWithValue(reminder)]);

      verify(() => reminder.recordSoloDailyUnavailable(now: any(named: 'now'))).called(1);
    });

    // The other side of the same wiring: a genuinely available daily — played or not — must NOT
    // be reported as unavailable, or a library that CAN fill a daily would still have its
    // reminder suppressed by a false "unavailable" write.
    testWidgets('an available daily does not report unavailability to the reminder', (tester) async {
      final reminder = _MockDailyReminderController();
      when(() => reminder.recordSoloDailyUnavailable(now: any(named: 'now'))).thenAnswer((_) async {});

      await pump(
        tester,
        daily: _daily(answered: 0),
        extraOverrides: [dailyReminderProvider.overrideWithValue(reminder)],
      );

      verifyNever(() => reminder.recordSoloDailyUnavailable(now: any(named: 'now')));
    });
  });

  group('stats', () {
    testWidgets('separate the streak from the numbers that count every game', (tester) async {
      await pump(
        tester,
        stats: _stats(currentStreak: 4, bestStreak: 9, bestScore: 18420, averageScore: 3100, gamesPlayed: 27),
      );

      // The grouping is the whole point: the streak counts only fully played dailies, the rest
      // count every game with a guess in it, free play included. A tile in the wrong group claims
      // the wrong population — "Best score" under a daily heading would read as "best daily
      // score".
      final dailyGroup = find.byKey(const Key('solo-stats-daily'));
      final allGroup = find.byKey(const Key('solo-stats-all'));

      expect(find.descendant(of: dailyGroup, matching: find.text('Daily challenge')), findsOneWidget);
      expect(
        find.descendant(of: dailyGroup, matching: find.byKey(const Key('solo-stat-current-streak'))),
        findsOneWidget,
      );
      expect(find.descendant(of: dailyGroup, matching: find.byKey(const Key('solo-stat-best-streak'))), findsOneWidget);
      expect(find.descendant(of: dailyGroup, matching: find.byKey(const Key('solo-stat-best-score'))), findsNothing);

      expect(find.descendant(of: allGroup, matching: find.text('All games')), findsOneWidget);
      expect(find.descendant(of: allGroup, matching: find.byKey(const Key('solo-stat-best-score'))), findsOneWidget);
      expect(find.descendant(of: allGroup, matching: find.byKey(const Key('solo-stat-average-score'))), findsOneWidget);
      expect(find.descendant(of: allGroup, matching: find.byKey(const Key('solo-stat-games-played'))), findsOneWidget);
      expect(find.descendant(of: allGroup, matching: find.byKey(const Key('solo-stat-current-streak'))), findsNothing);

      // The labels say which population each number describes, so they have to be the streak-
      // specific ones rather than a bare "Streak".
      expect(find.text('Daily streak'), findsOneWidget);
      expect(find.text('Best daily streak'), findsOneWidget);

      // Grouped digits: `game_points` interpolates verbatim, and an ungrouped 18420 is unreadable.
      expect(find.text('18,420'), findsOneWidget);
    });

    testWidgets('a player who has never played sees zeroes, not an empty panel', (tester) async {
      await pump(tester, stats: _stats());

      // The server returns zeroes, never nulls, so there is no empty state to invent here.
      expect(find.text('0'), findsNWidgets(5));
    });
  });

  group('history', () {
    testWidgets('titles a daily row by what it is rather than by its raw date key', (tester) async {
      await pump(
        tester,
        history: GameSoloHistoryResponseDto(
          hasNextPage: false,
          items: [
            _historyItem(id: 'g1', name: '2026-08-19', dailyOn: DateTime.utc(2026, 8, 19), total: 18420),
            _historyItem(id: 'g2', name: 'Mixed'),
          ],
        ),
      );

      final dailyRow = find.byKey(const Key('solo-history-row-g1'));
      expect(find.descendant(of: dailyRow, matching: find.text('Daily challenge')), findsOneWidget);
      expect(
        find.descendant(of: dailyRow, matching: find.text('2026-08-19')),
        findsNothing,
        reason: 'the stored name is a raw UTC date, identical in every language',
      );
      // The date still has to appear somewhere or every daily row looks the same — the subtitle
      // carries it, alongside the resolved {answered}/{total} placeholders.
      expect(find.descendant(of: dailyRow, matching: find.textContaining('5 of 5 rounds answered')), findsOneWidget);
      expect(find.descendant(of: dailyRow, matching: find.textContaining('Aug 19, 2026')), findsOneWidget);
      expect(find.descendant(of: dailyRow, matching: find.text('18,420 pts')), findsOneWidget);

      expect(
        find.descendant(of: find.byKey(const Key('solo-history-row-g2')), matching: find.text('Mixed')),
        findsOneWidget,
      );
    });

    testWidgets('a failed load keeps its heading and offers a retry', (tester) async {
      await pump(tester, historyError: Exception('offline'));

      // The heading has to survive the failure, or the section simply is not there and the player
      // has nothing to tell a timed-out request from a history they have never filled.
      expect(find.text('Game history'), findsOneWidget);
      expect(find.byKey(const Key('solo-history-retry')), findsOneWidget);
      expect(
        find.byKey(const Key('solo-history-empty')),
        findsNothing,
        reason: 'a failed fetch must not read as "you have played nothing"',
      );
    });

    testWidgets('with no games says so', (tester) async {
      await pump(tester, history: GameSoloHistoryResponseDto(hasNextPage: false, items: []));

      expect(find.byKey(const Key('solo-history-empty')), findsOneWidget);
      expect(find.text('No games played yet'), findsOneWidget);
      expect(find.byKey(const Key('solo-history-load-more')), findsNothing, reason: 'nothing to page through');
    });

    testWidgets('accumulates each page rather than replacing what is already listed', (tester) async {
      final repository = _MockSoloGameApiRepository();
      when(
        () => repository.getHistory(page: 2, size: kSoloHistoryPageSize),
      ).thenAnswer((_) async => GameSoloHistoryResponseDto(hasNextPage: true, items: [_historyItem(id: 'g2')]));
      when(
        () => repository.getHistory(page: 3, size: kSoloHistoryPageSize),
      ).thenAnswer((_) async => GameSoloHistoryResponseDto(hasNextPage: false, items: [_historyItem(id: 'g3')]));

      await pump(
        tester,
        history: GameSoloHistoryResponseDto(hasNextPage: true, items: [_historyItem(id: 'g1')]),
        extraOverrides: [soloGameApiRepositoryProvider.overrideWithValue(repository)],
      );

      // Twice, not once: with a single page loaded, appending and replacing produce the same list,
      // so one tap would leave this passing either way.
      for (var i = 0; i < 2; i++) {
        // The button sits below the fold of the 800x600 test viewport, under the daily and the
        // stats; a tap without this reports "would not receive pointer events" rather than the
        // assertion below.
        await tester.ensureVisible(find.byKey(const Key('solo-history-load-more')));
        await tester.pumpAndSettle();
        await tester.tap(find.byKey(const Key('solo-history-load-more')));
        await tester.pumpAndSettle();
      }

      expect(find.byKey(const Key('solo-history-row-g1')), findsOneWidget, reason: 'page 1 must survive');
      expect(find.byKey(const Key('solo-history-row-g2')), findsOneWidget, reason: 'page 2 must survive page 3');
      expect(find.byKey(const Key('solo-history-row-g3')), findsOneWidget);
      // The last page's own flag now governs, not page 1's — page 1 said there was more, and by
      // page 3 there is not.
      expect(find.byKey(const Key('solo-history-load-more')), findsNothing);
      verify(() => repository.getHistory(page: 2, size: kSoloHistoryPageSize)).called(1);
      verify(() => repository.getHistory(page: 3, size: kSoloHistoryPageSize)).called(1);
    });
  });

  group('free play', () {
    testWidgets('opens the create sheet', (tester) async {
      await pump(tester);

      expect(find.byKey(const Key('create-submit')), findsNothing);

      await tester.tap(find.byKey(const Key('solo-start-free-play')));
      await tester.pumpAndSettle();

      expect(find.byKey(const Key('create-submit')), findsOneWidget);
    });

    /// `pump()`, never `pumpAndSettle()`, while the spinner is up: it animates forever, so
    /// settling would time out rather than fail on the assertion.
    ///
    /// The create is finished with a FAILURE rather than a challenge, and not because the failure
    /// is what is being asserted: a successful create pushes the play route, and a widget test has
    /// no auto_route Router to push into. That success path — create, then navigate — is the one
    /// part of this page no widget test here covers.
    testWidgets('shows the wait, shuts the control, and clears both when the create ends', (tester) async {
      final completer = Completer<GameChallengeResponseDto>();
      final repository = _MockSoloGameApiRepository();
      when(
        () => repository.create(
          roundCount: any(named: 'roundCount'),
          type: any(named: 'type'),
        ),
      ).thenAnswer((_) => completer.future);

      await pump(tester, extraOverrides: [soloGameApiRepositoryProvider.overrideWithValue(repository)]);

      await tester.tap(find.byKey(const Key('solo-start-free-play')));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('create-submit')));
      await tester.pump();

      expect(find.byKey(const Key('solo-creating')), findsOneWidget);
      expect(
        tester.widget<FilledButton>(find.byKey(const Key('solo-start-free-play'))).onPressed,
        isNull,
        reason: 'a second tap here would create a second game from one intent',
      );

      completer.completeError(Exception('offline'));
      await tester.pumpAndSettle();

      expect(
        find.byKey(const Key('solo-creating')),
        findsNothing,
        reason: 'a failure must clear the wait rather than leave it spinning forever',
      );
      expect(tester.widget<FilledButton>(find.byKey(const Key('solo-start-free-play'))).onPressed, isNotNull);

      await settleToast(tester);
    });

    testWidgets('a rejected create blames the library, not the network', (tester) async {
      final repository = _MockSoloGameApiRepository();
      // A real server rejection: nothing in the pool can fill a round of the requested kind.
      when(
        () => repository.create(
          roundCount: any(named: 'roundCount'),
          type: any(named: 'type'),
        ),
      ).thenThrow(ApiException(400, '{"message":"no candidates"}'));

      await pump(tester, extraOverrides: [soloGameApiRepositoryProvider.overrideWithValue(repository)]);

      await tester.tap(find.byKey(const Key('solo-start-free-play')));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('create-submit')));
      await tester.pumpAndSettle();

      // Proves the localized key resolved rather than the raw key rendering, and that the create
      // path — not the daily card — is where this copy belongs.
      expect(find.textContaining('No photos available for PhotoGuesser'), findsOneWidget);
      // The page is not left broken: the control is back for another attempt.
      expect(tester.widget<FilledButton>(find.byKey(const Key('solo-start-free-play'))).onPressed, isNotNull);

      await settleToast(tester);
    });
  });
}
