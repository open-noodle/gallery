import 'package:drift/drift.dart' as drift;
import 'package:drift/native.dart';
import 'package:easy_localization/easy_localization.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/constants/locales.dart';
import 'package:immich_mobile/domain/models/store.model.dart';
import 'package:immich_mobile/domain/services/store.service.dart';
import 'package:immich_mobile/entities/store.entity.dart';
import 'package:immich_mobile/generated/codegen_loader.g.dart';
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

  testWidgets('a declined space shows a viewer nothing either — both roles land on the same branch', (tester) async {
    await pump(tester, enabled: false, canEdit: false);

    expect(find.byKey(const Key('daily-prompt')), findsNothing);
    expect(find.byKey(const Key('daily-card')), findsNothing);
  });

  testWidgets('an enabled space shows the card to an editor too, not just a viewer', (tester) async {
    await pump(tester, enabled: true, canEdit: true, daily: _daily());

    expect(find.byKey(const Key('daily-card')), findsOneWidget);
    expect(find.byKey(const Key('daily-play')), findsOneWidget);
    expect(find.byKey(const Key('daily-prompt')), findsNothing);
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

  // reservedHeight is what the page actually calls to reserve sliver space, synchronously and
  // before the daily provider resolves — build() reimplements the same branching for the widget
  // it actually renders. A plain by-inspection match between the two is how they'd silently drift;
  // this pins the exact numbers reservedHeight must return for every (state, canEdit) pair.
  test('reservedHeight matches exactly, for every (dailyChallengeEnabled, canEdit) pair', () {
    expect(
      DailySlot.reservedHeight(dailyChallengeEnabled: null, canEdit: true),
      kDailyPromptHeight,
      reason: 'un-asked + editor → the prompt height',
    );
    expect(
      DailySlot.reservedHeight(dailyChallengeEnabled: null, canEdit: false),
      0,
      reason: 'un-asked + viewer → nothing',
    );
    expect(
      DailySlot.reservedHeight(dailyChallengeEnabled: true, canEdit: true),
      kDailyCardHeight,
      reason: 'enabled + editor → the card height, same as a viewer',
    );
    expect(
      DailySlot.reservedHeight(dailyChallengeEnabled: true, canEdit: false),
      kDailyCardHeight,
      reason: 'enabled + viewer → the card height',
    );
    expect(
      DailySlot.reservedHeight(dailyChallengeEnabled: false, canEdit: true),
      0,
      reason: 'declined + editor → nothing',
    );
    expect(
      DailySlot.reservedHeight(dailyChallengeEnabled: false, canEdit: false),
      0,
      reason: 'declined + viewer → nothing',
    );
  });

  group('narrow phone / long translation', () {
    // flutter_test's default surface is 800×600 — wider than any phone this ships on (real
    // phones run ~360-430dp) — so a height tuned only against that default proves nothing about
    // a real device. This pins the view to a 360×800 phone (iPhone SE / narrow Android class) and
    // switches the active locale to German, whose game_daily_enable_description
    // ("Spiele täglich eine gemeinsame Herausforderung in diesem Space. Die Punkte zählen für die
    // monatliche Bestenliste.") is the longest of the nine required locales for this string —
    // longer than English, French, Italian, Dutch, Polish, Spanish and Russian (all measured by
    // character count against i18n/*.json before writing this test). At 360dp it wraps to more
    // lines than English ever would at 800dp, which is exactly the case DailyChallengePrompt's
    // Flexible + maxLines + ellipsis must swallow without throwing a RenderFlex overflow.
    //
    // Bypasses the shared pumpConsumerWidget/pumpConsumerWidgetRaw helpers (hardcoded to English)
    // and builds the same EasyLocalization + ProviderScope + MaterialApp shell directly, pinned to
    // German instead.
    Future<void> pumpNarrowGerman(
      WidgetTester tester, {
      required bool? enabled,
      required bool canEdit,
      GameChallengeListItemResponseDto? daily,
    }) async {
      tester.view.devicePixelRatio = 1;
      tester.view.physicalSize = const Size(360, 800);
      addTearDown(tester.view.reset);

      await tester.pumpWidget(
        EasyLocalization(
          supportedLocales: locales.values.toList(),
          path: translationsPath,
          startLocale: const Locale('de'),
          fallbackLocale: locales.values.first,
          saveLocale: false,
          useFallbackTranslations: true,
          assetLoader: const CodegenLoader(),
          child: ProviderScope(
            overrides: [gameDailyProvider('s1').overrideWith((ref) async => daily)],
            child: Builder(
              builder: (context) => MaterialApp(
                debugShowCheckedModeBanner: false,
                localizationsDelegates: context.localizationDelegates,
                supportedLocales: context.supportedLocales,
                locale: context.locale,
                home: Material(
                  child: DailySlot(
                    spaceId: 's1',
                    dailyChallengeEnabled: enabled,
                    canEdit: canEdit,
                    onDecide: (_) {},
                    onPlay: () {},
                    onStandings: () {},
                  ),
                ),
              ),
            ),
          ),
        ),
      );
      await tester.pumpAndSettle();
    }

    testWidgets('the opt-in prompt renders the long German description without overflowing', (tester) async {
      await pumpNarrowGerman(tester, enabled: null, canEdit: true);

      expect(find.byKey(const Key('daily-prompt')), findsOneWidget);
      expect(tester.takeException(), isNull, reason: 'A RenderFlex overflow surfaces here, not as a print-only log');
      // Proves the locale actually switched to German rather than silently staying on English —
      // "Herausforderung" appears in the German title and description but not in any English string
      // this widget renders.
      expect(find.textContaining('Herausforderung'), findsWidgets);
    });

    testWidgets('the enabled card also renders at 360dp without overflowing, in German', (tester) async {
      await pumpNarrowGerman(tester, enabled: true, canEdit: false, daily: _daily(answered: 5));

      expect(find.byKey(const Key('daily-card')), findsOneWidget);
      expect(tester.takeException(), isNull);
    });
  });
}
