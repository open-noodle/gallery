import 'package:drift/drift.dart' as drift;
import 'package:drift/native.dart';
import 'package:easy_localization/easy_localization.dart' hide TextDirection;
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:immich_mobile/domain/models/settings_key.dart';
import 'package:immich_mobile/domain/models/timeline.model.dart';
import 'package:immich_mobile/domain/services/store.service.dart';
import 'package:immich_mobile/entities/store.entity.dart';
import 'package:immich_mobile/infrastructure/repositories/db.repository.dart';
import 'package:immich_mobile/infrastructure/repositories/settings.repository.dart';
import 'package:immich_mobile/infrastructure/repositories/store.repository.dart';
import 'package:immich_mobile/presentation/widgets/timeline/timeline_grouping_bottom_pill.widget.dart';
import 'package:immich_mobile/presentation/widgets/timeline/timeline_grouping_selector.widget.dart';
import 'package:immich_mobile/providers/timeline/multiselect.provider.dart';
// easy_localization initializes shared_preferences internally; tests need the mock initializer.
// ignore: depend_on_referenced_packages
import 'package:shared_preferences/shared_preferences.dart';

import '../../../test_utils.dart';
import '../../../widget_tester_extensions.dart';

void main() {
  late Drift db;

  setUpAll(() async {
    TestWidgetsFlutterBinding.ensureInitialized();
    TestUtils.init();
    SharedPreferences.setMockInitialValues({});
    await EasyLocalization.ensureInitialized();
    db = Drift(drift.DatabaseConnection(NativeDatabase.memory(), closeStreamsSynchronously: true));
    await StoreService.init(storeRepository: DriftStoreRepository(db), listenUpdates: false);
    await SettingsRepository.ensureInitialized(db);
  });

  setUp(() async {
    await Store.clear();
    await SettingsRepository.instance.clear(SettingsKey.values);
  });

  tearDownAll(() async {
    await Store.clear();
    await db.close();
  });

  /// Host the pill the way Timeline will in Slice 2: an overlay child of a Stack.
  Widget host({EdgeInsets viewInsets = EdgeInsets.zero, EdgeInsets padding = EdgeInsets.zero}) {
    return MediaQuery(
      data: MediaQueryData(viewInsets: viewInsets, padding: padding),
      child: const Stack(children: [SizedBox.expand(), TimelineGroupingBottomPill()]),
    );
  }

  group('TimelineGroupingBottomPill', () {
    testWidgets('renders the full 3-segment selector', (tester) async {
      await tester.pumpConsumerWidget(host());
      await tester.pumpAndSettle();

      expect(find.byKey(const Key('timeline-grouping-bottom-pill')), findsOneWidget);
      expect(find.byType(TimelineGroupingSelector), findsOneWidget);
      // Full selector, not the compact chip: all three segments are present.
      expect(find.byKey(const Key('timeline-grouping-year')), findsOneWidget);
      expect(find.byKey(const Key('timeline-grouping-month')), findsOneWidget);
      expect(find.byKey(const Key('timeline-grouping-day')), findsOneWidget);
      expect(find.byKey(const Key('timeline-grouping-compact-selector')), findsNothing);
      // The pill surface hugs the selector (218 self-cap + 2×8 padding) instead of
      // spanning the screen — keeps the scrubber's right-edge margin clear.
      expect(tester.getSize(find.byKey(const Key('timeline-grouping-bottom-pill'))).width, lessThanOrEqualTo(234));
    });

    testWidgets('selector inside the pill draws no surface of its own (single pill border)', (tester) async {
      await tester.pumpConsumerWidget(host());
      await tester.pumpAndSettle();

      // The pill already paints the blur surface + outline; a second Material slab
      // with its own stadium side inside it reads as a double border on device.
      final selectorMaterial = tester.widget<Material>(
        find.descendant(of: find.byType(TimelineGroupingSelector), matching: find.byType(Material)),
      );
      expect(selectorMaterial.color, Colors.transparent);
      expect((selectorMaterial.shape! as StadiumBorder).side, BorderSide.none);
    });

    // Hosted at root (no TimelineRouteScope): pins the ROOT grouping fallback, where segment
    // taps persist the setting. The pill's production contract (route-local, store untouched)
    // is covered by the route-scope and favorites page tests.
    testWidgets('tapping a segment outside a route scope writes Setting.groupAssetsBy', (tester) async {
      await tester.pumpConsumerWidget(host());
      await tester.pumpAndSettle();

      await tester.tap(find.byKey(const Key('timeline-grouping-month')));
      await tester.pumpAndSettle();

      expect(SettingsRepository.instance.appConfig.timeline.groupAssetsBy, GroupAssetsBy.month);
    });

    testWidgets('hides while multiselect is enabled and reappears after', (tester) async {
      final selected = TestUtils.createRemoteAsset(id: 'a1');
      final notifier = MultiSelectNotifier(
        MultiSelectState(selectedAssets: {selected}, lockedSelectionAssets: const {}, forceEnable: false),
      );
      await tester.pumpConsumerWidget(host(), overrides: [multiSelectProvider.overrideWith(() => notifier)]);
      await tester.pumpAndSettle();

      // Hidden: opacity 0 and not hittable.
      final opacity = tester.widget<AnimatedOpacity>(find.byKey(const Key('timeline-grouping-bottom-pill-opacity')));
      expect(opacity.opacity, 0);
      final ignore = tester.widget<IgnorePointer>(
        find
            .ancestor(of: find.byKey(const Key('timeline-grouping-bottom-pill')), matching: find.byType(IgnorePointer))
            .first,
      );
      expect(ignore.ignoring, isTrue);

      // Exit multiselect → visible again.
      notifier.reset();
      await tester.pumpAndSettle();
      expect(tester.widget<AnimatedOpacity>(find.byKey(const Key('timeline-grouping-bottom-pill-opacity'))).opacity, 1);
    });

    testWidgets('hides while the keyboard is up', (tester) async {
      await tester.pumpConsumerWidget(host(viewInsets: const EdgeInsets.only(bottom: 300)));
      await tester.pumpAndSettle();

      expect(tester.widget<AnimatedOpacity>(find.byKey(const Key('timeline-grouping-bottom-pill-opacity'))).opacity, 0);
    });

    testWidgets('stays visible just below the keyboard threshold', (tester) async {
      // Brackets the 80px threshold: 79 → visible (300 → hidden is covered above).
      await tester.pumpConsumerWidget(host(viewInsets: const EdgeInsets.only(bottom: 79)));
      await tester.pumpAndSettle();

      expect(tester.widget<AnimatedOpacity>(find.byKey(const Key('timeline-grouping-bottom-pill-opacity'))).opacity, 1);
    });

    testWidgets('floats max(safe-area, 26) above the bottom', (tester) async {
      EdgeInsets pillOuterPadding() {
        // The pill's own outer Padding (the one carrying the bottom float); nearest ancestor.
        final padding = tester.widget<Padding>(
          find
              .ancestor(of: find.byKey(const Key('timeline-grouping-bottom-pill')), matching: find.byType(Padding))
              .first,
        );
        return padding.padding as EdgeInsets;
      }

      // Small safe area → 26px float.
      await tester.pumpConsumerWidget(host(padding: const EdgeInsets.only(bottom: 10)));
      await tester.pumpAndSettle();
      expect(pillOuterPadding().bottom, 26);

      // Large safe area → safe-area float.
      await tester.pumpConsumerWidget(host(padding: const EdgeInsets.only(bottom: 50)));
      await tester.pumpAndSettle();
      expect(pillOuterPadding().bottom, 50);
    });

    testWidgets('reduced motion applies hide state immediately (no animation)', (tester) async {
      final selected = TestUtils.createRemoteAsset(id: 'a1');
      await tester.pumpConsumerWidget(
        const MediaQuery(
          data: MediaQueryData(disableAnimations: true),
          child: Stack(children: [SizedBox.expand(), TimelineGroupingBottomPill()]),
        ),
        overrides: [
          multiSelectProvider.overrideWith(
            () => MultiSelectNotifier(
              MultiSelectState(selectedAssets: {selected}, lockedSelectionAssets: const {}, forceEnable: false),
            ),
          ),
        ],
      );
      // A single frame is enough: durations are zero under reduced motion.
      await tester.pump();
      final animatedOpacity = tester.widget<AnimatedOpacity>(
        find.byKey(const Key('timeline-grouping-bottom-pill-opacity')),
      );
      expect(animatedOpacity.duration, Duration.zero);
      // Observable outcome, not just configuration: the hidden state is already applied.
      expect(animatedOpacity.opacity, 0);
    });

    testWidgets('adds no button semantics of its own (exactly the selector buttons)', (tester) async {
      final handle = tester.ensureSemantics();
      await tester.pumpConsumerWidget(host());
      await tester.pumpAndSettle();

      // The selector contributes exactly 3 button nodes (year/month/day segments).
      final buttons = tester.semantics
          .simulatedAccessibilityTraversal()
          .where((node) => node.flagsCollection.isButton)
          .length;
      expect(buttons, 3);
      handle.dispose();
    });

    testWidgets('large text scale renders without overflow', (tester) async {
      await tester.pumpConsumerWidget(
        const MediaQuery(
          data: MediaQueryData(textScaler: TextScaler.linear(2.0)),
          child: Stack(children: [SizedBox.expand(), TimelineGroupingBottomPill()]),
        ),
      );
      await tester.pumpAndSettle();
      expect(tester.takeException(), isNull);
      expect(find.byKey(const Key('timeline-grouping-bottom-pill')), findsOneWidget);
    });

    testWidgets('RTL: renders and segment taps still update the grouping', (tester) async {
      await tester.pumpConsumerWidget(Directionality(textDirection: TextDirection.rtl, child: host()));
      await tester.pumpAndSettle();

      await tester.tap(find.byKey(const Key('timeline-grouping-year')));
      await tester.pumpAndSettle();
      expect(SettingsRepository.instance.appConfig.timeline.groupAssetsBy, GroupAssetsBy.year);
    });
  });
}
