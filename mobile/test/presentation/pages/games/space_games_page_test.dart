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
import 'package:immich_mobile/providers/shared_space.provider.dart';
import 'package:immich_mobile/providers/user.provider.dart';
import 'package:mocktail/mocktail.dart';
import 'package:openapi/api.dart';

import '../../../test_utils.dart';
import '../../../widget_tester_extensions.dart';

class _MockUserService extends Mock implements UserService {}

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
      sharedSpaceMembersProvider('s1').overrideWith((ref) async => []),
      if (challengesError != null)
        gameChallengesProvider('s1').overrideWith((ref) async => throw challengesError)
      else
        gameChallengesProvider('s1').overrideWith((ref) async => challenges),
      ...extraOverrides,
    ],
  );

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
    // space, its members, the monthly standings and the daily all fail. None of those should throw
    // past `.valueOrNull`/`.orElse(null)`, so the challenge list must still render untouched.
    await pump(
      tester,
      canEdit: false,
      challenges: [_challenge('c1')],
      extraOverrides: [
        sharedSpaceProvider('s1').overrideWith((ref) async => throw Exception('offline')),
        gameStandingsProvider('s1').overrideWith((ref) async => throw Exception('offline')),
        sharedSpaceMembersProvider('s1').overrideWith((ref) async => throw Exception('offline')),
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
        sharedSpaceMembersProvider('s1').overrideWith(
          (ref) async => [
            SharedSpaceMemberResponseDto(
              userId: 'u1',
              name: 'Alice',
              email: 'alice@example.com',
              role: SharedSpaceRole.owner,
              joinedAt: '2026-08-01T00:00:00Z',
              sharePersonMetadata: true,
              showInTimeline: true,
            ),
          ],
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
}
