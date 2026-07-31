import 'dart:async';

import 'package:drift/drift.dart' as drift;
import 'package:drift/native.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/domain/models/settings_key.dart';
import 'package:immich_mobile/domain/models/space_album.model.dart';
import 'package:immich_mobile/domain/services/store.service.dart';
import 'package:immich_mobile/entities/store.entity.dart';
import 'package:immich_mobile/infrastructure/repositories/db.repository.dart';
import 'package:immich_mobile/infrastructure/repositories/settings.repository.dart';
import 'package:immich_mobile/infrastructure/repositories/store.repository.dart';
import 'package:immich_mobile/pages/library/spaces/collection_sort.dart';
import 'package:immich_mobile/pages/library/spaces/space_albums.page.dart';
import 'package:immich_mobile/providers/infrastructure/space_album.provider.dart';

import '../../test_utils.dart';
import '../../widget_tester_extensions.dart';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

SpaceAlbum _album({
  required String id,
  String? name,
  int assetCount = 0,
  bool showInTimeline = true,
  DateTime? linkedAt,
  DateTime? updatedAt,
}) => SpaceAlbum(
  id: id,
  name: name ?? 'Album $id',
  assetCount: assetCount,
  showInTimeline: showInTimeline,
  linkedAt: linkedAt ?? DateTime.utc(2026, 1, 1),
  updatedAt: updatedAt ?? DateTime.utc(2026, 1, 1),
);

/// Overrides [spaceAlbumsProvider] with a fixed list, for use with
/// [WidgetTester.pumpConsumerWidget]'s `overrides` param.
List<Override> _overrides({required String spaceId, required List<SpaceAlbum> albums}) => [
  spaceAlbumsProvider(spaceId).overrideWith((_) => Stream.value(albums)),
];

/// The visually-first card among [ids] (top-left-most in reading order),
/// determined from actual on-screen position — robust to grid
/// row/column layout regardless of how many items are present.
String _firstCardByPosition(WidgetTester tester, List<String> ids) {
  final positions = {for (final id in ids) id: tester.getTopLeft(find.byKey(Key('space-album-card-$id')))};
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
  const spaceId = 'space-1';

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

  testWidgets('editor + 2 albums: shows 2 cards with ⋮ menu and ＋ Link action', (tester) async {
    final albums = [
      _album(id: 'a1', name: 'Hawaii', assetCount: 142),
      _album(id: 'a2', name: 'Sunsets', assetCount: 38),
    ];

    await tester.pumpConsumerWidget(
      const SpaceAlbumsPage(spaceId: spaceId, canEdit: true),
      overrides: _overrides(spaceId: spaceId, albums: albums),
    );

    // 2 cards
    expect(find.byKey(const Key('space-album-card-a1')), findsOneWidget);
    expect(find.byKey(const Key('space-album-card-a2')), findsOneWidget);
    // ⋮ overflow menu on each card (editor)
    expect(find.byKey(const Key('space-album-card-menu-a1')), findsOneWidget);
    expect(find.byKey(const Key('space-album-card-menu-a2')), findsOneWidget);
    // ＋ Link action in app-bar (editor)
    expect(find.byKey(const Key('space-albums-link-action')), findsOneWidget);
  });

  testWidgets('viewer + 2 albums: shows 2 cards but NO ⋮ menu and NO ＋ Link action', (tester) async {
    final albums = [_album(id: 'a1', name: 'Hawaii'), _album(id: 'a2', name: 'Sunsets')];

    await tester.pumpConsumerWidget(
      const SpaceAlbumsPage(spaceId: spaceId, canEdit: false),
      overrides: _overrides(spaceId: spaceId, albums: albums),
    );

    // 2 cards visible
    expect(find.byKey(const Key('space-album-card-a1')), findsOneWidget);
    expect(find.byKey(const Key('space-album-card-a2')), findsOneWidget);
    // No ⋮ menus for viewer
    expect(find.byKey(const Key('space-album-card-menu-a1')), findsNothing);
    expect(find.byKey(const Key('space-album-card-menu-a2')), findsNothing);
    // No ＋ Link action
    expect(find.byKey(const Key('space-albums-link-action')), findsNothing);
  });

  testWidgets('empty + editor: shows empty state', (tester) async {
    await tester.pumpConsumerWidget(
      const SpaceAlbumsPage(spaceId: spaceId, canEdit: true),
      overrides: _overrides(spaceId: spaceId, albums: const []),
    );

    expect(find.byKey(const Key('space-albums-empty')), findsOneWidget);
    // No album cards
    expect(
      find.byWidgetPredicate(
        (w) => w.key is ValueKey<String> && (w.key! as ValueKey<String>).value.startsWith('space-album-card-'),
      ),
      findsNothing,
    );
  });

  testWidgets('off-timeline album card shows visibility_off icon', (tester) async {
    final albums = [
      _album(id: 'a1', name: 'Hawaii', showInTimeline: true),
      _album(id: 'a2', name: 'Reef dives', showInTimeline: false, assetCount: 12),
    ];

    await tester.pumpConsumerWidget(
      const SpaceAlbumsPage(spaceId: spaceId, canEdit: true),
      overrides: _overrides(spaceId: spaceId, albums: albums),
    );

    expect(find.byIcon(Icons.visibility_off), findsOneWidget);
    // The off-timeline card should show the "Hidden" label
    expect(find.text('· Hidden'), findsOneWidget);
  });

  // ---------------------------------------------------------------------
  // Search
  // ---------------------------------------------------------------------

  testWidgets('typing a query filters the grid to matching albums', (tester) async {
    final albums = [
      _album(id: 'hidden1', name: 'Reef dives', showInTimeline: false, assetCount: 12),
      _album(id: 'it1', name: 'Italy Summer'),
      _album(id: 'it2', name: 'Italy Winter'),
    ];

    await tester.pumpConsumerWidget(
      const SpaceAlbumsPage(spaceId: spaceId, canEdit: true),
      overrides: _overrides(spaceId: spaceId, albums: albums),
    );

    // All 3 counted initially (row 2 may be below the fold in the test
    // viewport; the result count is the reliable signal), search field
    // present, no clear button yet.
    expect(find.text('3 albums'), findsOneWidget);
    expect(find.byKey(const Key('space-albums-search-field')), findsOneWidget);
    expect(find.byKey(const Key('space-albums-search-clear')), findsNothing);

    await tester.enterText(find.byKey(const Key('space-albums-search-field')), 'ita');
    await tester.pumpAndSettle();

    // Only the two Italy albums remain
    expect(find.byKey(const Key('space-album-card-hidden1')), findsNothing);
    expect(find.byKey(const Key('space-album-card-it1')), findsOneWidget);
    expect(find.byKey(const Key('space-album-card-it2')), findsOneWidget);
    // Clear (✕) button now shows
    expect(find.byKey(const Key('space-albums-search-clear')), findsOneWidget);
    // Result count reflects filtered-of-total plus the query while searching
    expect(find.text('2 of 3 · matches "ita"'), findsOneWidget);
  });

  testWidgets('tapping the clear (✕) button resets the query and restores the full list', (tester) async {
    final albums = [_album(id: 'it1', name: 'Italy Summer'), _album(id: 'hawaii1', name: 'Hawaii')];

    await tester.pumpConsumerWidget(
      const SpaceAlbumsPage(spaceId: spaceId, canEdit: true),
      overrides: _overrides(spaceId: spaceId, albums: albums),
    );

    await tester.enterText(find.byKey(const Key('space-albums-search-field')), 'ita');
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('space-album-card-hawaii1')), findsNothing);

    await tester.tap(find.byKey(const Key('space-albums-search-clear')));
    await tester.pumpAndSettle();

    expect(find.byKey(const Key('space-album-card-hawaii1')), findsOneWidget);
    expect(find.byKey(const Key('space-album-card-it1')), findsOneWidget);
    expect(find.byKey(const Key('space-albums-search-clear')), findsNothing);
  });

  // ---------------------------------------------------------------------
  // No-match vs genuinely-empty
  // ---------------------------------------------------------------------

  testWidgets('a query matching nothing shows the no-match state, not the empty state', (tester) async {
    final albums = [_album(id: 'it1', name: 'Italy Summer'), _album(id: 'hawaii1', name: 'Hawaii')];

    await tester.pumpConsumerWidget(
      const SpaceAlbumsPage(spaceId: spaceId, canEdit: true),
      overrides: _overrides(spaceId: spaceId, albums: albums),
    );

    await tester.enterText(find.byKey(const Key('space-albums-search-field')), 'zzz');
    await tester.pumpAndSettle();

    expect(find.byKey(const Key('space-albums-no-match')), findsOneWidget);
    expect(find.byKey(const Key('space-albums-empty')), findsNothing);
    expect(find.byKey(const Key('space-album-card-it1')), findsNothing);
    expect(find.byKey(const Key('space-album-card-hawaii1')), findsNothing);
    expect(
      find.descendant(of: find.byKey(const Key('space-albums-no-match')), matching: find.textContaining('zzz')),
      findsOneWidget,
    );
  });

  testWidgets('a genuinely empty space still shows the empty state, not the no-match state', (tester) async {
    await tester.pumpConsumerWidget(
      const SpaceAlbumsPage(spaceId: spaceId, canEdit: true),
      overrides: _overrides(spaceId: spaceId, albums: const []),
    );

    expect(find.byKey(const Key('space-albums-empty')), findsOneWidget);
    expect(find.byKey(const Key('space-albums-no-match')), findsNothing);
    // No search/sort chrome when the space has zero linked albums
    expect(find.byKey(const Key('space-albums-search-field')), findsNothing);
  });

  // ---------------------------------------------------------------------
  // Sort
  // ---------------------------------------------------------------------

  testWidgets('picking a different sort mode reorders the grid and persists the choice', (tester) async {
    final albums = [
      _album(id: 'r1', name: 'Reorder A', assetCount: 50, linkedAt: DateTime.utc(2026, 1, 1)),
      _album(id: 'r2', name: 'Reorder B', assetCount: 5, linkedAt: DateTime.utc(2026, 1, 10)),
    ];

    await tester.pumpConsumerWidget(
      const SpaceAlbumsPage(spaceId: spaceId, canEdit: true),
      overrides: _overrides(spaceId: spaceId, albums: albums),
    );

    // Default mode is "Recently linked" (desc) -> the more-recently-linked
    // r2 sorts first.
    expect(_firstCardByPosition(tester, ['r1', 'r2']), 'r2');

    await tester.tap(find.byKey(const Key('collection-sort-button-pill')));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Photo count'));
    await tester.pumpAndSettle();

    // Now sorted by asset count desc -> r1 (50) sorts before r2 (5).
    expect(_firstCardByPosition(tester, ['r1', 'r2']), 'r1');
    expect(SettingsRepository.instance.appConfig.spaceAlbums.sortMode, SpaceAlbumSortMode.photoCount);
    expect(SettingsRepository.instance.appConfig.spaceAlbums.isReverse, false);
  });

  testWidgets('re-tapping the current sort mode reverses the order and persists it', (tester) async {
    final albums = [
      _album(id: 'r1', name: 'Reorder A', assetCount: 50, linkedAt: DateTime.utc(2026, 1, 1)),
      _album(id: 'r2', name: 'Reorder B', assetCount: 5, linkedAt: DateTime.utc(2026, 1, 10)),
    ];

    await tester.pumpConsumerWidget(
      const SpaceAlbumsPage(spaceId: spaceId, canEdit: true),
      overrides: _overrides(spaceId: spaceId, albums: albums),
    );

    expect(_firstCardByPosition(tester, ['r1', 'r2']), 'r2');

    // Re-tap the already-selected mode ("Recently linked") -> reverses.
    await tester.tap(find.byKey(const Key('collection-sort-button-pill')));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Recently linked'));
    await tester.pumpAndSettle();

    expect(_firstCardByPosition(tester, ['r1', 'r2']), 'r1');
    expect(SettingsRepository.instance.appConfig.spaceAlbums.sortMode, SpaceAlbumSortMode.recentlyLinked);
    expect(SettingsRepository.instance.appConfig.spaceAlbums.isReverse, true);
  });

  testWidgets('a persisted sort mode is honored on mount, not just after picking it', (tester) async {
    final albums = [
      _album(id: 'r1', name: 'Reorder A', assetCount: 50, linkedAt: DateTime.utc(2026, 1, 1)),
      _album(id: 'r2', name: 'Reorder B', assetCount: 5, linkedAt: DateTime.utc(2026, 1, 10)),
    ];

    // Pre-seed a persisted, non-default sort mode BEFORE the page ever mounts
    // — proves the page reads the stored config on mount rather than merely
    // writing to it when the user picks a mode from the menu.
    await SettingsRepository.instance.write(SettingsKey.spaceAlbumsSortMode, SpaceAlbumSortMode.photoCount);
    await SettingsRepository.instance.write(SettingsKey.spaceAlbumsIsReverse, false);

    await tester.pumpConsumerWidget(
      const SpaceAlbumsPage(spaceId: spaceId, canEdit: true),
      overrides: _overrides(spaceId: spaceId, albums: albums),
    );

    // photoCount desc -> r1 (50) sorts before r2 (5). The default mode
    // (recentlyLinked) would instead put r2 first, so this proves the
    // persisted mode was actually read, not just the default applied.
    expect(_firstCardByPosition(tester, ['r1', 'r2']), 'r1');
    expect(find.text('Sort: Photo count'), findsOneWidget);
  });

  // ---------------------------------------------------------------------
  // Regression: search + sort chrome doesn't affect role gating
  // ---------------------------------------------------------------------

  testWidgets('search field and sort pill render for both editor and viewer', (tester) async {
    final albums = [_album(id: 'a1', name: 'Hawaii'), _album(id: 'a2', name: 'Sunsets')];

    await tester.pumpConsumerWidget(
      const SpaceAlbumsPage(spaceId: spaceId, canEdit: false),
      overrides: _overrides(spaceId: spaceId, albums: albums),
    );

    expect(find.byKey(const Key('space-albums-search-field')), findsOneWidget);
    expect(find.byKey(const Key('collection-sort-button-pill')), findsOneWidget);
    // Still no editor-only affordances for a viewer
    expect(find.byKey(const Key('space-albums-link-action')), findsNothing);
    expect(find.byKey(const Key('space-album-card-menu-a1')), findsNothing);
  });

  // ---------------------------------------------------------------------
  // Reactivity
  // ---------------------------------------------------------------------

  testWidgets('a new spaceAlbumsProvider emission re-applies the active filter + sort', (tester) async {
    final controller = StreamController<List<SpaceAlbum>>();
    addTearDown(controller.close);

    controller.add([_album(id: 'it1', name: 'Italy Summer'), _album(id: 'hawaii1', name: 'Hawaii')]);

    await tester.pumpConsumerWidget(
      const SpaceAlbumsPage(spaceId: spaceId, canEdit: true),
      overrides: [spaceAlbumsProvider(spaceId).overrideWith((_) => controller.stream)],
    );

    await tester.enterText(find.byKey(const Key('space-albums-search-field')), 'ita');
    await tester.pumpAndSettle();

    expect(find.byKey(const Key('space-album-card-it1')), findsOneWidget);
    expect(find.byKey(const Key('space-album-card-hawaii1')), findsNothing);

    // A fresh stream emission adds a new matching album and a new
    // non-matching one; the active "ita" filter must still apply.
    controller.add([
      _album(id: 'it1', name: 'Italy Summer'),
      _album(id: 'hawaii1', name: 'Hawaii'),
      _album(id: 'it3', name: 'Italy Roadtrip'),
      _album(id: 'nz1', name: 'New Zealand'),
    ]);
    await tester.pumpAndSettle();

    expect(find.byKey(const Key('space-album-card-it1')), findsOneWidget);
    expect(find.byKey(const Key('space-album-card-it3')), findsOneWidget);
    expect(find.byKey(const Key('space-album-card-hawaii1')), findsNothing);
    expect(find.byKey(const Key('space-album-card-nz1')), findsNothing);
  });

  testWidgets('regression: album card is HitTestBehavior.opaque so cover taps register', (tester) async {
    // The card cover is an image whose render object does NOT participate in
    // hit-testing, so with the GestureDetector's default `deferToChild`
    // behavior a tap on the cover — where users tap an album — was a dead no-op
    // (only the small name Text was hittable), so opening an album "did
    // nothing". The fix sets `HitTestBehavior.opaque`; this fails on the
    // default (null) behavior.
    await tester.pumpConsumerWidget(
      const SpaceAlbumsPage(spaceId: spaceId, canEdit: false),
      overrides: _overrides(
        spaceId: spaceId,
        albums: [_album(id: 'a1', name: 'Hawaii')],
      ),
    );

    final gesture = tester.widget<GestureDetector>(
      find.descendant(of: find.byKey(const Key('space-album-card-a1')), matching: find.byType(GestureDetector)),
    );
    expect(gesture.onTap, isNotNull);
    expect(gesture.behavior, HitTestBehavior.opaque);
  });
}
