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
import 'package:immich_mobile/presentation/widgets/images/remote_image_provider.dart';
import 'package:immich_mobile/providers/game/game.provider.dart';
import 'package:immich_mobile/providers/shared_space.provider.dart';
import 'package:openapi/api.dart';

import '../../../test_utils.dart';
import '../../../widget_tester_extensions.dart';

GameChallengeListItemResponseDto _daily({num answered = 0}) => GameChallengeListItemResponseDto(
  id: 'daily-1',
  spaceId: 's1',
  ownerId: null,
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

/// A space fixture. [cover] omitted leaves `thumbnailAssetId` **absent** rather than null, which
/// is the state that matters: it is `Optional<String?>`, so reading `.value` on it throws — the
/// card must go through `.orElse(null)`.
SharedSpaceResponseDto _space({String? cover}) => SharedSpaceResponseDto(
  id: 's1',
  name: 'All photos',
  createdById: 'u1',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  thumbnailAssetId: cover == null ? const Optional.absent() : Optional.present(cover),
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
    void Function(bool enabled)? onDecide,
    SharedSpaceResponseDto? space,
    bool offerStandings = true,
    // These pump the CHALLENGES page's slot, the one surface that carries the opt-in prompt. The
    // space timeline passes false; `the space timeline never prompts` below covers that side.
    bool allowPrompt = true,
  }) => tester.pumpConsumerWidget(
    DailySlot(
      spaceId: 's1',
      dailyChallengeEnabled: enabled,
      canEdit: canEdit,
      allowPrompt: allowPrompt,
      onDecide: onDecide ?? (_) {},
      onPlay: () {},
      onStandings: offerStandings ? () {} : null,
    ),
    overrides: [
      gameDailyProvider('s1').overrideWith((ref) async => daily),
      sharedSpaceProvider('s1').overrideWith((ref) async => space ?? _space()),
    ],
  );

  testWidgets('an un-asked space prompts an editor', (tester) async {
    await pump(tester, enabled: null, canEdit: true);

    expect(find.byKey(const Key('daily-prompt')), findsOneWidget);
    expect(find.byKey(const Key('daily-card')), findsNothing);
  });

  // Neither button was tapped by any test before this: swapping the two `onDecide` arguments in
  // DailyChallengePrompt — turning "No thanks" into "Enable" — used to ship fully green.
  testWidgets('tapping Enable decides true', (tester) async {
    final decisions = <bool>[];
    await pump(tester, enabled: null, canEdit: true, onDecide: decisions.add);

    await tester.tap(find.byKey(const Key('daily-prompt-enable')));
    await tester.pumpAndSettle();

    expect(decisions, [true]);
  });

  testWidgets('tapping No thanks decides false', (tester) async {
    final decisions = <bool>[];
    await pump(tester, enabled: null, canEdit: true, onDecide: decisions.add);

    await tester.tap(find.byKey(const Key('daily-prompt-decline')));
    await tester.pumpAndSettle();

    expect(decisions, [false]);
  });

  // The space timeline is not a place to be asked. An un-asked space shows nothing above its
  // photos for anyone, editor included — the invitation lives on the Challenges page, reachable
  // from the space's own overflow menu.
  testWidgets('the space timeline never prompts, not even an editor', (tester) async {
    await pump(tester, enabled: null, canEdit: true, allowPrompt: false);

    expect(find.byKey(const Key('daily-prompt')), findsNothing);
    expect(find.byKey(const Key('daily-card')), findsNothing);
  });

  testWidgets('the space timeline still shows the card for an opted-in space', (tester) async {
    await pump(tester, enabled: true, canEdit: true, daily: _daily(), allowPrompt: false);

    expect(find.byKey(const Key('daily-card')), findsOneWidget);
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

  // The other two surfaces that can fail on this page (the challenge list, the standings section)
  // have offered a retry since they shipped; this one only ever printed the message. A null
  // challenge is deliberately left without one -- the space genuinely has no daily to fetch.
  testWidgets('a failed daily offers a retry that re-runs the fetch', (tester) async {
    var attempts = 0;
    await tester.pumpConsumerWidget(
      DailySlot(
        spaceId: 's1',
        dailyChallengeEnabled: true,
        canEdit: false,
        onDecide: (_) {},
        onPlay: () {},
        onStandings: () {},
      ),
      overrides: [
        gameDailyProvider('s1').overrideWith((ref) async {
          attempts++;
          throw Exception('offline');
        }),
      ],
    );

    expect(find.byKey(const Key('daily-card-error')), findsOneWidget);
    expect(find.byKey(const Key('daily-retry')), findsOneWidget);
    expect(attempts, 1);
    expect(tester.takeException(), isNull, reason: 'The fixed-height slot must not overflow around the retry');

    await tester.tap(find.byKey(const Key('daily-retry')));
    await tester.pumpAndSettle();

    expect(attempts, 2, reason: 'The retry must invalidate gameDailyProvider, not merely repaint');
  });

  testWidgets('a space with no daily today shows the message without a retry', (tester) async {
    await pump(tester, enabled: true, canEdit: false);

    expect(find.byKey(const Key('daily-retry')), findsNothing);
    expect(find.textContaining('No daily challenge today'), findsOneWidget);
  });

  testWidgets('the slot reserves the same height played or unplayed', (tester) async {
    await pump(tester, enabled: true, canEdit: false, daily: _daily());
    final unplayed = tester.getSize(find.byKey(const Key('daily-card'))).height;

    await pump(tester, enabled: true, canEdit: false, daily: _daily(answered: 5));
    final played = tester.getSize(find.byKey(const Key('daily-card'))).height;

    expect(played, unplayed, reason: 'A height change would jitter the timeline scrubber offset');
  });

  String? backdropUrl(WidgetTester tester) {
    final images = tester.widgetList<Image>(find.byKey(const Key('daily-card-cover')));
    if (images.isEmpty) return null;
    return (images.first.image as RemoteImageProvider).url;
  }

  testWidgets('the backdrop is the space cover, not a round image', (tester) async {
    await pump(
      tester,
      enabled: true,
      canEdit: false,
      daily: _daily(),
      space: _space(cover: 'cover-asset-1'),
    );

    final url = backdropUrl(tester);
    expect(url, isNotNull, reason: 'The opted-in card should paint a cover backdrop');
    expect(url, contains('/assets/cover-asset-1/thumbnail'));
    // The whole point of the change: a round image both looks wrong here and costs a full
    // preview (measured 120-800KB) to decorate a 108px strip.
    expect(url, isNot(contains('/games/')));
  });

  testWidgets('a space with no cover falls back to the space gradient, never a round image', (tester) async {
    await pump(tester, enabled: true, canEdit: false, daily: _daily(), space: _space());

    expect(find.byKey(const Key('daily-card-gradient')), findsOneWidget);
    expect(backdropUrl(tester), isNull);
    expect(find.byKey(const Key('daily-card')), findsOneWidget);
    // `thumbnailAssetId` is Optional<String?>; reading `.value` while absent throws, so an
    // exception here means the card reached for `.value` instead of `.orElse(null)`.
    expect(tester.takeException(), isNull);
  });

  testWidgets('the title is weighted, not the default body text', (tester) async {
    await pump(
      tester,
      enabled: true,
      canEdit: false,
      daily: _daily(),
      space: _space(cover: 'cover-asset-1'),
    );

    final title = tester.widget<Text>(find.text('Daily challenge'));
    expect(title.style?.fontWeight, FontWeight.w600);
  });

  /// A caller that already shows the standings passes no handler, and then the played card offers
  /// no button: on the Challenges page the board sits directly beneath this card, so a
  /// "Leaderboard" button there pointed at something already on screen.
  testWidgets('a played daily offers no standings button when the caller has no route for it', (tester) async {
    await pump(tester, enabled: true, canEdit: false, daily: _daily(answered: 5), offerStandings: false);

    expect(find.byKey(const Key('daily-card')), findsOneWidget);
    expect(find.byKey(const Key('daily-standings')), findsNothing);
    // The card still says its piece — losing the button must not cost the countdown.
    expect(find.textContaining(RegExp(r'\d+h \d+m')), findsOneWidget);
  });

  testWidgets('an unplayed daily still offers Play with no standings handler', (tester) async {
    await pump(tester, enabled: true, canEdit: false, daily: _daily(), offerStandings: false);

    expect(find.byKey(const Key('daily-play')), findsOneWidget);
  });

  /// The first attempt tinted the whole card toward the theme surface so theme ink stayed legible.
  /// That washed the cover out — the card read as faded rather than as a photo. Contrast now comes
  /// from a scrim anchored where the text sits, leaving the rest of the cover alone, and the
  /// content is white so it never depends on how bright the cover happens to be.
  group('legibility over the cover', () {
    testWidgets('the title and the subtitle are white, not theme ink', (tester) async {
      // `answered: 5` so the played state renders the subtitle line as well as the title.
      await pump(
        tester,
        enabled: true,
        canEdit: false,
        daily: _daily(answered: 5),
        space: _space(cover: 'c1'),
      );

      expect(tester.widget<Text>(find.text('Daily challenge')).style?.color, Colors.white);

      final subtitle = tester.widget<Text>(find.textContaining(RegExp(r'\d+h \d+m')));
      expect(subtitle.style?.color?.r, Colors.white.r);
      expect(subtitle.style?.color?.a, greaterThan(0.6), reason: 'it must stay readable, not ghost out');
    });

    testWidgets('the scrim runs left to right, dark where the text sits', (tester) async {
      await pump(
        tester,
        enabled: true,
        canEdit: false,
        daily: _daily(),
        space: _space(cover: 'c1'),
      );

      final scrim = tester.widget<DecoratedBox>(find.byKey(const Key('daily-card-scrim')));
      final gradient = (scrim.decoration as BoxDecoration).gradient! as LinearGradient;

      expect(gradient.begin, Alignment.centerLeft);
      expect(gradient.end, Alignment.centerRight);
      // Dark at the text end, clear at the far end — the reverse would darken empty cover and
      // leave the title on whatever the photo happens to be.
      expect(gradient.colors.first.a, greaterThan(0.4));
      expect(gradient.colors.last.a, 0.0);
    });
  });

  // reservedHeight is what the space timeline calls to reserve sliver space, synchronously and
  // before the daily provider resolves — build() reimplements the same branching for the widget it
  // actually renders. A plain by-inspection match between the two is how they'd silently drift;
  // this pins the exact number for every state.
  //
  // No canEdit any more: the timeline shows a banner only for an opted-in space, and the opt-in
  // prompt (the one branch that ever varied by role) now lives only on the Challenges page.
  test('reservedHeight matches exactly, for every dailyChallengeEnabled', () {
    expect(
      DailySlot.reservedHeight(dailyChallengeEnabled: true),
      kDailyCardHeight,
      reason: 'enabled -> the card height',
    );
    expect(
      DailySlot.reservedHeight(dailyChallengeEnabled: null),
      0,
      reason: 'un-asked -> nothing on the timeline; the prompt belongs to the Challenges page',
    );
    expect(DailySlot.reservedHeight(dailyChallengeEnabled: false), 0, reason: 'declined -> nothing');
    expect(
      DailySlot.reservedHeight(dailyChallengeEnabled: true, hidden: true),
      0,
      reason: 'hidden wins over an enabled daily',
    );
  });

  // The Challenges page offers "hide this space's banner" only when the timeline has one to hide,
  // so it asks this same predicate. Deriving the height from it is the point: two hand-written
  // copies would drift, and the failure would be a menu item that hides nothing (or a missing one
  // on a space that does show a banner).
  test('showsOnTimeline agrees with reservedHeight for every dailyChallengeEnabled', () {
    for (final enabled in <bool?>[null, true, false]) {
      expect(
        DailySlot.showsOnTimeline(dailyChallengeEnabled: enabled),
        DailySlot.reservedHeight(dailyChallengeEnabled: enabled) > 0,
        reason: 'enabled: $enabled',
      );
    }
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
      double textScale = 1.0,
      bool allowPrompt = true,
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
            overrides: [
              gameDailyProvider('s1').overrideWith((ref) async => daily),
              sharedSpaceProvider('s1').overrideWith((ref) async => _space(cover: 'cover-asset-1')),
            ],
            child: Builder(
              builder: (context) => MaterialApp(
                debugShowCheckedModeBanner: false,
                localizationsDelegates: context.localizationDelegates,
                supportedLocales: context.supportedLocales,
                locale: context.locale,
                home: MediaQuery(
                  data: MediaQuery.of(context).copyWith(textScaler: TextScaler.linear(textScale)),
                  // Column, not a bare Material: `home:` passes TIGHT constraints, and a SizedBox
                  // cannot shrink under those — the slot's fixed height was silently ignored here,
                  // so every overflow test in this group was measuring an unconstrained prompt.
                  // SpaceTopSliver puts DailySlot in a Column, which is what makes the height bind.
                  child: Material(
                    child: Column(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        DailySlot(
                          spaceId: 's1',
                          dailyChallengeEnabled: enabled,
                          canEdit: canEdit,
                          allowPrompt: allowPrompt,
                          onDecide: (_) {},
                          onPlay: () {},
                          onStandings: () {},
                        ),
                      ],
                    ),
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

    // takeException() above cannot catch a clipped prompt. Its column sits in a
    // SingleChildScrollView, so content taller than the slot SCROLLS rather than throwing — the
    // buttons are cut off silently, with a clean test run. Measuring a button against the card is
    // the only assertion that fails when that happens.
    //
    // On a 402dp device the prompt fits its old fixed slot with ~3dp to spare (129 of 132). At
    // 360dp the OverflowBar stacks the two buttons instead of putting them in a row, which alone
    // costs more than that margin — so the buttons were cut off on every narrow phone, at the
    // DEFAULT text size. Text scaling then makes it worse, hence both cases below.
    for (final scale in [1.0, 1.5]) {
      testWidgets('both prompt buttons stay inside the card at 360dp, German, ${scale}x text', (tester) async {
        await pumpNarrowGerman(tester, enabled: null, canEdit: true, textScale: scale);

        final card = tester.getRect(find.byKey(const Key('daily-prompt')));
        for (final key in [const Key('daily-prompt-decline'), const Key('daily-prompt-enable')]) {
          final button = tester.getRect(find.byKey(key));
          expect(
            button.bottom,
            lessThanOrEqualTo(card.bottom),
            reason: '$key is cut off: the card ends at ${card.bottom}, the button at ${button.bottom}',
          );
        }
      });
    }
  });
}
