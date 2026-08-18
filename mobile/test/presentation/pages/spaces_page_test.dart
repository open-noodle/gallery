import 'dart:async';

import 'package:drift/drift.dart' as drift;
import 'package:drift/native.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/domain/models/settings_key.dart';
import 'package:immich_mobile/domain/services/store.service.dart';
import 'package:immich_mobile/entities/store.entity.dart';
import 'package:immich_mobile/infrastructure/repositories/db.repository.dart';
import 'package:immich_mobile/infrastructure/repositories/settings.repository.dart';
import 'package:immich_mobile/infrastructure/repositories/store.repository.dart';
import 'package:immich_mobile/pages/library/spaces/collection_sort.dart';
import 'package:immich_mobile/pages/library/spaces/spaces.page.dart';
import 'package:immich_mobile/providers/shared_space.provider.dart';
import 'package:immich_mobile/widgets/spaces/space_card.dart';
import 'package:openapi/api.dart';

import '../../test_utils.dart';
import '../../widget_tester_extensions.dart';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/// Builds a fully-populated [SharedSpaceResponseDto] for widget tests.
///
/// Every `Optional` field that [SpaceCard.build] reads via `.value`
/// (`newAssetCount`, `recentAssetIds`, `recentAssetThumbhashes`, `color`,
/// `members`, `assetCount`, `memberCount`) MUST be present — `.value` throws
/// a `StateError` on an absent `Optional`, which crashes the card render.
SharedSpaceResponseDto _space({
  required String id,
  String? name,
  int memberCount = 0,
  int assetCount = 0,
  DateTime? createdAt,
  DateTime? updatedAt,
  DateTime? lastActivityAt,
}) {
  final created = createdAt ?? DateTime.utc(2026, 1, 1);
  final updated = updatedAt ?? created;
  return SharedSpaceResponseDto(
    id: id,
    name: name ?? 'Space $id',
    createdAt: created.toIso8601String(),
    updatedAt: updated.toIso8601String(),
    createdById: 'user-1',
    memberCount: Optional.present(memberCount),
    assetCount: Optional.present(assetCount),
    lastActivityAt: Optional.present(lastActivityAt?.toIso8601String()),
    newAssetCount: const Optional.present(0),
    recentAssetIds: const Optional.present(<String>[]),
    recentAssetThumbhashes: const Optional.present(<String>[]),
    members: const Optional.present(<SharedSpaceMemberResponseDto>[]),
    color: const Optional.present(UserAvatarColor.blue),
  );
}

/// Overrides [sharedSpacesProvider] with a fixed list, for use with
/// [WidgetTester.pumpConsumerWidget]'s `overrides` param.
List<Override> _overrides(List<SharedSpaceResponseDto> spaces) => [
  sharedSpacesProvider.overrideWith((_) async => spaces),
];

/// The visually-first card among [ids] (top-left-most in reading order),
/// determined from actual on-screen position — robust to grid row/column
/// layout regardless of how many items are present.
String _firstCardByPosition(WidgetTester tester, List<String> ids) {
  final positions = {for (final id in ids) id: tester.getTopLeft(find.byKey(Key('space-card-$id')))};
  final sorted = positions.entries.toList()
    ..sort((a, b) {
      final dy = a.value.dy.compareTo(b.value.dy);
      return dy != 0 ? dy : a.value.dx.compareTo(b.value.dx);
    });
  return sorted.first.key;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

void main() {
  late Drift db;

  setUpAll(() async {
    TestWidgetsFlutterBinding.ensureInitialized();
    TestUtils.init();
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

  testWidgets('3 spaces: renders cards, the "3 spaces" count, and the create ＋ FAB', (tester) async {
    final spaces = [
      _space(id: 's1', name: 'Family Photos'),
      _space(id: 's2', name: 'Travel 2024'),
      _space(id: 's3', name: 'Team Project'),
    ];

    await tester.pumpConsumerWidget(const SpacesPage(), overrides: _overrides(spaces));

    // Result count is the reliable "3 spaces present" signal — the second grid
    // row may be below the fold in the test viewport, so not every card key is
    // guaranteed on-screen.
    expect(find.text('3 spaces'), findsOneWidget);
    // At least the first (top-left) card renders.
    expect(find.byType(SpaceCard), findsWidgets);
    // The create ＋ FAB is present.
    expect(find.byType(FloatingActionButton), findsOneWidget);
  });

  // ---------------------------------------------------------------------
  // Search
  // ---------------------------------------------------------------------

  testWidgets('typing a query filters the grid to matching spaces', (tester) async {
    final spaces = [
      _space(id: 's1', name: 'Italy Summer'),
      _space(id: 's2', name: 'Italy Winter'),
      _space(id: 's3', name: 'Hawaii'),
    ];

    await tester.pumpConsumerWidget(const SpacesPage(), overrides: _overrides(spaces));

    expect(find.text('3 spaces'), findsOneWidget);
    expect(find.byKey(const Key('spaces-search-field')), findsOneWidget);
    expect(find.byKey(const Key('spaces-search-clear')), findsNothing);

    await tester.enterText(find.byKey(const Key('spaces-search-field')), 'ita');
    await tester.pumpAndSettle();

    expect(find.byKey(const Key('space-card-s1')), findsOneWidget);
    expect(find.byKey(const Key('space-card-s2')), findsOneWidget);
    expect(find.byKey(const Key('space-card-s3')), findsNothing);
    expect(find.byKey(const Key('spaces-search-clear')), findsOneWidget);
    expect(find.text('2 of 3 · matches "ita"'), findsOneWidget);
  });

  testWidgets('tapping the clear (✕) button resets the query and restores the full list', (tester) async {
    final spaces = [_space(id: 's1', name: 'Italy Summer'), _space(id: 's2', name: 'Hawaii')];

    await tester.pumpConsumerWidget(const SpacesPage(), overrides: _overrides(spaces));

    await tester.enterText(find.byKey(const Key('spaces-search-field')), 'ita');
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('space-card-s2')), findsNothing);

    await tester.tap(find.byKey(const Key('spaces-search-clear')));
    await tester.pumpAndSettle();

    expect(find.byKey(const Key('space-card-s1')), findsOneWidget);
    expect(find.byKey(const Key('space-card-s2')), findsOneWidget);
    expect(find.byKey(const Key('spaces-search-clear')), findsNothing);
  });

  // ---------------------------------------------------------------------
  // No-match vs genuinely-empty
  // ---------------------------------------------------------------------

  testWidgets('a query matching nothing shows the no-match state, not the empty state', (tester) async {
    final spaces = [_space(id: 's1', name: 'Italy Summer'), _space(id: 's2', name: 'Hawaii')];

    await tester.pumpConsumerWidget(const SpacesPage(), overrides: _overrides(spaces));

    await tester.enterText(find.byKey(const Key('spaces-search-field')), 'zzz');
    await tester.pumpAndSettle();

    expect(find.byKey(const Key('spaces-no-match')), findsOneWidget);
    expect(find.byKey(const Key('spaces-empty')), findsNothing);
    expect(find.byKey(const Key('space-card-s1')), findsNothing);
    expect(find.byKey(const Key('space-card-s2')), findsNothing);
    expect(
      find.descendant(of: find.byKey(const Key('spaces-no-match')), matching: find.textContaining('zzz')),
      findsOneWidget,
    );
  });

  testWidgets('a genuinely empty spaces list still shows the empty state, not the no-match state', (tester) async {
    await tester.pumpConsumerWidget(const SpacesPage(), overrides: _overrides(const []));

    expect(find.byKey(const Key('spaces-empty')), findsOneWidget);
    expect(find.byKey(const Key('spaces-no-match')), findsNothing);
    // No search/sort chrome when there are zero spaces
    expect(find.byKey(const Key('spaces-search-field')), findsNothing);
    // FAB still present
    expect(find.byType(FloatingActionButton), findsOneWidget);
  });

  // ---------------------------------------------------------------------
  // Sort
  // ---------------------------------------------------------------------

  testWidgets('picking a different sort mode reorders the grid and persists the choice', (tester) async {
    final spaces = [
      _space(id: 's1', name: 'Low Members', memberCount: 2, lastActivityAt: DateTime.utc(2026, 1, 10)),
      _space(id: 's2', name: 'High Members', memberCount: 8, lastActivityAt: DateTime.utc(2026, 1, 1)),
    ];

    await tester.pumpConsumerWidget(const SpacesPage(), overrides: _overrides(spaces));

    // Default mode is "Recent activity" (desc) -> s1 (more recent) sorts first.
    expect(_firstCardByPosition(tester, ['s1', 's2']), 's1');

    await tester.tap(find.byKey(const Key('collection-sort-button-pill')));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Members'));
    await tester.pumpAndSettle();

    // Now sorted by member count desc -> s2 (8 members) sorts before s1 (2).
    expect(_firstCardByPosition(tester, ['s1', 's2']), 's2');
    expect(SettingsRepository.instance.appConfig.spaces.sortMode, SpaceSortMode.members);
    expect(SettingsRepository.instance.appConfig.spaces.isReverse, false);
  });

  testWidgets('re-tapping the current sort mode reverses the order and persists it', (tester) async {
    final spaces = [
      _space(id: 's1', name: 'Low Members', memberCount: 2, lastActivityAt: DateTime.utc(2026, 1, 10)),
      _space(id: 's2', name: 'High Members', memberCount: 8, lastActivityAt: DateTime.utc(2026, 1, 1)),
    ];

    await tester.pumpConsumerWidget(const SpacesPage(), overrides: _overrides(spaces));

    expect(_firstCardByPosition(tester, ['s1', 's2']), 's1');

    // Re-tap the already-selected mode ("Recent activity") -> reverses.
    await tester.tap(find.byKey(const Key('collection-sort-button-pill')));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Recent activity'));
    await tester.pumpAndSettle();

    expect(_firstCardByPosition(tester, ['s1', 's2']), 's2');
    expect(SettingsRepository.instance.appConfig.spaces.sortMode, SpaceSortMode.recentActivity);
    expect(SettingsRepository.instance.appConfig.spaces.isReverse, true);
  });

  // ---------------------------------------------------------------------
  // Loading / error branches: no search/sort chrome
  // ---------------------------------------------------------------------

  testWidgets('loading state renders a spinner without search/sort controls', (tester) async {
    final completer = Completer<List<SharedSpaceResponseDto>>();
    addTearDown(() {
      if (!completer.isCompleted) {
        completer.complete(const []);
      }
    });

    await tester.pumpConsumerWidgetRaw(
      const SpacesPage(),
      overrides: [sharedSpacesProvider.overrideWith((_) => completer.future)],
    );
    await tester.pump();

    expect(find.byType(CircularProgressIndicator), findsOneWidget);
    expect(find.byKey(const Key('spaces-search-field')), findsNothing);
    expect(find.byKey(const Key('collection-sort-button-pill')), findsNothing);
    // FAB still present even while loading
    expect(find.byType(FloatingActionButton), findsOneWidget);
  });

  testWidgets('error state renders the error message without search/sort controls', (tester) async {
    await tester.pumpConsumerWidgetRaw(
      const SpacesPage(),
      overrides: [sharedSpacesProvider.overrideWith((_) async => throw Exception('Network error'))],
    );
    await tester.pump();
    await tester.pump();

    expect(find.textContaining('Failed to load spaces'), findsOneWidget);
    expect(find.byKey(const Key('spaces-search-field')), findsNothing);
    expect(find.byKey(const Key('collection-sort-button-pill')), findsNothing);
    // FAB still present even on error
    expect(find.byType(FloatingActionButton), findsOneWidget);
  });
}
