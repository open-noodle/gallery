import 'dart:async';

import 'package:drift/drift.dart' as drift;
import 'package:drift/native.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/domain/models/store.model.dart';
import 'package:immich_mobile/domain/models/user.model.dart';
import 'package:immich_mobile/domain/services/store.service.dart';
import 'package:immich_mobile/domain/services/user.service.dart';
import 'package:immich_mobile/entities/store.entity.dart';
import 'package:immich_mobile/infrastructure/repositories/db.repository.dart';
import 'package:immich_mobile/infrastructure/repositories/store.repository.dart';
import 'package:immich_mobile/pages/library/spaces/games/space_games.page.dart';
import 'package:immich_mobile/presentation/widgets/games/challenge_card.widget.dart';
import 'package:immich_mobile/providers/game/game.provider.dart';
import 'package:immich_mobile/providers/game/hidden_daily_banner.provider.dart';
import 'package:immich_mobile/providers/shared_space.provider.dart';
import 'package:immich_mobile/providers/user.provider.dart';
import 'package:immich_mobile/repositories/game_api.repository.dart';
import 'package:immich_mobile/repositories/shared_space_api.repository.dart';
import 'package:mocktail/mocktail.dart';
import 'package:openapi/api.dart';

import '../../../test_utils.dart';
import '../../../widget_tester_extensions.dart';

class _MockUserService extends Mock implements UserService {}

class _MockGameApiRepository extends Mock implements GameApiRepository {}

class _MockSharedSpaceApiRepository extends Mock implements SharedSpaceApiRepository {}

class _FakeHiddenDailyBannerPrefs implements HiddenDailyBannerPrefs {
  Set<String> stored;
  Set<String>? lastSaved;
  _FakeHiddenDailyBannerPrefs(this.stored);
  @override
  Set<String> loadHidden() => stored;
  @override
  Future<void> saveHidden(Set<String> spaceIds) async {
    lastSaved = spaceIds;
    stored = spaceIds;
  }
}

/// Test-local stand-in for the real [CurrentUserProvider] (mirrors
/// `shared_space_provider_test.dart`'s `MockCurrentUserProvider`): the real notifier's constructor
/// calls `tryGetMyUser()`/`watchMyUser()` on a `UserService` backed by Isar/Drift, which this
/// widget test never stands up. A bare unstubbed mock would also crash — mocktail returns null for
/// an unstubbed method, which is invalid for `watchMyUser()`'s non-nullable `Stream<UserDto?>`
/// return type — so both are stubbed before `state` is overwritten with [initial].
class _StubCurrentUserNotifier extends CurrentUserProvider {
  _StubCurrentUserNotifier([UserDto? initial]) : super(_noopUserService()) {
    state = initial;
  }

  static UserService _noopUserService() {
    final service = _MockUserService();
    when(() => service.tryGetMyUser()).thenReturn(null);
    when(() => service.watchMyUser()).thenAnswer((_) => const Stream<UserDto?>.empty());
    return service;
  }
}

UserDto _user(String id) => UserDto(id: id, email: '$id@example.com', name: id, profileChangedAt: DateTime(2024));

GameChallengeListItemResponseDto _challenge(String id) => GameChallengeListItemResponseDto(
  id: id,
  spaceId: 's1',
  ownerId: null,
  name: id,
  roundCount: 5,
  locationRoundCount: 3,
  answered: 0,
  total: 0,
  scaleKm: 1,
  scaleDays: 1,
  createdAt: DateTime.utc(2026, 8, 18),
  // `closedAt`/`dailyOn` are `required` (though nullable) constructor params on the generated DTO
  // — the brief's helper omitted them, which does not compile against this checkout's SDK.
  closedAt: null,
  dailyOn: null,
);

void main() {
  // The page mounts DailySlot/ChallengeCard, both of which build a RemoteImageProvider URL via
  // getGameRoundImageUrl — that reads Store.get(StoreKey.serverEndpoint), which throws unless the
  // Store is initialized. Mirrors daily_challenge_card_test.dart, the closest sibling.
  late Drift db;

  setUpAll(() async {
    TestWidgetsFlutterBinding.ensureInitialized();
    TestUtils.init();
    // mocktail's `any(named: ...)` needs a fallback instance for a non-primitive type like
    // GameChallengeType before it can be used in a `when()` stub.
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

  Future<void> pump(
    WidgetTester tester, {
    required bool canEdit,
    List<GameChallengeListItemResponseDto> challenges = const [],
    Object? challengesError,
    List<Override> extraOverrides = const [],
  }) => tester.pumpConsumerWidget(
    SpaceGamesPage(spaceId: 's1', canEdit: canEdit),
    overrides: [
      currentUserProvider.overrideWith((ref) => _StubCurrentUserNotifier(_user('u1'))),
      gameDailyProvider('s1').overrideWith((ref) async => null),
      gameStandingsProvider('s1').overrideWith((ref) async => GameStandingsResponseDto(month: '2026-08', entries: [])),
      if (challengesError != null)
        gameChallengesProvider('s1').overrideWith((ref) async => throw challengesError)
      else
        gameChallengesProvider('s1').overrideWith((ref) async => challenges),
      ...extraOverrides,
    ],
  );

  /// `ImmichToast` schedules a 3s fluttertoast Timer outside the frame scheduler, so a plain
  /// `pumpAndSettle()` leaves it pending and teardown fails with "A Timer is still pending". Pump
  /// past its lifetime instead. Mirrors `game_play_page_test.dart`'s `settleToast`.
  Future<void> settleToast(WidgetTester tester) async {
    await tester.pumpAndSettle();
    await tester.pump(const Duration(seconds: 4));
    await tester.pumpAndSettle();
  }

  group("hiding this space's daily banner", () {
    // The banner lives on the SPACE TIMELINE, not on this page — this page only carries the
    // control. So these assert on what the control offers and what it writes, and
    // space_detail_top_sliver_test.dart asserts that the written value removes the banner.
    SharedSpaceResponseDto space({required bool? dailyChallengeEnabled}) => SharedSpaceResponseDto(
      id: 's1',
      name: 'Family Photos',
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
      createdById: 'u1',
      dailyChallengeEnabled: dailyChallengeEnabled == null
          ? const Optional.absent()
          : Optional.present(dailyChallengeEnabled),
    );

    Future<void> pumpWithBanner(
      WidgetTester tester, {
      required _FakeHiddenDailyBannerPrefs prefs,
      bool canEdit = true,
      bool? dailyChallengeEnabled = true,
    }) => pump(
      tester,
      canEdit: canEdit,
      extraOverrides: [
        sharedSpaceProvider('s1').overrideWith((ref) async => space(dailyChallengeEnabled: dailyChallengeEnabled)),
        hiddenDailyBannerPrefsProvider.overrideWithValue(prefs),
      ],
    );

    testWidgets('offers Hide while the banner shows, and persists this space on tap', (tester) async {
      final prefs = _FakeHiddenDailyBannerPrefs({});
      await pumpWithBanner(tester, prefs: prefs);

      await tester.tap(find.byKey(const Key('space-games-daily-banner-menu')));
      await tester.pumpAndSettle();

      expect(find.byKey(const Key('space-games-daily-banner-hide')), findsOneWidget);
      await tester.tap(find.byKey(const Key('space-games-daily-banner-hide')));
      await tester.pumpAndSettle();

      expect(prefs.lastSaved, {'s1'});
    });

    testWidgets('offers Show once hidden, and clears this space on tap', (tester) async {
      final prefs = _FakeHiddenDailyBannerPrefs({'s1'});
      await pumpWithBanner(tester, prefs: prefs);

      await tester.tap(find.byKey(const Key('space-games-daily-banner-menu')));
      await tester.pumpAndSettle();

      expect(find.byKey(const Key('space-games-daily-banner-show')), findsOneWidget);
      await tester.tap(find.byKey(const Key('space-games-daily-banner-show')));
      await tester.pumpAndSettle();

      expect(prefs.lastSaved, isEmpty);
    });

    // Personal display choice, not a space setting: a viewer cannot turn the space's daily off,
    // but they can keep its banner off their own timeline.
    testWidgets('a viewer gets the control too', (tester) async {
      final prefs = _FakeHiddenDailyBannerPrefs({});
      await pumpWithBanner(tester, prefs: prefs, canEdit: false);

      expect(find.byKey(const Key('space-games-daily-banner-menu')), findsOneWidget);
    });

    // A space that has declined the daily renders no slot on its timeline at all, so offering to
    // hide one would be a control that visibly does nothing.
    testWidgets('no control when this space shows no banner to hide', (tester) async {
      final prefs = _FakeHiddenDailyBannerPrefs({});
      await pumpWithBanner(tester, prefs: prefs, dailyChallengeEnabled: false);

      expect(find.byKey(const Key('space-games-daily-banner-menu')), findsNothing);
    });

    // ...and an un-asked space is the other half of that, for EITHER role. The opt-in prompt is a
    // Challenges-page surface now, so nothing sits above anyone's photos until the space opts in —
    // and offering to hide a banner that is not there would be a control that does nothing.
    for (final canEdit in [true, false]) {
      testWidgets('no control for a space that has never been asked (canEdit: $canEdit)', (tester) async {
        final prefs = _FakeHiddenDailyBannerPrefs({});
        await pumpWithBanner(tester, prefs: prefs, canEdit: canEdit, dailyChallengeEnabled: null);

        expect(find.byKey(const Key('space-games-daily-banner-menu')), findsNothing);
      });
    }

    // The prompt itself has NOT gone away — it just lives here now, and only here.
    testWidgets('an un-asked space still prompts an editor on this page', (tester) async {
      final prefs = _FakeHiddenDailyBannerPrefs({});
      await pumpWithBanner(tester, prefs: prefs, canEdit: true, dailyChallengeEnabled: null);

      expect(find.byKey(const Key('daily-prompt')), findsOneWidget);
    });
  });

  testWidgets('an editor is offered the create control', (tester) async {
    await pump(tester, canEdit: true);

    expect(find.byKey(const Key('space-games-create')), findsOneWidget);
  });

  testWidgets('a viewer is not', (tester) async {
    await pump(tester, canEdit: false);

    expect(find.byKey(const Key('space-games-create')), findsNothing);
  });

  testWidgets('lists the space custom challenges', (tester) async {
    await pump(tester, canEdit: false, challenges: [_challenge('c1'), _challenge('c2')]);

    expect(find.byType(ChallengeCard), findsNWidgets(2));
  });

  testWidgets('a failed load offers a retry rather than an empty page', (tester) async {
    await pump(tester, canEdit: false, challengesError: Exception('offline'));

    expect(find.byKey(const Key('space-games-retry')), findsOneWidget);
  });

  testWidgets('other provider failures degrade gracefully rather than crashing the page', (tester) async {
    // `gameChallengesProvider` — the only provider that gates the body — succeeds here, but the
    // space, the monthly standings and the daily all fail. None of those should throw past
    // `.valueOrNull`/`.orElse(null)`, so the challenge list must still render untouched.
    await pump(
      tester,
      canEdit: false,
      challenges: [_challenge('c1')],
      extraOverrides: [
        sharedSpaceProvider('s1').overrideWith((ref) async => throw Exception('offline')),
        gameStandingsProvider('s1').overrideWith((ref) async => throw Exception('offline')),
        gameDailyProvider('s1').overrideWith((ref) async => throw Exception('offline')),
      ],
    );

    expect(tester.takeException(), isNull);
    expect(find.byType(ChallengeCard), findsOneWidget);
  });

  testWidgets("an opted-in space with a played daily shows today's standings tab and resolves the next-daily "
      'time placeholder', (tester) async {
    final daily = GameChallengeListItemResponseDto(
      id: 'daily-1',
      spaceId: 's1',
      ownerId: null,
      name: '2026-08-18',
      roundCount: 5,
      locationRoundCount: 3,
      answered: 5,
      total: 18420,
      scaleKm: 1,
      scaleDays: 1,
      createdAt: DateTime.utc(2026, 8, 18),
      closedAt: null,
      dailyOn: DateTime.utc(2026, 8, 18),
    );

    await pump(
      tester,
      canEdit: false,
      extraOverrides: [
        sharedSpaceProvider('s1').overrideWith(
          (ref) async => SharedSpaceResponseDto(
            id: 's1',
            name: 'Space',
            createdAt: '2026-08-01T00:00:00Z',
            updatedAt: '2026-08-01T00:00:00Z',
            createdById: 'u1',
            dailyChallengeEnabled: const Optional.present(true),
          ),
        ),
        gameDailyProvider('s1').overrideWith((ref) async => daily),
        gameLeaderboardProvider('daily-1').overrideWith(
          (ref) async => GameLeaderboardResponseDto(
            entries: [GameLeaderboardResponseDtoEntriesInner(userId: 'u1', name: 'Alice', total: 4200, answered: 5)],
          ),
        ),
      ],
    );

    // The daily's own leaderboard exists, so the "Today" tab must be offered, not just the
    // monthly board.
    expect(find.byKey(const Key('standings-tab-today')), findsOneWidget);
    // Proves the {time} placeholder in DailySlot's `game_daily_next_in` actually resolved for a
    // played daily reached through the composed page, not just in DailySlot's own isolated tests.
    expect(find.textContaining(RegExp(r'\d+h \d+m')), findsOneWidget);
  });

  /// Creating runs the candidate queries and a CLIP encode server-side — measured at ~9.6s cold on
  /// a real library — and until it returns the page showed nothing at all. These pin the wait being
  /// visible, and the control being shut while it runs: without that, a second tap during those ten
  /// silent seconds creates a second challenge.
  ///
  /// `pump()`, never `pumpAndSettle()`, while the spinner is up: it animates forever, so settling
  /// would time out rather than fail on the assertion.
  group('while a create is in flight', () {
    Future<Completer<GameChallengeResponseDto>> startCreate(WidgetTester tester) async {
      final completer = Completer<GameChallengeResponseDto>();
      final repository = _MockGameApiRepository();
      when(
        () => repository.createChallenge(
          any(),
          roundCount: any(named: 'roundCount'),
          type: any(named: 'type'),
        ),
      ).thenAnswer((_) => completer.future);

      await pump(tester, canEdit: true, extraOverrides: [gameApiRepositoryProvider.overrideWithValue(repository)]);

      await tester.tap(find.byKey(const Key('space-games-create')));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('create-submit')));
      await tester.pump();
      return completer;
    }

    testWidgets('the wait is shown and the create control is disabled', (tester) async {
      final completer = await startCreate(tester);

      expect(find.byKey(const Key('space-games-creating')), findsOneWidget);
      final button = tester.widget<IconButton>(find.byKey(const Key('space-games-create')));
      expect(button.onPressed, isNull, reason: 'a second tap here would create a second challenge');

      completer.complete(
        GameChallengeResponseDto(
          id: 'c9',
          spaceId: 's1',
          ownerId: null,
          name: 'c9',
          roundCount: 5,
          scaleKm: 1,
          scaleDays: 1,
          createdAt: DateTime.utc(2026, 8, 19),
          dailyOn: null,
        ),
      );
      await tester.pumpAndSettle();

      expect(find.byKey(const Key('space-games-creating')), findsNothing);
      expect(tester.widget<IconButton>(find.byKey(const Key('space-games-create'))).onPressed, isNotNull);
    });

    testWidgets('a failure clears the wait instead of leaving it spinning forever', (tester) async {
      final completer = await startCreate(tester);

      expect(find.byKey(const Key('space-games-creating')), findsOneWidget);

      completer.completeError(Exception('offline'));
      await tester.pumpAndSettle();

      expect(find.byKey(const Key('space-games-creating')), findsNothing);
      expect(tester.widget<IconButton>(find.byKey(const Key('space-games-create'))).onPressed, isNotNull);

      await settleToast(tester);
    });
  });

  testWidgets('a failed create surfaces a message rather than swallowing the error', (tester) async {
    final repository = _MockGameApiRepository();
    when(
      () => repository.createChallenge(
        any(),
        roundCount: any(named: 'roundCount'),
        type: any(named: 'type'),
      ),
    ).thenThrow(Exception('offline'));

    await pump(tester, canEdit: true, extraOverrides: [gameApiRepositoryProvider.overrideWithValue(repository)]);

    await tester.tap(find.byKey(const Key('space-games-create')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('create-submit')));
    await tester.pumpAndSettle();

    // Proves the message came from the localized 'game_create_failed' key resolving, not from the
    // raw key rendering because of a swallowed exception nobody surfaced.
    expect(find.text("Could not create a challenge from this space's photos"), findsOneWidget);
    // The page itself is not left broken: the create control is still there to retry with.
    expect(find.byKey(const Key('space-games-create')), findsOneWidget);

    await settleToast(tester);
  });

  testWidgets('a failed delete surfaces a message rather than leaving a dead card', (tester) async {
    final repository = _MockGameApiRepository();
    when(() => repository.deleteChallenge(any())).thenThrow(Exception('offline'));

    await pump(
      tester,
      canEdit: true,
      challenges: [_challenge('c1')],
      extraOverrides: [gameApiRepositoryProvider.overrideWithValue(repository)],
    );

    await tester.tap(find.byKey(const Key('challenge-card-delete-c1')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('challenge-card-delete-confirm')));
    await tester.pumpAndSettle();

    expect(find.text('Could not delete the challenge'), findsOneWidget);
    // Without the catch, `ref.invalidate` is never reached and the card is simply never refreshed —
    // indistinguishable from a dead button. It must still be on screen, unchanged.
    expect(find.byType(ChallengeCard), findsOneWidget);

    await settleToast(tester);
  });

  testWidgets('a played daily with standings still loading shows the section loading, not absent', (tester) async {
    final daily = GameChallengeListItemResponseDto(
      id: 'daily-1',
      spaceId: 's1',
      ownerId: null,
      name: '2026-08-18',
      roundCount: 5,
      locationRoundCount: 3,
      answered: 5,
      total: 18420,
      scaleKm: 1,
      scaleDays: 1,
      createdAt: DateTime.utc(2026, 8, 18),
      closedAt: null,
      dailyOn: DateTime.utc(2026, 8, 18),
    );

    // `pumpConsumerWidget`'s automatic `pumpAndSettle()` would hang forever here: the standings
    // provider below never resolves, and the section's own CircularProgressIndicator is an
    // indeterminate (indefinitely repeating) animation — nothing "settles". Use the raw pump and
    // drive frames manually instead, matching daily_challenge_card_test.dart's narrow-phone group.
    await tester.pumpConsumerWidgetRaw(
      const SpaceGamesPage(spaceId: 's1', canEdit: false),
      overrides: [
        currentUserProvider.overrideWith((ref) => _StubCurrentUserNotifier(_user('u1'))),
        gameChallengesProvider('s1').overrideWith((ref) async => []),
        sharedSpaceProvider('s1').overrideWith(
          (ref) async => SharedSpaceResponseDto(
            id: 's1',
            name: 'Space',
            createdAt: '2026-08-01T00:00:00Z',
            updatedAt: '2026-08-01T00:00:00Z',
            createdById: 'u1',
            dailyChallengeEnabled: const Optional.present(true),
          ),
        ),
        gameDailyProvider('s1').overrideWith((ref) async => daily),
        gameLeaderboardProvider('daily-1').overrideWith((ref) async => GameLeaderboardResponseDto(entries: [])),
        // Never resolves, on purpose: proves the section renders its OWN loading state instead of
        // vanishing from the tree while standings are still in flight.
        gameStandingsProvider('s1').overrideWith((ref) => Completer<GameStandingsResponseDto>().future),
      ],
    );

    // Enough frames for the challenges/space/daily/leaderboard/members futures (all synchronous
    // `async =>` bodies) to resolve and rebuild, without ever settling the perpetual spinner.
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 50));

    // The section holds its place mid-load rather than vanishing from the tree — the point of
    // this test, and unaffected by the button's removal.
    expect(find.byKey(const Key('standings-loading')), findsOneWidget);
    // No Leaderboard button here even while the board is still loading: the card is on the page
    // that owns the board, so there is nowhere for it to send anyone regardless of load state.
    expect(find.byKey(const Key('daily-standings')), findsNothing);
  });

  group('the daily opt-in decision', () {
    // An un-asked space (`dailyChallengeEnabled` absent) seen by an editor — the one state that
    // puts DailyChallengePrompt's two buttons on screen.
    SharedSpaceResponseDto unAskedSpace() => SharedSpaceResponseDto(
      id: 's1',
      name: 'Space',
      createdAt: '2026-08-01T00:00:00Z',
      updatedAt: '2026-08-01T00:00:00Z',
      createdById: 'u1',
      dailyChallengeEnabled: const Optional.absent(),
    );

    Future<_MockSharedSpaceApiRepository> pumpPrompt(WidgetTester tester, {Object? updateError}) async {
      final spaces = _MockSharedSpaceApiRepository();
      if (updateError != null) {
        when(
          () => spaces.update(any(), dailyChallengeEnabled: any(named: 'dailyChallengeEnabled')),
        ).thenThrow(updateError);
      } else {
        when(
          () => spaces.update(any(), dailyChallengeEnabled: any(named: 'dailyChallengeEnabled')),
        ).thenAnswer((_) async => unAskedSpace());
      }

      await pump(
        tester,
        canEdit: true,
        extraOverrides: [
          sharedSpaceProvider('s1').overrideWith((ref) async => unAskedSpace()),
          sharedSpaceApiRepositoryProvider.overrideWithValue(spaces),
        ],
      );
      expect(find.byKey(const Key('daily-prompt')), findsOneWidget);
      return spaces;
    }

    // Nothing used to tap either button, at any level: swapping the two `onDecide` arguments in
    // DailyChallengePrompt — turning "No thanks" into "Enable" — shipped fully green.
    testWidgets('Enable reaches the repository with dailyChallengeEnabled: true', (tester) async {
      final spaces = await pumpPrompt(tester);

      await tester.tap(find.byKey(const Key('daily-prompt-enable')));
      await tester.pumpAndSettle();

      verify(() => spaces.update('s1', dailyChallengeEnabled: true)).called(1);
      verifyNever(() => spaces.update('s1', dailyChallengeEnabled: false));
    });

    testWidgets('No thanks reaches the repository with dailyChallengeEnabled: false', (tester) async {
      final spaces = await pumpPrompt(tester);

      await tester.tap(find.byKey(const Key('daily-prompt-decline')));
      await tester.pumpAndSettle();

      verify(() => spaces.update('s1', dailyChallengeEnabled: false)).called(1);
      verifyNever(() => spaces.update('s1', dailyChallengeEnabled: true));
    });

    // `onDecide` is a `void Function(bool)`, so the Future was dropped: a failed PATCH used to be
    // an unhandled async error with no feedback at all, unlike _create/_delete eight lines below
    // it, which have caught and toasted since task 2.
    testWidgets('a failed decision surfaces a message rather than an unhandled async error', (tester) async {
      await pumpPrompt(tester, updateError: Exception('offline'));

      await tester.tap(find.byKey(const Key('daily-prompt-enable')));
      await tester.pumpAndSettle();

      expect(tester.takeException(), isNull);
      // Proves the message came from 'game_daily_toggle_failed' resolving — an already-translated
      // key that until now nothing referenced.
      expect(find.text('Could not change the daily challenge setting'), findsOneWidget);
      // The prompt is still there to try again with.
      expect(find.byKey(const Key('daily-prompt')), findsOneWidget);

      await settleToast(tester);
    });
  });

  testWidgets('a played daily offers no Leaderboard button here — the board is already on the page', (tester) async {
    // This page IS the leaderboard, so the button used to scroll to a section sitting directly
    // beneath it. Not merely usually redundant: the card only renders when dailyChallengeEnabled
    // is true, and `shouldShowStandings` returns `enabled || ...`, so whenever this card is on
    // this page the standings section is guaranteed to be there too.
    final daily = GameChallengeListItemResponseDto(
      id: 'daily-1',
      spaceId: 's1',
      ownerId: null,
      name: '2026-08-18',
      roundCount: 5,
      locationRoundCount: 3,
      answered: 5,
      total: 18420,
      scaleKm: 1,
      scaleDays: 1,
      createdAt: DateTime.utc(2026, 8, 18),
      closedAt: null,
      dailyOn: DateTime.utc(2026, 8, 18),
    );

    await pump(
      tester,
      canEdit: false,
      extraOverrides: [
        sharedSpaceProvider('s1').overrideWith(
          (ref) async => SharedSpaceResponseDto(
            id: 's1',
            name: 'Space',
            createdAt: '2026-08-01T00:00:00Z',
            updatedAt: '2026-08-01T00:00:00Z',
            createdById: 'u1',
            dailyChallengeEnabled: const Optional.present(true),
          ),
        ),
        gameDailyProvider('s1').overrideWith((ref) async => daily),
        gameLeaderboardProvider('daily-1').overrideWith((ref) async => GameLeaderboardResponseDto(entries: [])),
      ],
    );

    expect(find.byKey(const Key('daily-standings')), findsNothing);

    // The board itself is present and resolved, which is exactly why the button is not needed —
    // and the card still renders, so removing the button did not remove the card with it.
    expect(find.byKey(const Key('standings-tab-today')), findsOneWidget);
    expect(find.byKey(const Key('daily-card')), findsOneWidget);
    expect(tester.takeException(), isNull);
  });
}
