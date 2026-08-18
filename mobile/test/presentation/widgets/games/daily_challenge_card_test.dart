import 'package:drift/drift.dart' as drift;
import 'package:drift/native.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:immich_mobile/domain/models/store.model.dart';
import 'package:immich_mobile/domain/services/store.service.dart';
import 'package:immich_mobile/entities/store.entity.dart';
import 'package:immich_mobile/infrastructure/repositories/db.repository.dart';
import 'package:immich_mobile/infrastructure/repositories/store.repository.dart';
import 'package:immich_mobile/presentation/widgets/games/daily_challenge_card.widget.dart';
import 'package:immich_mobile/providers/game/game.provider.dart';
import 'package:openapi/api.dart';

import '../../../test_utils.dart';
import '../../../widget_tester_extensions.dart';

GameChallengeListItemResponseDto _daily({num answered = 0}) => GameChallengeListItemResponseDto(
  id: 'daily-1',
  spaceId: 's1',
  name: '2026-08-18',
  roundCount: 5,
  locationRoundCount: 3,
  answered: answered,
  total: 18420,
  scaleKm: 1,
  scaleDays: 1,
  createdAt: DateTime.utc(2026, 8, 18),
  closedAt: null,
  dailyOn: DateTime.utc(2026, 8, 18),
);

void main() {
  // DailySlot's card builds a RemoteImageProvider URL via getGameRoundImageUrl, which reads
  // Store.get(StoreKey.serverEndpoint) — that throws unless the Store is initialized. Mirrors
  // round_reveal_test.dart / challenge_card_test.dart, which hit the same dependency.
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
    required bool? enabled,
    required bool canEdit,
    GameChallengeListItemResponseDto? daily,
  }) => tester.pumpConsumerWidget(
    DailySlot(
      spaceId: 's1',
      dailyChallengeEnabled: enabled,
      canEdit: canEdit,
      onDecide: (_) {},
      onPlay: () {},
      onStandings: () {},
    ),
    overrides: [gameDailyProvider('s1').overrideWith((ref) async => daily)],
  );

  testWidgets('an un-asked space prompts an editor', (tester) async {
    await pump(tester, enabled: null, canEdit: true);

    expect(find.byKey(const Key('daily-prompt')), findsOneWidget);
    expect(find.byKey(const Key('daily-card')), findsNothing);
  });

  testWidgets('an un-asked space shows a viewer nothing at all', (tester) async {
    await pump(tester, enabled: null, canEdit: false);

    expect(find.byKey(const Key('daily-prompt')), findsNothing);
    expect(find.byKey(const Key('daily-card')), findsNothing);
  });

  testWidgets('a declined space shows an editor nothing', (tester) async {
    await pump(tester, enabled: false, canEdit: true);

    expect(find.byKey(const Key('daily-prompt')), findsNothing);
    expect(find.byKey(const Key('daily-card')), findsNothing);
  });

  testWidgets('an enabled space offers Play while the daily is unplayed', (tester) async {
    await pump(tester, enabled: true, canEdit: false, daily: _daily());

    expect(find.byKey(const Key('daily-play')), findsOneWidget);
    expect(find.byKey(const Key('daily-standings')), findsNothing);
  });

  testWidgets('a played daily flips to the score and the standings link', (tester) async {
    await pump(tester, enabled: true, canEdit: false, daily: _daily(answered: 5));

    expect(find.byKey(const Key('daily-standings')), findsOneWidget);
    expect(find.byKey(const Key('daily-play')), findsNothing);
    // Proves the {time} placeholder in game_daily_next_in actually resolved rather than `.t()`
    // silently falling back to the raw key on a wrong args name.
    expect(find.textContaining(RegExp(r'\d+h \d+m')), findsOneWidget);
  });

  testWidgets('the slot reserves the same height played or unplayed', (tester) async {
    await pump(tester, enabled: true, canEdit: false, daily: _daily());
    final unplayed = tester.getSize(find.byKey(const Key('daily-card'))).height;

    await pump(tester, enabled: true, canEdit: false, daily: _daily(answered: 5));
    final played = tester.getSize(find.byKey(const Key('daily-card'))).height;

    expect(played, unplayed, reason: 'A height change would jitter the timeline scrubber offset');
  });
}
