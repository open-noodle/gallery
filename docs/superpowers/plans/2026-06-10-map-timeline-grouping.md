# Map Bottom Sheet Timeline Grouping Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show the same Years / Months / All timeline-grouping pill on the photo list below the mobile map (Places → map → browse a region), which is currently the only timeline without it.

**Architecture:** The map bottom sheet (`MapBottomSheetTimeline`) already renders the shared `Timeline` widget but pins grouping to `GroupAssetsBy.day` through a raw `ProviderScope` override and a `forcedTimelineGroupBy` constant. The fix is to adopt the exact wiring every other detail timeline uses: wrap the timeline in `TimelineRouteScope` (which scopes a route-local, non-persisting grouping provider plus temporal-scope/zoom-anchor/drill-down providers) and turn on `Timeline(withGroupingPill: true)`. The drift data layer needs **no changes** — `DriftTimelineRepository.map()` already accepts `groupBy` (year/month/day via `effectiveCreatedAt`/`truncateDate`) and `temporalScope` (`_remoteWithinTemporalScope`, drill-down on Year/Month cards already covered by `test/infrastructure/repositories/timeline_temporal_scope_repository_test.dart:357`).

**Tech Stack:** Flutter/Dart, Riverpod (scoped provider overrides), Drift (in-memory `NativeDatabase` in tests), mocktail, flutter_test.

---

## Environment

- Worktree: `/Users/pierre/dev/gallery/.claude/worktrees/map-timeline-grouping`, branch `worktree-map-timeline-grouping` (based on `main` @ `a169f51aaa`).
- All commands run from `mobile/` inside the worktree. Non-login shells need mise shims first:

```bash
export PATH="$HOME/.local/share/mise/shims:$PATH"
cd /Users/pierre/dev/gallery/.claude/worktrees/map-timeline-grouping/mobile
```

- Baseline `flutter test`: **1749 passed, 1 skipped, 0 failures** (verified 2026-06-10). Translation codegen already ran (`mise run codegen:translation` — `lib/generated/translations.g.dart` is gitignored and must exist for analyze/tests).

## Reference files (read, don't modify)

| File                                                                              | Why it matters                                                                                                                                                                                                                                                                                                                             |
| --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `mobile/lib/presentation/widgets/timeline/timeline_route_scope.dart`              | The scope this plan adopts. Overrides `timelineGroupingProvider` with `RouteTimelineGroupingNotifier` (opens at All, never persists) unless `persistGrouping: true`, and rebuilds + disposes the timeline service whenever grouping or temporal scope changes (it calls `ref.onDispose(service.dispose)` itself — do **not** add another). |
| `mobile/lib/providers/timeline/timeline_grouping.provider.dart`                   | `RouteTimelineGroupingNotifier.build() => GroupAssetsBy.day`; `set()` mutates state only.                                                                                                                                                                                                                                                  |
| `mobile/lib/presentation/pages/drift_place_detail.page.dart`                      | Canonical example of the `TimelineRouteScope` + `withGroupingPill: true` pattern.                                                                                                                                                                                                                                                          |
| `mobile/lib/presentation/widgets/timeline/timeline_grouping_selector.widget.dart` | Segment keys are `Key('timeline-grouping-year')` / `-month` / `-day`; labels fall back to "Years"/"Months"/"All" when translations are missing.                                                                                                                                                                                            |
| `mobile/test/presentation/widgets/timeline/timeline_with_grouping_pill_test.dart` | Real `TimelineService` built from a record query; pill key `Key('timeline-grouping-bottom-pill')`. Any test that renders a `Timeline` with bucket data MUST wrap the tree in `EasyLocalization` (`path: '../i18n'`) — `TimelineHeader` reads `context.locale` and null-derefs without it.                                                  |
| `mobile/lib/infrastructure/repositories/timeline.repository.dart:957-1080`        | `map()` query — already grouping- and temporal-scope-aware.                                                                                                                                                                                                                                                                                |

---

### Task 1: Characterization test — `DriftTimelineRepository.map()` buckets by month and year

The UI change makes the map timeline depend on month/year bucketing of the map query for the first time. The code already supports it but every existing `map()` test uses `GroupAssetsBy.day`. Pin the behavior. This is a characterization test: it must **pass immediately** — if it fails, stop and report, because the premise of the whole plan is wrong.

**Files:**

- Test: `mobile/test/infrastructure/repositories/timeline_repository_test.dart` (add inside the existing `group('DriftTimelineRepository.map() bucket sheet', ...)` which starts at line 446, after the last test of that group)

- [ ] **Step 1: Add the test**

The group already has local helpers `globeBounds()`, `europeBounds()`, `insertExifAt(id, lat, lng)`, and the file-level `insertUser`. The file-level `insertVideo` hardcodes `createdAt = DateTime(2024, 1, 1, 12)`, so add a group-local insert helper with a controllable date (companion fields copied from `insertVideo`):

```dart
    Future<void> insertImageAt(String id, String ownerId, DateTime createdAt) => db
        .into(db.remoteAssetEntity)
        .insert(
          RemoteAssetEntityCompanion.insert(
            id: id,
            name: '$id.jpg',
            type: AssetType.image,
            checksum: 'c-$id',
            ownerId: ownerId,
            visibility: AssetVisibility.timeline,
            createdAt: Value(createdAt),
            updatedAt: Value(createdAt),
            localDateTime: Value(createdAt),
          ),
        );

    test('map() groups buckets by month and year', () async {
      await insertUser('viewer');
      // Mid-day times: drift stores DateTimes as UTC text and the bucketing
      // strftime sees the UTC representation, so naive midnight values shift
      // into the previous month/year in non-UTC zones (same precedent as
      // shared_space_repository_test.dart).
      await insertImageAt('jan1', 'viewer', DateTime(2024, 1, 10, 12));
      await insertImageAt('jan2', 'viewer', DateTime(2024, 1, 20, 12));
      await insertImageAt('mar1', 'viewer', DateTime(2024, 3, 5, 12));
      await insertImageAt('prev1', 'viewer', DateTime(2023, 7, 1, 12));
      for (final id in ['jan1', 'jan2', 'mar1', 'prev1']) {
        await insertExifAt(id, 48.85, 2.35); // Paris — inside europeBounds()
      }

      final monthBuckets = await sut
          .map(['viewer'], 'viewer', TimelineMapOptions(bounds: europeBounds()), GroupAssetsBy.month)
          .bucketSource()
          .first;
      expect(monthBuckets, [
        TimeBucket(date: DateTime(2024, 3), assetCount: 1),
        TimeBucket(date: DateTime(2024, 1), assetCount: 2),
        TimeBucket(date: DateTime(2023, 7), assetCount: 1),
      ]);

      final yearBuckets = await sut
          .map(['viewer'], 'viewer', TimelineMapOptions(bounds: europeBounds()), GroupAssetsBy.year)
          .bucketSource()
          .first;
      expect(yearBuckets, [
        TimeBucket(date: DateTime(2024), assetCount: 3),
        TimeBucket(date: DateTime(2023), assetCount: 1),
      ]);
    });
```

`TimeBucket`, `GroupAssetsBy`, `TimelineMapOptions`, `AssetType`, `AssetVisibility`, and drift's `Value` are all already imported by this file (the surrounding tests use them). The assertion idiom (whole-`TimeBucket` list equality, local `DateTime`s truncated to month/year, descending order) matches `test/infrastructure/repositories/timeline_year_grouping_test.dart`, which pins the same convention for `remote()`/`remoteAlbum()`/`localAlbum()`. If the test fails, do not change production code — stop and report.

- [ ] **Step 2: Run the test**

```bash
flutter test test/infrastructure/repositories/timeline_repository_test.dart
```

Expected: ALL PASS, including the new test (`map() groups buckets by month and year`). If the new test fails, STOP — report the failure instead of patching production code; the plan's premise needs review.

- [ ] **Step 3: Commit**

```bash
git add test/infrastructure/repositories/timeline_repository_test.dart
git commit -m "test(mobile): pin month/year bucketing of DriftTimelineRepository.map()"
```

---

### Task 2: TDD — map bottom sheet adopts TimelineRouteScope + grouping pill

**Files:**

- Modify: `mobile/lib/presentation/widgets/bottom_sheet/map_bottom_sheet.widget.dart` (69 lines, full rewrite of `MapBottomSheetTimeline` below)
- Test: `mobile/test/presentation/widgets/bottom_sheet/map_bottom_sheet_timeline_test.dart` (full rewrite — the existing single test asserts the forced-day behavior this task removes)

- [ ] **Step 1: Rewrite the test file with the new expectations**

Replace the entire contents of `mobile/test/presentation/widgets/bottom_sheet/map_bottom_sheet_timeline_test.dart` with:

```dart
import 'package:easy_localization/easy_localization.dart' hide TextDirection;
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/domain/models/asset/base_asset.model.dart';
import 'package:immich_mobile/domain/models/setting.model.dart';
import 'package:immich_mobile/domain/models/timeline.model.dart';
import 'package:immich_mobile/domain/models/timeline_temporal_scope.model.dart';
import 'package:immich_mobile/domain/models/user.model.dart';
import 'package:immich_mobile/domain/services/setting.service.dart';
import 'package:immich_mobile/domain/services/timeline.service.dart';
import 'package:immich_mobile/domain/services/user.service.dart';
import 'package:immich_mobile/infrastructure/repositories/timeline.repository.dart';
import 'package:immich_mobile/presentation/widgets/bottom_sheet/map_bottom_sheet.widget.dart';
import 'package:immich_mobile/presentation/widgets/map/map.state.dart';
import 'package:immich_mobile/presentation/widgets/timeline/timeline.widget.dart';
import 'package:immich_mobile/providers/infrastructure/readonly_mode.provider.dart';
import 'package:immich_mobile/providers/infrastructure/setting.provider.dart';
import 'package:immich_mobile/providers/infrastructure/timeline.provider.dart';
import 'package:immich_mobile/providers/user.provider.dart';
import 'package:intl/date_symbol_data_local.dart';
import 'package:maplibre_gl/maplibre_gl.dart';
import 'package:mocktail/mocktail.dart';
// easy_localization initializes shared_preferences internally; tests need the mock initializer.
// ignore: depend_on_referenced_packages
import 'package:shared_preferences/shared_preferences.dart';

import '../../../test_utils.dart';

class _MockTimelineFactory extends Mock implements TimelineFactory {}

class _MockSettingsService extends Mock implements SettingsService {}

class _MockUserService extends Mock implements UserService {}

class _StubSettingsNotifier extends SettingsNotifier {
  _StubSettingsNotifier(this._settings);

  final SettingsService _settings;

  @override
  SettingsService build() => _settings;
}

class _StubReadOnlyModeNotifier extends ReadOnlyModeNotifier {
  @override
  bool build() => false;
}

class _StubCurrentUserNotifier extends CurrentUserProvider {
  _StubCurrentUserNotifier(super.service, UserDto user) {
    state = user;
  }
}

class _MutableMapStateNotifier extends MapStateNotifier {
  _MutableMapStateNotifier(this._initial);

  final MapState _initial;

  @override
  MapState build() => _initial;

  // NOTE: MapState.== compares bounds only; tests update with changed bounds
  // so the service rebuild is attributable to the simulated pan.
  void update(MapState next) => state = next;
}

UserDto _user(String id) => UserDto(id: id, email: '$id@example.com', name: id, profileChangedAt: DateTime(2024));

/// A real TimelineService over an empty bucket so the timeline renders without
/// Store/thumbnail plumbing while the grouping pill stays interactive.
TimelineService _mapService() => TimelineService((
  bucketSource: () => Stream.value([TimeBucket(date: DateTime(2024, 1), assetCount: 0)]),
  assetSource: (offset, count) async => const <BaseAsset>[],
  origin: TimelineOrigin.map,
));

typedef _Harness = ({
  _MockTimelineFactory factory,
  _MockSettingsService settings,
  _MutableMapStateNotifier mapNotifier,
});

Future<_Harness> _pumpMapTimeline(
  WidgetTester tester, {
  MapState? mapState,
  List<Override> extraOverrides = const [],
}) async {
  final user = _user('user-1');
  final userService = _MockUserService();
  final factory = _MockTimelineFactory();
  final settings = _MockSettingsService();
  final mapNotifier = _MutableMapStateNotifier(
    mapState ?? MapState(bounds: LatLngBounds(northeast: const LatLng(1, 1), southwest: const LatLng(0, 0))),
  );

  when(() => userService.tryGetMyUser()).thenReturn(user);
  when(() => userService.watchMyUser()).thenAnswer((_) => const Stream<UserDto?>.empty());
  when(() => settings.get(Setting.tilesPerRow)).thenReturn(3);
  // A fresh service per call: TimelineRouteScope disposes the previous one on
  // every grouping/bounds rebuild.
  when(
    () => factory.map(any(), any(), any(), groupBy: any(named: 'groupBy'), temporalScope: any(named: 'temporalScope')),
  ).thenAnswer((_) => _mapService());

  await tester.pumpWidget(
    ProviderScope(
      overrides: [
        currentUserProvider.overrideWith((ref) => _StubCurrentUserNotifier(userService, user)),
        readonlyModeProvider.overrideWith(() => _StubReadOnlyModeNotifier()),
        settingsProvider.overrideWith(() => _StubSettingsNotifier(settings)),
        timelineFactoryProvider.overrideWithValue(factory),
        mapStateProvider.overrideWith(() => mapNotifier),
        ...extraOverrides,
      ],
      // EasyLocalization must wrap the app: TimelineHeader reads context.locale,
      // which null-derefs without the widget in the tree.
      child: EasyLocalization(
        supportedLocales: const [Locale('en')],
        path: '../i18n',
        fallbackLocale: const Locale('en'),
        child: const MaterialApp(home: MapBottomSheetTimeline()),
      ),
    ),
  );
  // Bounded pumps instead of pumpAndSettle: timeline loading indicators animate
  // indefinitely, so pumpAndSettle can time out.
  await tester.pump();
  await tester.pump(const Duration(milliseconds: 600));
  return (factory: factory, settings: settings, mapNotifier: mapNotifier);
}

void main() {
  setUpAll(() async {
    TestUtils.init();
    SharedPreferences.setMockInitialValues({});
    await EasyLocalization.ensureInitialized();
    await initializeDateFormatting('en');
    registerFallbackValue(
      TimelineMapOptions(bounds: LatLngBounds(northeast: const LatLng(0, 0), southwest: const LatLng(0, 0))),
    );
    registerFallbackValue(const TimelineTemporalScope.none());
    registerFallbackValue(GroupAssetsBy.day);
  });

  testWidgets('opens at All grouping with the grouping pill and no forced groupBy', (tester) async {
    final harness = await _pumpMapTimeline(tester);

    verify(
      () => harness.factory.map(
        ['user-1'],
        'user-1',
        any(),
        groupBy: GroupAssetsBy.day,
        temporalScope: const TimelineTemporalScope.none(),
      ),
    ).called(1);
    // Grouping must come from the route-scoped provider, not a Timeline override.
    expect(tester.widget<Timeline>(find.byType(Timeline)).groupBy, isNull);
    expect(find.byKey(const Key('timeline-grouping-bottom-pill')), findsOneWidget);
  });

  testWidgets('tapping Months regroups the map timeline without persisting the setting', (tester) async {
    final harness = await _pumpMapTimeline(tester);

    await tester.tap(find.byKey(const Key('timeline-grouping-month')));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 600));

    verify(
      () => harness.factory.map(
        ['user-1'],
        'user-1',
        any(),
        groupBy: GroupAssetsBy.month,
        temporalScope: any(named: 'temporalScope'),
      ),
    ).called(1);
    // Route-local grouping: the map sheet must never write Setting.groupAssetsBy.
    verifyNever(() => harness.settings.set(Setting.groupAssetsBy, any<int>()));
  });

  testWidgets('withPartners includes partner ids in the map service users', (tester) async {
    final harness = await _pumpMapTimeline(
      tester,
      mapState: MapState(
        bounds: LatLngBounds(northeast: const LatLng(1, 1), southwest: const LatLng(0, 0)),
        withPartners: true,
      ),
      extraOverrides: [
        timelineUsersProvider.overrideWith((_) => Stream<List<String>>.value(['user-1', 'partner-1'])),
      ],
    );

    // The first build may run before the users stream emits (falls back to
    // [user.id]); once it emits, the service must rebuild with both ids.
    verify(
      () => harness.factory.map(
        ['user-1', 'partner-1'],
        'user-1',
        any(),
        groupBy: GroupAssetsBy.day,
        temporalScope: any(named: 'temporalScope'),
      ),
    ).called(1);
  });

  testWidgets('grouping selection survives a map move', (tester) async {
    final harness = await _pumpMapTimeline(tester);

    await tester.tap(find.byKey(const Key('timeline-grouping-month')));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 600));
    verify(
      () => harness.factory.map(
        any(),
        any(),
        any(),
        groupBy: GroupAssetsBy.month,
        temporalScope: any(named: 'temporalScope'),
      ),
    ).called(1);

    // Pan the map: new bounds rebuild the service, but the route-local grouping
    // must stay at month — a bounds change must not tear down the route scope.
    harness.mapNotifier.update(
      MapState(bounds: LatLngBounds(northeast: const LatLng(2, 2), southwest: const LatLng(1, 1))),
    );
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 600));

    // The verify above consumed the tap-triggered call, so this counts only the
    // bounds-triggered rebuild.
    verify(
      () => harness.factory.map(
        any(),
        any(),
        any(),
        groupBy: GroupAssetsBy.month,
        temporalScope: any(named: 'temporalScope'),
      ),
    ).called(1);
  });
}
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
flutter test test/presentation/widgets/bottom_sheet/map_bottom_sheet_timeline_test.dart
```

Expected: all 4 tests FAIL. Likely failure modes (any of these is the correct red): `MissingStubError` on `factory.map` (current code calls it without the `temporalScope` named argument, so the stub doesn't match), tap-target not found for `Key('timeline-grouping-month')` (no pill rendered — note `TestUtils.init()` makes missed taps fatal), `Expected: exactly one matching candidate / Actual: zero` for `Key('timeline-grouping-bottom-pill')`, or `expect(... .groupBy, isNull)` failing with `GroupAssetsBy.day`. If any test PASSES, something is wrong — stop and re-check you replaced the file.

- [ ] **Step 3: Rewrite the widget**

Replace the entire contents of `mobile/lib/presentation/widgets/bottom_sheet/map_bottom_sheet.widget.dart` with:

```dart
import 'package:flutter/material.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/extensions/build_context_extensions.dart';
import 'package:immich_mobile/presentation/widgets/bottom_sheet/base_bottom_sheet.widget.dart';
import 'package:immich_mobile/presentation/widgets/map/map.state.dart';
import 'package:immich_mobile/presentation/widgets/timeline/timeline.widget.dart';
import 'package:immich_mobile/presentation/widgets/timeline/timeline_route_scope.dart';
import 'package:immich_mobile/providers/infrastructure/timeline.provider.dart';
import 'package:immich_mobile/providers/user.provider.dart';

class MapBottomSheet extends StatelessWidget {
  const MapBottomSheet({super.key});

  @override
  Widget build(BuildContext context) {
    return BaseBottomSheet(
      initialChildSize: 0.25,
      maxChildSize: 0.75,
      shouldCloseOnMinExtent: false,
      resizeOnScroll: false,
      actions: [],
      backgroundColor: context.themeData.colorScheme.surface,
      slivers: [const SliverFillRemaining(hasScrollBody: false, child: MapBottomSheetTimeline())],
    );
  }
}

class MapBottomSheetTimeline extends StatelessWidget {
  const MapBottomSheetTimeline({super.key});

  @override
  Widget build(BuildContext context) {
    // TODO: watching mapStateProvider rebuilds the service on every map move, flickering
    // the timeline through its loading state. This is both janky and inefficient.
    return TimelineRouteScope(
      timelineServiceBuilder: (ref, scope, groupBy) {
        final user = ref.watch(currentUserProvider);
        if (user == null) {
          throw Exception('User must be logged in to access the map timeline');
        }

        final users = ref.watch(mapStateProvider).withPartners
            ? ref.watch(timelineUsersProvider).valueOrNull ?? [user.id]
            : [user.id];

        return ref
            .watch(timelineFactoryProvider)
            .map(users, user.id, ref.watch(mapStateProvider).toOptions(), groupBy: groupBy, temporalScope: scope);
      },
      child: const Timeline(appBar: null, bottomSheet: null, withScrubber: false, withGroupingPill: true),
    );
  }
}
```

What changed and why:

- The raw `ProviderScope` + `timelineServiceProvider.overrideWith` is replaced by `TimelineRouteScope.timelineServiceBuilder`. The scope already watches the route-local grouping and temporal scope, rebuilds the service when either changes, and disposes the old service (`ref.onDispose` lives inside `TimelineRouteScope` — adding another here would double-dispose).
- `forcedTimelineGroupBy` is deleted; `groupBy` and `temporalScope` now flow from the scope into `timelineFactory.map(...)`. The repository applies both (no data-layer change).
- `Timeline` loses `groupBy:` (so segmentation follows the scoped `timelineGroupingProvider`, opening at All) and gains `withGroupingPill: true` (the same bottom pill as the 11 other detail timelines; it reserves its own bottom clearance and hides during multiselect).
- `persistGrouping` stays at its default `false`: grouping changes on the map are route-local and reset to All next time, matching album/person/place detail behavior.
- Imports: `domain/models/timeline.model.dart` is no longer used and must be removed (CI runs `dart analyze --fatal-infos`; an unused import fails the build). `hooks_riverpod` STAYS — the builder uses the `valueOrNull` AsyncValue extension it exports.

- [ ] **Step 4: Run the test to verify it passes**

```bash
flutter test test/presentation/widgets/bottom_sheet/map_bottom_sheet_timeline_test.dart
```

Expected: PASS (4 tests).

- [ ] **Step 5: Run the neighboring timeline suites to catch regressions**

```bash
flutter test test/presentation/widgets/timeline/ test/presentation/pages/timeline_route_adoption_test.dart
```

Expected: ALL PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/presentation/widgets/bottom_sheet/map_bottom_sheet.widget.dart \
        test/presentation/widgets/bottom_sheet/map_bottom_sheet_timeline_test.dart
git commit -m "feat(mobile): timeline grouping pill on the map bottom sheet"
```

---

### Task 3: Full verification gate

CI for mobile is stricter than a quick local loop (see CLAUDE.md / project memory): analysis runs `--fatal-infos` over `lib` **and** `test`, and format checks `lib/`.

**Files:** none new — fixes only if a gate fails.

- [ ] **Step 1: Full test suite**

```bash
flutter test
```

Expected: 1753 passed (1749 baseline + 1 repo test + 4 widget tests − the 1 rewritten test), 1 skipped, 0 failures.

- [ ] **Step 2: Analyzer at CI strictness**

```bash
dart analyze --fatal-infos lib test
```

Expected: `No issues found!`. Note: pass `lib test` explicitly — a bare `dart analyze --fatal-infos` pulls in `packages/ui/showcase` and produces ~175 spurious unresolved-dep errors.

- [ ] **Step 3: Format check (lib only, like CI)**

```bash
mise run format
```

Expected: exit 0 with no changes. If it reformats files, re-run the touched test files (`flutter test test/presentation/widgets/bottom_sheet/ test/infrastructure/repositories/timeline_repository_test.dart`), then commit:

```bash
git add -u
git commit -m "chore(mobile): dart format"
```

- [ ] **Step 4: Report**

Report the three gate outputs verbatim (test count, analyze result, format result). Do not claim success without them.

---

## Out of scope / notes for the reviewer

- **Drill-down works for free:** with `TimelineRouteScope` in place, tapping a Year/Month overview card runs the shared drill-down handler (temporal scope + finer grouping). The map repository query honors temporal scope — already covered by `timeline_temporal_scope_repository_test.dart` ("video/place/person/map year scopes preserve constraints").
- **Pill placement:** the pill floats inside the bottom sheet's timeline area (bottom of the visible sheet). At the initial 25% sheet height it occupies a noticeable share of the sheet — identical widget and clearance behavior to every other detail timeline; any placement tweak is a follow-up UX decision, not part of this plan.
- **Map-move flicker:** rebuilding the timeline service on every map pan (the pre-existing TODO) is unchanged by this plan.
- **No server/web/OpenAPI/i18n changes:** web's map already has grouping (`MapTimelinePanel.svelte`); the pill reuses existing `timeline_grouping_*` translation keys.
- **Manual smoke (post-merge or on-device):** open Places → tap the map → pill shows "All" selected; tap "Years"/"Months" → list regroups into overview cards; tap a year card → drills into months; pan the map → grouping selection survives (provider is scope-local, the service rebuild is not a scope teardown).
