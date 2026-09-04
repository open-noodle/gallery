import 'dart:async';

import 'dart:convert';

import 'package:auto_route/auto_route.dart';
import 'package:drift/drift.dart' as drift;
import 'package:drift/native.dart';
import 'package:easy_localization/easy_localization.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/constants/locales.dart';
import 'package:immich_mobile/domain/models/album/album.model.dart';
import 'package:immich_mobile/domain/models/asset/base_asset.model.dart';
import 'package:immich_mobile/domain/models/settings_key.dart';
import 'package:immich_mobile/domain/models/space_album.model.dart';
import 'package:immich_mobile/domain/models/space_album_folder.model.dart';
import 'package:immich_mobile/domain/models/store.model.dart';
import 'package:immich_mobile/domain/services/asset.service.dart';
import 'package:immich_mobile/domain/services/store.service.dart';
import 'package:immich_mobile/domain/utils/background_sync.dart';
import 'package:immich_mobile/entities/store.entity.dart';
import 'package:immich_mobile/generated/codegen_loader.g.dart';
import 'package:immich_mobile/infrastructure/repositories/db.repository.dart';
import 'package:immich_mobile/infrastructure/repositories/settings.repository.dart';
import 'package:immich_mobile/infrastructure/repositories/store.repository.dart';
import 'package:immich_mobile/pages/library/spaces/collection_sort.dart';
import 'package:immich_mobile/pages/library/spaces/space_albums.page.dart';
import 'package:immich_mobile/presentation/widgets/images/thumbnail.widget.dart';
import 'package:immich_mobile/presentation/widgets/spaces/space_album_folder_card.widget.dart';
import 'package:immich_mobile/providers/background_sync.provider.dart';
import 'package:immich_mobile/providers/infrastructure/album.provider.dart';
import 'package:immich_mobile/providers/infrastructure/asset.provider.dart';
import 'package:immich_mobile/providers/infrastructure/remote_album.provider.dart';
import 'package:immich_mobile/providers/infrastructure/space_album.provider.dart';
import 'package:immich_mobile/providers/infrastructure/space_album_actions.dart';
import 'package:immich_mobile/repositories/drift_album_api_repository.dart';
import 'package:immich_mobile/repositories/shared_space_api.repository.dart';
import 'package:immich_mobile/routing/router.dart';
import 'package:mocktail/mocktail.dart';
import 'package:openapi/api.dart' show ApiException;

import '../../test_utils.dart';
import '../../widget_tester_extensions.dart';

// ---------------------------------------------------------------------------
// Mocks (Task 10 — "Move to folder…" wiring)
// ---------------------------------------------------------------------------

class MockSharedSpaceApiRepository extends Mock implements SharedSpaceApiRepository {}

class MockBackgroundSyncManager extends Mock implements BackgroundSyncManager {}

/// `spaceAlbumActionsProvider` eagerly builds ALL three of its dependencies (repo, album-api-repo,
/// sync manager) regardless of which `SpaceAlbumActions` method is actually called — see
/// `space_album_actions.dart`'s `Provider<SpaceAlbumActions>`. `moveAlbumToFolder` never touches
/// the album-api-repo, but without overriding it here the real `driftAlbumApiRepositoryProvider`
/// still gets built during `ref.read(spaceAlbumActionsProvider)`, which resolves the real
/// `apiServiceProvider` -> `ApiService()` -> `NetworkRepository.client` -> `_client!`, a null
/// check on a static field only ever set by the native-platform-only `NetworkRepository.init()` —
/// crashing with "Null check operator used on a null value" every time. The page's own try/catch
/// swallows that (showing an error toast, correct production behaviour), which silently turns into
/// "the mocked repo was never called" here instead of a loud crash. Overriding it with a mock sidesteps
/// the real ApiService/NetworkRepository chain entirely.
class MockDriftAlbumApiRepository extends Mock implements DriftAlbumApiRepository {}

/// Folder-CRUD tests (New folder / Rename / Move / Delete) override `spaceAlbumActionsProvider`
/// directly with a mock of the whole `SpaceAlbumActions` facade, rather than mocking its three
/// sub-dependencies individually the way the album-move tests above do. This sidesteps the
/// `driftAlbumApiRepositoryProvider` -> `apiServiceProvider` -> `NetworkRepository` trap entirely
/// (nothing downstream of `spaceAlbumActionsProvider` is ever constructed) and lets each test
/// assert the exact arguments a given action was called with.
class MockSpaceAlbumActions extends Mock implements SpaceAlbumActions {}

/// I-2 fixture — a folder card's recursive count/preview needs the whole space's asset service
/// resolved, not just this level's.
class MockAssetService extends Mock implements AssetService {}

/// "New album" (createAlbum) tests stub `remoteAlbumProvider`'s `createAlbum` call directly,
/// mirroring how the folder-CRUD tests above stub `spaceAlbumActionsProvider` with a mock of the
/// whole facade rather than its sub-dependencies: overriding `remoteAlbumServiceProvider` alone
/// would still require a logged-in `currentUserProvider` (the real notifier's `createAlbum`
/// throws "User not logged in" otherwise), which is irrelevant to what these tests assert.
class _StubRemoteAlbumNotifier extends RemoteAlbumNotifier {
  _StubRemoteAlbumNotifier(this._createAlbum);

  final Future<RemoteAlbum?> Function(String title) _createAlbum;

  @override
  RemoteAlbumState build() => const RemoteAlbumState(albums: []);

  @override
  Future<RemoteAlbum?> createAlbum({required String title, String? description, List<String> assetIds = const []}) =>
      _createAlbum(title);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const spaceId = 'space-1';

SpaceAlbum _album({
  required String id,
  String? name,
  int assetCount = 0,
  bool showInTimeline = true,
  String? folderId,
  String? thumbnailAssetId,
  DateTime? linkedAt,
  DateTime? updatedAt,
  DateTime? createdAt,
}) => SpaceAlbum(
  id: id,
  name: name ?? 'Album $id',
  assetCount: assetCount,
  showInTimeline: showInTimeline,
  folderId: folderId,
  thumbnailAssetId: thumbnailAssetId,
  linkedAt: linkedAt ?? DateTime.utc(2026, 1, 1),
  updatedAt: updatedAt ?? DateTime.utc(2026, 1, 1),
  createdAt: createdAt ?? DateTime.utc(2026, 1, 1),
);

/// I-2 fixture — a resolvable remote asset for a folder-card cover tile.
RemoteAsset _remoteAsset({required String id}) => RemoteAsset(
  id: id,
  checksum: 'checksum-$id',
  ownerId: 'owner-1',
  name: '$id.jpg',
  type: AssetType.image,
  createdAt: DateTime(2024, 1, 1),
  updatedAt: DateTime(2024, 1, 1),
  isEdited: false,
);

/// "New album" (createAlbum) fixture — the album `_StubRemoteAlbumNotifier.createAlbum` resolves
/// with, standing in for what `remoteAlbumProvider.notifier.createAlbum` would return on success.
RemoteAlbum _newAlbumFixture(String id) => RemoteAlbum(
  id: id,
  name: 'New Album',
  ownerId: 'owner-1',
  description: '',
  createdAt: DateTime(2026, 1, 1),
  updatedAt: DateTime(2026, 1, 1),
  isActivityEnabled: false,
  order: AlbumAssetOrder.desc,
  assetCount: 0,
  ownerName: 'Test User',
  isShared: false,
);

/// Task 10 (U-*) test fixture — positional (id, name), matching the plan's brief verbatim.
SpaceAlbum album(String id, String name, {String? folderId}) => _album(id: id, name: name, folderId: folderId);

/// Task 10 (U-*) test fixture — positional (id, name), matching the plan's brief verbatim.
SpaceAlbumFolder folder(String id, String name, {String? parentId}) =>
    SpaceAlbumFolder(id: id, spaceId: spaceId, parentId: parentId, name: name);

/// Overrides [spaceAlbumsProvider] with a fixed list, for use with
/// [WidgetTester.pumpConsumerWidget]'s `overrides` param.
///
/// Task 10 added a folders stream the page now watches unconditionally — every override list
/// must supply one (an empty list here) or the page throws resolving `driftProvider`.
List<Override> _overrides({required String spaceId, required List<SpaceAlbum> albums}) => [
  spaceAlbumsProvider(spaceId).overrideWith((_) => Stream.value(albums)),
  spaceAlbumFoldersProvider(spaceId).overrideWith((_) => Stream.value(const <SpaceAlbumFolder>[])),
];

/// Pumps [SpaceAlbumsPage] with fixed folder/album lists — no database, no router. Used by every
/// U-* test that only asserts on-screen content (U-01, U-04, U-05, U-09, U-10, U-13).
///
/// Uses a taller-than-default viewport (matching the move-to-folder tests further down this file)
/// because folders render as their OWN sliver section above the albums section (§4.2): a single
/// folder card already consumes most of the default 800x600 test surface, so a folder + album card
/// together need more room to both land in the tree without scrolling — the same category of
/// default-viewport limitation the pre-existing "row 2 may be below the fold" comment on the search
/// test (below) already flags for this file.
Future<void> pumpPage(
  WidgetTester tester, {
  required List<SpaceAlbumFolder> folders,
  required List<SpaceAlbum> albums,
  String? folderId,
  bool canEdit = true,
  List<Override> overrides = const [],
}) async {
  tester.view.devicePixelRatio = 3.0;
  tester.view.physicalSize = const Size(2400, 3600);
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);

  await tester.pumpConsumerWidget(
    SpaceAlbumsPage(spaceId: spaceId, canEdit: canEdit, folderId: folderId),
    overrides: [
      spaceAlbumsProvider(spaceId).overrideWith((_) => Stream.value(albums)),
      spaceAlbumFoldersProvider(spaceId).overrideWith((_) => Stream.value(folders)),
      ...overrides,
    ],
  );
}

/// Pushes [SpaceAlbumsPage] onto a real AutoRoute stack (harness home is a plain placeholder, NOT
/// a [SpaceAlbumsPage], so a pop leaves zero [SpaceAlbumsPage] instances behind — see U-11) with
/// the folders provider backed by the caller's own controllable [folderStream]. Returns the
/// router so the caller can drive further navigation (U-02, U-03) or just let U-11's `maybePop`
/// play out.
Future<RootStackRouter> pumpPageWithFolderStream(
  WidgetTester tester,
  Stream<List<SpaceAlbumFolder>> folderStream, {
  required String folderId,
  List<SpaceAlbum> albums = const [],
  bool canEdit = true,
}) async {
  final router = RootStackRouter.build(
    routes: [
      AutoRoute(initial: true, page: PageInfo('SpaceAlbumsHarness', builder: (_) => const SizedBox.shrink())),
      AutoRoute(page: SpaceAlbumsRoute.page),
    ],
  );

  await tester.pumpWidget(
    EasyLocalization(
      supportedLocales: locales.values.toList(),
      path: translationsPath,
      startLocale: locales.values.first,
      fallbackLocale: locales.values.first,
      saveLocale: false,
      useFallbackTranslations: true,
      assetLoader: const CodegenLoader(),
      child: ProviderScope(
        overrides: [
          spaceAlbumsProvider(spaceId).overrideWith((_) => Stream.value(albums)),
          spaceAlbumFoldersProvider(spaceId).overrideWith((_) => folderStream),
        ],
        child: Builder(
          builder: (context) => MaterialApp.router(
            debugShowCheckedModeBanner: false,
            routerConfig: router.config(),
            localizationsDelegates: context.localizationDelegates,
            supportedLocales: context.supportedLocales,
            locale: context.locale,
          ),
        ),
      ),
    ),
  );
  await tester.pump();
  // NOT awaited: `push`'s Future resolves only once the pushed route is later POPPED (Navigator
  // semantics — see `_addNewPage` in auto_route, which returns the pop completer), so awaiting it
  // here would deadlock forever: nothing pops this route until the CALLER (after this helper
  // returns) drives the folder stream and lets U-11's `context.maybePop()` fire. Matches the
  // sibling pattern (`timeline_scroll_to_top_test.dart`'s `unawaited(router.pushPath(...))`).
  unawaited(router.push(SpaceAlbumsRoute(spaceId: spaceId, canEdit: canEdit, folderId: folderId)));
  await tester.pumpAndSettle();
  return router;
}

/// U-11 stacked-pages regression harness — pushes [SpaceAlbumsPage] onto a real AutoRoute stack
/// ONCE PER ENTRY in [folderIds] (root -> folderIds[0] -> folderIds[1] -> ...), mirroring the
/// real drill-down flow where the route is pushed onto ITSELF for each nested folder level (see
/// the class doc on [SpaceAlbumsPage]). Every pushed page watches the SAME
/// [spaceAlbumFoldersProvider] instance (same spaceId), so a single [folderStream] emission is
/// delivered to ALL of their `ref.listen` subscriptions at once — the scenario
/// [pumpPageWithFolderStream]'s single-page stack cannot exercise: whether a reacting page pops
/// the correct (its OWN) route rather than always the topmost one, and (with 3+ entries) whether
/// a self-pop cascades through exactly the right number of routes.
///
/// [folderIds] entries need not be distinct: two adjacent entries with the SAME id reproduce a
/// double-tap on a folder card. `AppRouter` now blocks that at the push site in PRODUCTION
/// (`SpaceAlbumsDuplicateGuard`, router.dart:179 — see space_albums_duplicate_guard.dart), but
/// this harness deliberately builds its OWN router (below) with NO guard at all on
/// `SpaceAlbumsRoute`, so the identical-args self-pop case stays directly reachable and tested
/// here regardless of that production guard — this divergence from `AppRouter`'s route table is
/// intentional, not an oversight.
Future<RootStackRouter> pumpStackedFolderPagesWithFolderStream(
  WidgetTester tester,
  Stream<List<SpaceAlbumFolder>> folderStream, {
  required List<String> folderIds,
  List<SpaceAlbum> albums = const [],
  bool canEdit = true,
}) async {
  final router = RootStackRouter.build(
    routes: [
      AutoRoute(initial: true, page: PageInfo('SpaceAlbumsHarness', builder: (_) => const SizedBox.shrink())),
      AutoRoute(page: SpaceAlbumsRoute.page),
    ],
  );

  await tester.pumpWidget(
    EasyLocalization(
      supportedLocales: locales.values.toList(),
      path: translationsPath,
      startLocale: locales.values.first,
      fallbackLocale: locales.values.first,
      saveLocale: false,
      useFallbackTranslations: true,
      assetLoader: const CodegenLoader(),
      child: ProviderScope(
        overrides: [
          spaceAlbumsProvider(spaceId).overrideWith((_) => Stream.value(albums)),
          spaceAlbumFoldersProvider(spaceId).overrideWith((_) => folderStream),
        ],
        child: Builder(
          builder: (context) => MaterialApp.router(
            debugShowCheckedModeBanner: false,
            routerConfig: router.config(),
            localizationsDelegates: context.localizationDelegates,
            supportedLocales: context.supportedLocales,
            locale: context.locale,
          ),
        ),
      ),
    ),
  );
  await tester.pump();
  for (final folderId in folderIds) {
    // NOT awaited — same reasoning as `pumpPageWithFolderStream` above: `push`'s Future only
    // resolves once the pushed route is popped, and driving that pop (or self-pop) via the
    // folder stream is exactly what the caller does after this helper returns.
    unawaited(router.push(SpaceAlbumsRoute(spaceId: spaceId, canEdit: canEdit, folderId: folderId)));
    await tester.pumpAndSettle();
  }
  return router;
}

/// `ImmichToast` schedules a 3s fluttertoast Timer outside the frame scheduler, so a plain
/// `pumpAndSettle()` leaves it pending and teardown fails with "A Timer is still pending". Pump
/// past its lifetime instead of dropping the toast from the widget (mirrors
/// `space_edit_sheet_test.dart`'s identical helper).
Future<void> settleToast(WidgetTester tester) async {
  await tester.pumpAndSettle();
  await tester.pump(const Duration(seconds: 4));
  await tester.pumpAndSettle();
}

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

/// The ⋮ menu button for a SPECIFIC folder card. `SpaceAlbumFolderCard`'s own menu key
/// (`space-album-folder-card-menu`, from Task 9) is NOT parameterized by folder id — it's the same
/// literal key on every card — so `find.byKey` alone is ambiguous whenever more than one folder
/// renders at once. Scoping through the card's own per-id key (`space-album-folder-card-<id>`)
/// disambiguates.
Finder _folderMenuFinder(String folderId) => find.descendant(
  of: find.byKey(Key('space-album-folder-card-$folderId')),
  matching: find.byKey(const Key('space-album-folder-card-menu')),
);

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

  testWidgets('editor app-bar actions are icon-only with tooltips', (tester) async {
    await pumpPage(tester, folders: const [], albums: const []);

    for (final entry in const {
      'space-albums-new-folder-action': 'New folder',
      'space-albums-new-album-action': 'New album',
      'space-albums-link-action': 'Link',
    }.entries) {
      final button = tester.widget<IconButton>(find.byKey(Key(entry.key)));
      expect(button.tooltip, entry.value, reason: '${entry.key} must keep its label as a tooltip');
    }

    // Scoped to the AppBar deliberately: this page also builds TextButtons
    // inside _FolderNameDialog and the delete confirmation, so a bare
    // find.byType(TextButton) would pass only because no dialog is open.
    expect(find.descendant(of: find.byType(AppBar), matching: find.byType(TextButton)), findsNothing);
  });

  testWidgets('the link action uses the add_link icon', (tester) async {
    await pumpPage(tester, folders: const [], albums: const []);

    final button = tester.widget<IconButton>(find.byKey(const Key('space-albums-link-action')));
    expect((button.icon as Icon).icon, Icons.add_link);
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
        (w) => w.key is ValueKey<String> && (w.key as ValueKey<String>).value.startsWith('space-album-card-'),
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

  // Regression: the folder-tree refactor dropped the top-level "space genuinely has zero albums"
  // guard, so this exact transition (non-empty with an active query -> the last album vanishes)
  // fell through to the no-match state instead. The two tests above only cover MOUNTING with an
  // empty list / a non-matching query already typed -- neither exercises becoming empty WHILE a
  // query is still active, which is the transition that actually regressed.
  testWidgets('the last album disappearing mid-search shows the empty state, not the no-match state', (tester) async {
    final controller = StreamController<List<SpaceAlbum>>();
    addTearDown(controller.close);
    controller.add([_album(id: 'it1', name: 'Italy Summer')]);

    await tester.pumpConsumerWidget(
      const SpaceAlbumsPage(spaceId: spaceId, canEdit: true),
      overrides: [
        spaceAlbumsProvider(spaceId).overrideWith((_) => controller.stream),
        spaceAlbumFoldersProvider(spaceId).overrideWith((_) => Stream.value(const <SpaceAlbumFolder>[])),
      ],
    );

    await tester.enterText(find.byKey(const Key('space-albums-search-field')), 'ita');
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('space-album-card-it1')), findsOneWidget);

    // The last linked album is unlinked elsewhere (another device/user) while this query is
    // still active -- the query itself never changes.
    controller.add(const []);
    await tester.pumpAndSettle();

    expect(find.byKey(const Key('space-albums-empty')), findsOneWidget);
    expect(find.byKey(const Key('space-albums-no-match')), findsNothing);
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
    await tester.tap(find.text('Number of items'));
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
    expect(find.text('Sort: Number of items'), findsOneWidget);
  });

  testWidgets('offers all seven sort options in the menu', (tester) async {
    await tester.pumpConsumerWidget(
      const SpaceAlbumsPage(spaceId: spaceId, canEdit: true),
      overrides: _overrides(
        spaceId: spaceId,
        albums: [_album(id: 'a1', name: 'Alpha'), _album(id: 'a2', name: 'Bravo')],
      ),
    );
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('collection-sort-button-pill')));
    await tester.pumpAndSettle();

    for (final label in [
      'Title',
      'Number of items',
      'Date modified',
      'Date created',
      'Most recent photo',
      'Oldest photo',
      'Recently linked',
    ]) {
      expect(find.text(label), findsWidgets, reason: 'missing sort option $label');
    }
  });

  // I-1 — regression: flattenForSearch returns raw (name-ascending, per watchLinkedAlbums)
  // server order; the search branch used to pass that order straight to the grid, silently
  // discarding the user's chosen sort for the duration of the query. The three sort tests above
  // all run with an EMPTY query, and U-09 below only asserts presence/absence with a query
  // active, never order — so this is the one test that actually pins ORDER while searching.
  testWidgets('I-1: a search query still respects the active sort order', (tester) async {
    final albums = [
      _album(id: 'a1', name: 'Beach A', assetCount: 5),
      _album(id: 'a2', name: 'Beach B', assetCount: 50),
    ];

    await SettingsRepository.instance.write(SettingsKey.spaceAlbumsSortMode, SpaceAlbumSortMode.photoCount);
    await SettingsRepository.instance.write(SettingsKey.spaceAlbumsIsReverse, false);

    await pumpPage(tester, folders: const [], albums: albums);

    // No query: photoCount desc -> Beach B (50) sorts before Beach A (5).
    expect(_firstCardByPosition(tester, ['a1', 'a2']), 'a2');

    await tester.enterText(find.byKey(const Key('space-albums-search-field')), 'beach');
    await tester.pumpAndSettle();

    // Both still match "beach" — the active sort must still put Beach B first, not the
    // name-ascending order flattenForSearch returns on its own.
    expect(find.byKey(const Key('space-album-card-a1')), findsOneWidget);
    expect(find.byKey(const Key('space-album-card-a2')), findsOneWidget);
    expect(_firstCardByPosition(tester, ['a1', 'a2']), 'a2');
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
      overrides: [
        spaceAlbumsProvider(spaceId).overrideWith((_) => controller.stream),
        spaceAlbumFoldersProvider(spaceId).overrideWith((_) => Stream.value(const <SpaceAlbumFolder>[])),
      ],
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

  // ---------------------------------------------------------------------
  // Task 10 — folders (U-01..U-05, U-09..U-11, U-13)
  // ---------------------------------------------------------------------

  testWidgets('U-01: renders folders before albums', (tester) async {
    await pumpPage(tester, folders: [folder('trips', 'Trips')], albums: [album('a1', 'Rome')]);

    final folderY = tester.getTopLeft(find.byType(SpaceAlbumFolderCard)).dy;
    final albumY = tester.getTopLeft(find.byKey(const Key('space-album-card-a1'))).dy;
    expect(folderY, lessThan(albumY));
  });

  testWidgets('U-04: a space with no folders renders the flat list unchanged', (tester) async {
    await pumpPage(tester, folders: const [], albums: [album('a1', 'Rome')]);

    expect(find.byType(SpaceAlbumFolderCard), findsNothing);
    expect(find.text('Rome'), findsOneWidget);
  });

  testWidgets('U-05: an empty folder shows the folder-specific empty state', (tester) async {
    await pumpPage(tester, folders: [folder('trips', 'Trips')], albums: const [], folderId: 'trips');

    expect(find.byKey(const Key('space-album-folder-empty')), findsOneWidget);
    expect(find.byKey(const Key('space-albums-empty')), findsNothing);
  });

  // U-06 — the folder-card ⋮ half of this scenario is already covered at the widget level in
  // `space_album_folder_card_test.dart`. The "no New folder action" half can only be tested HERE:
  // it's an app-bar affordance the card test file has no way to see.
  testWidgets('U-06: a viewer sees no folder ⋮ menu and no New folder action', (tester) async {
    await pumpPage(tester, folders: [folder('trips', 'Trips')], albums: const [], canEdit: false);

    expect(find.byKey(const Key('space-album-folder-card-menu')), findsNothing);
    expect(find.byKey(const Key('space-albums-new-folder-action')), findsNothing);
  });

  // I-2 — regression: `_LevelGrid`'s `allFolders`/`allAlbums` must be the WHOLE space's folders
  // and albums, not just the current level's (`folders`/`sortedAlbums`), because
  // recursiveAlbumCount/folderPreviewAlbums need the full subtree. A folder holding only a
  // SUBFOLDER (no direct albums of its own) is the fixture that actually distinguishes the two:
  // at the root level, `contents.albums` is empty (the one album lives inside 'day1'), so passing
  // level-only data would show "0 albums" and the empty-folder glyph instead of the real count
  // and cover — while every OTHER existing test in this file uses a flat folder (album directly
  // inside it), which happens to read the same whether `allAlbums` is level-only or whole-space.
  testWidgets('U-12/I-2: a folder holding only a subfolder shows the whole-subtree count and cover, not level-only', (
    tester,
  ) async {
    final mockService = MockAssetService();
    when(() => mockService.getRemoteAsset('thumb-1')).thenAnswer((_) async => _remoteAsset(id: 'thumb-1'));
    await Store.put(StoreKey.serverEndpoint, 'http://localhost:3000');
    addTearDown(() => Store.clear());

    await pumpPage(
      tester,
      folders: [
        folder('trips', 'Trips'),
        folder('day1', 'Day 1', parentId: 'trips'),
      ],
      albums: [_album(id: 'a1', name: 'Rome', folderId: 'day1', thumbnailAssetId: 'thumb-1')],
      overrides: [assetServiceProvider.overrideWithValue(mockService)],
    );
    // The FutureBuilder resolves the mocked (already-completed) Future asynchronously; a
    // follow-up pump lets it rebuild with the real Thumbnail.
    await tester.pump();

    final cardFinder = find.byKey(const Key('space-album-folder-card-trips'));
    expect(cardFinder, findsOneWidget);
    // Count: the album lives one level deeper (inside 'day1'), so a level-only read of this
    // level's contents would be empty and render "0 albums".
    expect(find.descendant(of: cardFinder, matching: find.textContaining('1')), findsOneWidget);
    // Cover: a real Thumbnail renders, not the empty-folder fallback glyph.
    expect(find.descendant(of: cardFinder, matching: find.byType(Thumbnail)), findsOneWidget);
    expect(find.descendant(of: cardFinder, matching: find.byIcon(Icons.folder_outlined)), findsNothing);
  });

  testWidgets('U-09: a query hides folders and shows space-wide hits with paths', (tester) async {
    await pumpPage(
      tester,
      folders: [folder('trips', 'Trips')],
      albums: [
        album('a1', 'Venice', folderId: 'trips'),
        album('a2', 'Rome'),
      ],
    );

    await tester.enterText(find.byKey(const Key('space-albums-search-field')), 'ven');
    await tester.pumpAndSettle();

    expect(find.byType(SpaceAlbumFolderCard), findsNothing);
    expect(find.text('Venice'), findsOneWidget);
    expect(find.textContaining('Trips'), findsWidgets);
  });

  // U-13 — the page ALREADY renders a no-match state (Key('space-albums-no-match')) when a
  // query filters everything out. Switching search to tree-wide flattening must PRESERVE it;
  // replacing it with a blank grid would silently regress existing behaviour.
  testWidgets('U-13: a tree-wide search matching nothing shows the no-match state', (tester) async {
    await pumpPage(tester, folders: [folder('trips', 'Trips')], albums: [album('a1', 'Rome')]);

    await tester.enterText(find.byKey(const Key('space-albums-search-field')), 'zzzz');
    await tester.pumpAndSettle();

    expect(find.byKey(const Key('space-albums-no-match')), findsOneWidget);
    expect(find.byType(SpaceAlbumFolderCard), findsNothing);
  });

  testWidgets('U-10: clearing the query returns to the current level', (tester) async {
    await pumpPage(tester, folders: [folder('trips', 'Trips')], albums: [album('a1', 'Rome')]);

    await tester.enterText(find.byKey(const Key('space-albums-search-field')), 'zzz');
    await tester.pumpAndSettle();
    await tester.enterText(find.byKey(const Key('space-albums-search-field')), '');
    await tester.pumpAndSettle();

    expect(find.byType(SpaceAlbumFolderCard), findsOneWidget);
    expect(find.text('Rome'), findsOneWidget);
  });

  // U-11 — the local-first difference from web: the screen can be invalidated underneath the
  // user by an incoming sync at any moment, not only on navigation. If the folder we are inside
  // disappears from the stream, we must pop rather than sit on a folder that no longer exists.
  testWidgets('U-11: pops when the folder you are inside disappears from the stream', (tester) async {
    final controller = StreamController<List<SpaceAlbumFolder>>();
    addTearDown(controller.close);
    await pumpPageWithFolderStream(tester, controller.stream, folderId: 'trips');
    controller.add([folder('trips', 'Trips')]);
    await tester.pumpAndSettle();

    controller.add(const []);
    await tester.pumpAndSettle();

    expect(find.byType(SpaceAlbumsPage), findsNothing);
  });

  // U-11 stacked (deferred self-pop) — the wrong-victim-pop regression: folder drill-down
  // pushes SpaceAlbumsRoute onto ITSELF, so a stack of root -> A(folder-a) -> B(folder-b) is a
  // real, common shape. Every stacked page below the top keeps a LIVE `ref.listen` (Navigator's
  // default `maintainState`), so when folder-a vanishes, page A's listener condition matches.
  //
  // Investigation (see .superpowers/sdd/space-album-folders-review-fixes/task-2-report.md)
  // showed a buried page cannot safely splice its OWN route out of the stack in place:
  // `AutoRoutePage.canUpdate` keys on the route NAME (not a per-push unique id), and since
  // SpaceAlbumsRoute is deliberately self-recursive, Flutter's declarative page-diff can't
  // tell A and B apart — surgical removal of a buried instance crashes ("setState during
  // build") and silently swaps mounted state between routes. The binding controller decision
  // (task-2-brief.md addendum) is DEFERRED SELF-POP instead: a buried page records a pending
  // flag and leaves the stack untouched until it next becomes the visible top on its own (the
  // routes above it popping), at which point it pops itself immediately — before the user can
  // ever interact with the dead page.
  testWidgets('U-11 stacked: a buried page whose folder vanishes stays put until topmost, then self-pops', (
    tester,
  ) async {
    final controller = StreamController<List<SpaceAlbumFolder>>();
    addTearDown(controller.close);
    final router = await pumpStackedFolderPagesWithFolderStream(
      tester,
      controller.stream,
      folderIds: ['folder-a', 'folder-b'],
    );

    // First real emission: guarded by the "no prior data" check — must not react to the
    // transition out of "no data yet" (sync simply may not have delivered the folders yet).
    controller.add([folder('folder-a', 'Folder A'), folder('folder-b', 'Folder B', parentId: 'folder-a')]);
    await tester.pumpAndSettle();
    expect(router.stackData.length, 3); // harness + A + B

    // folder-a (the BURIED page's folder) vanishes — e.g. another editor deleted it. A must
    // NOT touch the stack yet: B — topmost, still valid — stays exactly where it is.
    controller.add([folder('folder-b', 'Folder B')]);
    await tester.pumpAndSettle();

    // `router.stackData` (not `find.byType`) is the authoritative signal here: even at
    // baseline, with nothing wrong, a covered/offstage page's widget subtree isn't
    // independently discoverable via `find.byType` in this harness, while its RouteData
    // persists in `stackData` regardless — so `stackData` is what actually proves "A's route
    // is still in the stack, nothing was popped."
    expect(router.stackData.length, 3); // nothing popped yet — A is still buried in the stack
    final topArgs = router.stackData.last.args as SpaceAlbumsRouteArgs;
    expect(topArgs.folderId, 'folder-b');
    expect(
      router.stackData.any(
        (d) => d.args is SpaceAlbumsRouteArgs && (d.args as SpaceAlbumsRouteArgs).folderId == 'folder-a',
      ),
      isTrue,
      reason: "A's route must still be in the stack, buried but untouched",
    );
    expect(find.byType(SpaceAlbumsPage), findsOneWidget); // B, the only currently-rendered page

    // The user navigates back out of B — unrelated to A's dead folder. The moment A becomes
    // the visible top, it must self-pop through to root immediately: A must never settle as
    // the visible page.
    await router.maybePop();
    await tester.pumpAndSettle();

    expect(router.stackData.length, 1); // harness root only
    expect(find.byType(SpaceAlbumsPage), findsNothing);
  });

  testWidgets('U-11 stacked: the topmost page whose folder vanishes pops normally, revealing the page below', (
    tester,
  ) async {
    final controller = StreamController<List<SpaceAlbumFolder>>();
    addTearDown(controller.close);
    final router = await pumpStackedFolderPagesWithFolderStream(
      tester,
      controller.stream,
      folderIds: ['folder-a', 'folder-b'],
    );

    controller.add([folder('folder-a', 'Folder A'), folder('folder-b', 'Folder B', parentId: 'folder-a')]);
    await tester.pumpAndSettle();
    expect(router.stackData.length, 3);

    // folder-b (the TOPMOST page's folder) vanishes; folder-a survives.
    controller.add([folder('folder-a', 'Folder A')]);
    await tester.pumpAndSettle();

    expect(router.stackData.length, 2); // harness + A
    final topArgs = router.stackData.last.args as SpaceAlbumsRouteArgs;
    expect(topArgs.folderId, 'folder-a');
    expect(find.byType(SpaceAlbumsPage), findsOneWidget);
  });

  // `isTopmost()` reads `context.router.stackData`, which tracks only AutoRoutePages. A dialog,
  // bottom sheet or popup menu is an IMPERATIVE route pushed onto the same NavigatorState, so it
  // does not appear there — `isTopmost()` stayed true with one open, and `context.maybePop()`
  // therefore closed the DIALOG instead of the dead folder page. The page then survived as a
  // folder view whose folder no longer exists: empty state, title fallen back to the space name,
  // every action 400ing. The listener's immediate branch also popped without arming
  // `pendingSelfPop`, so nothing retried and the user was stranded until they backed out by hand.
  testWidgets('U-11: a folder vanishing while a dialog is open closes the page, not the dialog', (tester) async {
    final controller = StreamController<List<SpaceAlbumFolder>>();
    addTearDown(controller.close);
    final router = await pumpStackedFolderPagesWithFolderStream(tester, controller.stream, folderIds: ['folder-a']);

    controller.add([folder('folder-a', 'Folder A')]);
    await tester.pumpAndSettle();
    expect(router.stackData.length, 2);

    // Stand in for the rename/delete dialogs this page opens from the folder-card kebab: what
    // matters is that it is an imperative route above the page, not which one it is.
    final pageContext = tester.element(find.byType(SpaceAlbumsPage));
    unawaited(
      showDialog<void>(context: pageContext, builder: (_) => const AlertDialog(content: Text('dialog-under-test'))),
    );
    await tester.pumpAndSettle();
    expect(find.text('dialog-under-test'), findsOneWidget);

    // The folder is deleted by another editor while the dialog is open.
    controller.add([]);
    await tester.pumpAndSettle();

    // The dialog must be untouched — it is not what went stale.
    expect(find.text('dialog-under-test'), findsOneWidget);
    expect(router.stackData.length, 2);

    // Once the dialog closes, the pending pop must still fire. Before the fix the pop had already
    // been spent on the dialog and nothing rearmed it, so the page stayed forever.
    Navigator.of(tester.element(find.text('dialog-under-test'))).pop();
    await tester.pumpAndSettle();

    expect(find.text('dialog-under-test'), findsNothing);
    expect(router.stackData.length, 1);
    expect(find.byType(SpaceAlbumsPage), findsNothing);
  });

  // Task-2 review, Finding 1 — `navigationHistory`'s notifyListeners is URL-STRING based
  // (`onNewUrlState` only fires when the computed `UrlState` differs, and `UrlState.==` compares
  // route segments). Two stacked `SpaceAlbumsRoute`s sharing the SAME folderId produce IDENTICAL
  // segments before and after the covering instance pops, so that channel alone would silently
  // never notify. The fix adds a URL-string-independent poll as a safety net; this test is what
  // actually exercises it (the two tests above never hit this gap, since their stacked pages
  // always have DIFFERENT folderIds and so DO change the UrlState on every pop).
  //
  // UPDATE (Task 6) — identical-args stacking is now blocked in PRODUCTION by
  // `SpaceAlbumsDuplicateGuard` (router.dart:179 — see space_albums_duplicate_guard.dart): a
  // second tap arrives after the first tap's push has already landed (`StackRouter._push` awaits
  // `_canNavigate` before calling `_addNewPage`, auto_route 11.1.0's routing_controller.dart:1363,
  // so both land within the same event-loop turn), so `router.current.args.folderId ==
  // pendingArgs.folderId` and the guard blocks the second push before this page ever stacks twice
  // with the same folderId. This harness (`pumpStackedFolderPagesWithFolderStream`, above)
  // deliberately builds its OWN router with NO guard at all on `SpaceAlbumsRoute`, so the
  // identical-args self-pop case stays directly reachable here regardless of that production
  // guard — this test is what keeps `pollNextFrame` honest.
  testWidgets('U-11 stacked: identical-folderId siblings (double-tap) still self-pop despite an unchanged UrlState', (
    tester,
  ) async {
    final controller = StreamController<List<SpaceAlbumFolder>>();
    addTearDown(controller.close);
    final router = await pumpStackedFolderPagesWithFolderStream(
      tester,
      controller.stream,
      folderIds: ['folder-x', 'folder-x'], // double-tap: A and A' both browse the SAME folder
    );

    controller.add([folder('folder-x', 'Folder X')]);
    await tester.pumpAndSettle();
    expect(router.stackData.length, 3); // harness + A + A'

    // folder-x vanishes entirely: A' (topmost) pops immediately; A (buried) flags itself
    // pending — and, on the UrlState channel alone, would never hear that A' actually popped.
    controller.add(const []);
    await tester.pumpAndSettle();

    // A must still self-pop through to root — never settle as the visible dead page just
    // because its own UrlState happens to read identically to A's before A' popped.
    expect(router.stackData.length, 1); // harness root only
    expect(find.byType(SpaceAlbumsPage), findsNothing);
  });

  // Task-2 review, Finding 2 — `StackRouter.maybePop` is async and the pending-pop
  // listener/poll aren't torn down until the NEXT rebuild processes `pendingSelfPop` flipping to
  // false, so a second notification/frame landing before that rebuild lands must be a no-op, not
  // a second `maybePop()` that would take the route BELOW this page with it too. A root->A->B
  // stack can't expose a double-pop even if one happened: its settled bottom is the root harness,
  // where a stray extra pop is a no-op either way. This pins the OBSERVABLE outcome the guard
  // exists to protect — self-pop lands on exactly one route (X survives) — on a stack where a
  // double-pop would have a visible victim; needs a route BELOW the self-popping page for that.
  testWidgets('U-11 stacked: a self-pop never doubles up and takes the route below it too', (tester) async {
    final controller = StreamController<List<SpaceAlbumFolder>>();
    addTearDown(controller.close);
    final router = await pumpStackedFolderPagesWithFolderStream(
      tester,
      controller.stream,
      folderIds: ['folder-x', 'folder-a', 'folder-b'], // root -> X -> A -> B
    );

    controller.add([
      folder('folder-x', 'Folder X'),
      folder('folder-a', 'Folder A', parentId: 'folder-x'),
      folder('folder-b', 'Folder B', parentId: 'folder-a'),
    ]);
    await tester.pumpAndSettle();
    expect(router.stackData.length, 4); // harness + X + A + B

    // folder-a (A's own folder, buried under B) vanishes; X and B are unaffected.
    controller.add([folder('folder-x', 'Folder X'), folder('folder-b', 'Folder B')]);
    await tester.pumpAndSettle();
    expect(router.stackData.length, 4); // nothing popped yet — A is still buried, now pending

    // The user backs out of B. A must self-pop EXACTLY once, landing on X — not also take X
    // with it via a redundant second `maybePop()` racing in the same notification window.
    await router.maybePop();
    await tester.pumpAndSettle();

    expect(router.stackData.length, 2); // harness + X — A self-popped exactly once
    final topArgs = router.stackData.last.args as SpaceAlbumsRouteArgs;
    expect(topArgs.folderId, 'folder-x');
    expect(find.byType(SpaceAlbumsPage), findsOneWidget);
  });

  // Task-2 review, Finding 3 — a transient false-vanish emission (the folder is momentarily
  // missing from one sync batch, then present again in a later one) must not leave a stale
  // pending self-pop armed: this page must stay put once it surfaces, not pop itself later for a
  // folder that's valid again by the time anyone's looking.
  testWidgets('U-11 stacked: a folder reappearing after a transient vanish clears the pending self-pop', (
    tester,
  ) async {
    final controller = StreamController<List<SpaceAlbumFolder>>();
    addTearDown(controller.close);
    final router = await pumpStackedFolderPagesWithFolderStream(
      tester,
      controller.stream,
      folderIds: ['folder-a', 'folder-b'],
    );

    controller.add([folder('folder-a', 'Folder A'), folder('folder-b', 'Folder B', parentId: 'folder-a')]);
    await tester.pumpAndSettle();
    expect(router.stackData.length, 3);

    // folder-a transiently vanishes while A is buried...
    controller.add([folder('folder-b', 'Folder B')]);
    await tester.pumpAndSettle();
    expect(router.stackData.length, 3); // still buried, now pending

    // ...then reappears in a later sync batch, before A ever surfaces.
    controller.add([folder('folder-a', 'Folder A'), folder('folder-b', 'Folder B', parentId: 'folder-a')]);
    await tester.pumpAndSettle();
    expect(router.stackData.length, 3); // unchanged

    // The user backs out of B. A must now stay put — its folder is valid again, so the earlier
    // pending flag must have been cleared rather than firing a stale self-pop.
    await router.maybePop();
    await tester.pumpAndSettle();

    expect(router.stackData.length, 2); // harness + A — A stays visible
    final topArgs = router.stackData.last.args as SpaceAlbumsRouteArgs;
    expect(topArgs.folderId, 'folder-a');
    expect(find.byType(SpaceAlbumsPage), findsOneWidget);
  });

  // T-08 (tree module) already guarantees this at the unit level; this re-verifies at the PAGE
  // level that no redundant "folder exists" filter was layered on top of `folderContents` here —
  // exactly the trap called out for this task (see teeth check #2 in the task report).
  testWidgets('an album whose folder has not synced yet still appears at the root', (tester) async {
    await pumpPage(
      tester,
      folders: const [], // 'ghost-folder' has not synced — no row for it at all
      albums: [album('a1', 'Orphaned', folderId: 'ghost-folder')],
    );

    expect(find.byKey(const Key('space-album-card-a1')), findsOneWidget);
    expect(find.text('Orphaned'), findsOneWidget);
  });

  // ---------------------------------------------------------------------
  // Task 10 — navigation (U-02, U-03), observed via the route stack per the
  // repo's existing auto_route navigation-assertion pattern (see
  // test/presentation/widgets/filter_sheet/strips/strips_test.dart and
  // test/presentation/widgets/timeline/timeline_scroll_to_top_test.dart).
  // ---------------------------------------------------------------------

  /// Pushes [SpaceAlbumsPage] (root level) onto a real AutoRoute stack, harness home a plain
  /// placeholder (not a [SpaceAlbumsPage]) so the stack composition is unambiguous.
  Future<RootStackRouter> pumpRoutedPage(
    WidgetTester tester, {
    required List<SpaceAlbumFolder> folders,
    required List<SpaceAlbum> albums,
    bool canEdit = true,
  }) async {
    final router = RootStackRouter.build(
      routes: [
        AutoRoute(initial: true, page: PageInfo('SpaceAlbumsHarness', builder: (_) => const SizedBox.shrink())),
        AutoRoute(page: SpaceAlbumsRoute.page),
      ],
    );

    await tester.pumpWidget(
      EasyLocalization(
        supportedLocales: locales.values.toList(),
        path: translationsPath,
        startLocale: locales.values.first,
        fallbackLocale: locales.values.first,
        saveLocale: false,
        useFallbackTranslations: true,
        assetLoader: const CodegenLoader(),
        child: ProviderScope(
          overrides: [
            spaceAlbumsProvider(spaceId).overrideWith((_) => Stream.value(albums)),
            spaceAlbumFoldersProvider(spaceId).overrideWith((_) => Stream.value(folders)),
          ],
          child: Builder(
            builder: (context) => MaterialApp.router(
              debugShowCheckedModeBanner: false,
              routerConfig: router.config(),
              localizationsDelegates: context.localizationDelegates,
              supportedLocales: context.supportedLocales,
              locale: context.locale,
            ),
          ),
        ),
      ),
    );
    await tester.pump();
    // NOT awaited — see the identical comment on `pumpPageWithFolderStream` above: `push`'s Future
    // only resolves once this route is popped, and neither U-02 nor U-03 ever pops THIS (root)
    // route (U-03 pops the child folder route pushed by tapping the card), so awaiting it here
    // would deadlock.
    unawaited(router.push(SpaceAlbumsRoute(spaceId: spaceId, canEdit: canEdit)));
    await tester.pumpAndSettle();
    return router;
  }

  testWidgets('U-02: tapping a folder card pushes the route one level deeper', (tester) async {
    final router = await pumpRoutedPage(tester, folders: [folder('trips', 'Trips')], albums: [album('a1', 'Rome')]);
    expect(router.stackData.length, 2); // harness home + the root SpaceAlbumsPage

    await tester.tap(find.byType(SpaceAlbumFolderCard));
    await tester.pumpAndSettle();

    expect(router.stackData.length, 3);
    final topArgs = router.stackData.last.args as SpaceAlbumsRouteArgs;
    expect(topArgs.folderId, 'trips');
  });

  testWidgets('U-03: system back from a folder returns to the parent level', (tester) async {
    final router = await pumpRoutedPage(tester, folders: [folder('trips', 'Trips')], albums: [album('a1', 'Rome')]);

    await tester.tap(find.byType(SpaceAlbumFolderCard));
    await tester.pumpAndSettle();
    expect((router.stackData.last.args as SpaceAlbumsRouteArgs).folderId, 'trips');

    await router.maybePop();
    await tester.pumpAndSettle();

    expect(router.stackData.length, 2);
    expect((router.stackData.last.args as SpaceAlbumsRouteArgs).folderId, isNull);
  });

  // ---------------------------------------------------------------------
  // Task 10 — "Move to folder…" wiring on the album card. The picker's
  // `picked` flag is the only thing that distinguishes a dismissal from
  // "picked the root" (both resolve folderId: null) — see teeth check #1
  // in the task report.
  // ---------------------------------------------------------------------

  testWidgets('dismissing the move-to-folder picker does not move the album', (tester) async {
    tester.view.devicePixelRatio = 3.0;
    tester.view.physicalSize = const Size(2400, 3600);
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);

    final repo = MockSharedSpaceApiRepository();
    final syncMgr = MockBackgroundSyncManager();
    when(() => syncMgr.syncRemote()).thenAnswer((_) async => true);

    await tester.pumpConsumerWidget(
      const SpaceAlbumsPage(spaceId: spaceId, canEdit: true),
      overrides: [
        spaceAlbumsProvider(spaceId).overrideWith((_) => Stream.value([album('a1', 'Rome')])),
        spaceAlbumFoldersProvider(spaceId).overrideWith((_) => Stream.value([folder('trips', 'Trips')])),
        sharedSpaceApiRepositoryProvider.overrideWithValue(repo),
        backgroundSyncProvider.overrideWithValue(syncMgr),
        driftAlbumApiRepositoryProvider.overrideWithValue(MockDriftAlbumApiRepository()),
      ],
    );

    await tester.tap(find.byKey(const Key('space-album-card-menu-a1')));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Move to folder…'));
    await tester.pumpAndSettle();

    // Tap the modal barrier (outside the sheet) to dismiss without picking.
    await tester.tapAt(const Offset(10, 10));
    await tester.pumpAndSettle();

    verifyNever(() => repo.setAlbumFolder(any(), any(), any()));
  });

  testWidgets('picking a folder from the move sheet moves the album', (tester) async {
    tester.view.devicePixelRatio = 3.0;
    tester.view.physicalSize = const Size(2400, 3600);
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);

    final repo = MockSharedSpaceApiRepository();
    final syncMgr = MockBackgroundSyncManager();
    when(() => repo.setAlbumFolder(any(), any(), any())).thenAnswer((_) async {});
    when(() => syncMgr.syncRemote()).thenAnswer((_) async => true);

    await tester.pumpConsumerWidget(
      const SpaceAlbumsPage(spaceId: spaceId, canEdit: true),
      overrides: [
        spaceAlbumsProvider(spaceId).overrideWith((_) => Stream.value([album('a1', 'Rome')])),
        spaceAlbumFoldersProvider(spaceId).overrideWith((_) => Stream.value([folder('trips', 'Trips')])),
        sharedSpaceApiRepositoryProvider.overrideWithValue(repo),
        backgroundSyncProvider.overrideWithValue(syncMgr),
        driftAlbumApiRepositoryProvider.overrideWithValue(MockDriftAlbumApiRepository()),
      ],
    );

    await tester.tap(find.byKey(const Key('space-album-card-menu-a1')));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Move to folder…'));
    await tester.pumpAndSettle();

    await tester.tap(find.byKey(const Key('folder-option-trips')));
    await tester.pumpAndSettle();

    verify(() => repo.setAlbumFolder(spaceId, 'a1', 'trips')).called(1);
    verify(() => syncMgr.syncRemote()).called(1);
  });

  // ---------------------------------------------------------------------
  // Task 10 round 2 — folder CRUD: app-bar "New folder" and the folder
  // card's ⋮ Rename / Move to folder… / Delete. Task 9's card already
  // declares onRename/onMove/onDelete; this is where the page actually
  // wires them (they were previously left null — a fully-enabled, fully
  // dead ⋮ menu). Every `spaceAlbumActionsProvider` override here is a
  // mock of the whole facade (see `MockSpaceAlbumActions` above), so each
  // test pins the EXACT arguments the action was called with.
  // ---------------------------------------------------------------------

  testWidgets('New folder at the root creates it with parentId null', (tester) async {
    final actions = MockSpaceAlbumActions();
    when(() => actions.createFolder(any(), any(), parentId: any(named: 'parentId'))).thenAnswer((_) async {});

    await pumpPage(
      tester,
      folders: const [],
      albums: const [],
      overrides: [spaceAlbumActionsProvider.overrideWithValue(actions)],
    );

    await tester.tap(find.byKey(const Key('space-albums-new-folder-action')));
    await tester.pumpAndSettle();
    await tester.enterText(find.byKey(const Key('space-album-folder-name-field')), 'Trips');
    await tester.tap(find.byKey(const Key('space-album-folder-name-confirm')));
    await tester.pumpAndSettle();

    verify(() => actions.createFolder(spaceId, 'Trips', parentId: null)).called(1);
  });

  testWidgets('New folder while browsing inside a folder creates it as a child, not at the root', (tester) async {
    final actions = MockSpaceAlbumActions();
    when(() => actions.createFolder(any(), any(), parentId: any(named: 'parentId'))).thenAnswer((_) async {});

    await pumpPage(
      tester,
      folders: [folder('trips', 'Trips')],
      albums: const [],
      folderId: 'trips',
      overrides: [spaceAlbumActionsProvider.overrideWithValue(actions)],
    );

    await tester.tap(find.byKey(const Key('space-albums-new-folder-action')));
    await tester.pumpAndSettle();
    await tester.enterText(find.byKey(const Key('space-album-folder-name-field')), 'Rome');
    await tester.tap(find.byKey(const Key('space-album-folder-name-confirm')));
    await tester.pumpAndSettle();

    verify(() => actions.createFolder(spaceId, 'Rome', parentId: 'trips')).called(1);
  });

  testWidgets('renaming a folder pre-fills the current name and calls renameFolder', (tester) async {
    final actions = MockSpaceAlbumActions();
    when(() => actions.renameFolder(any(), any(), any())).thenAnswer((_) async {});

    await pumpPage(
      tester,
      folders: [folder('trips', 'Trips')],
      albums: [album('a1', 'Rome')],
      overrides: [spaceAlbumActionsProvider.overrideWithValue(actions)],
    );

    await tester.tap(_folderMenuFinder('trips'));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('space-album-folder-card-rename')));
    await tester.pumpAndSettle();

    final field = tester.widget<TextFormField>(find.byKey(const Key('space-album-folder-name-field')));
    expect(field.controller!.text, 'Trips');

    await tester.enterText(find.byKey(const Key('space-album-folder-name-field')), 'Vacations');
    await tester.tap(find.byKey(const Key('space-album-folder-name-confirm')));
    await tester.pumpAndSettle();

    verify(() => actions.renameFolder(spaceId, 'trips', 'Vacations')).called(1);
  });

  testWidgets('moving a folder excludes its own subtree from the picker and calls moveFolder', (tester) async {
    final actions = MockSpaceAlbumActions();
    when(() => actions.moveFolder(any(), any(), any())).thenAnswer((_) async {});

    await pumpPage(
      tester,
      folders: [
        folder('trips', 'Trips'),
        folder('nested', 'Nested', parentId: 'trips'),
        folder('other', 'Other'),
      ],
      albums: const [],
      overrides: [spaceAlbumActionsProvider.overrideWithValue(actions)],
    );

    await tester.tap(_folderMenuFinder('trips'));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('space-album-folder-card-move')));
    await tester.pumpAndSettle();

    // The picker renders every folder (disabled rows aren't hidden, just unselectable) — the
    // moved folder itself and its descendant must be disabled; an unrelated sibling must not.
    expect(tester.widget<ListTile>(find.byKey(const Key('folder-option-trips'))).enabled, isFalse);
    expect(tester.widget<ListTile>(find.byKey(const Key('folder-option-nested'))).enabled, isFalse);
    expect(tester.widget<ListTile>(find.byKey(const Key('folder-option-other'))).enabled, isTrue);

    await tester.tap(find.byKey(const Key('folder-option-other')));
    await tester.pumpAndSettle();

    verify(() => actions.moveFolder(spaceId, 'trips', 'other')).called(1);
  });

  testWidgets('dismissing the folder move picker does not move the folder', (tester) async {
    final actions = MockSpaceAlbumActions();

    await pumpPage(
      tester,
      folders: [folder('trips', 'Trips'), folder('other', 'Other')],
      albums: const [],
      overrides: [spaceAlbumActionsProvider.overrideWithValue(actions)],
    );

    await tester.tap(_folderMenuFinder('trips'));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('space-album-folder-card-move')));
    await tester.pumpAndSettle();

    // Tap the modal barrier (outside the sheet) to dismiss without picking.
    await tester.tapAt(const Offset(10, 10));
    await tester.pumpAndSettle();

    verifyNever(() => actions.moveFolder(any(), any(), any()));
  });

  testWidgets('confirming folder deletion calls deleteFolder', (tester) async {
    final actions = MockSpaceAlbumActions();
    when(() => actions.deleteFolder(any(), any())).thenAnswer((_) async {});

    await pumpPage(
      tester,
      folders: [folder('trips', 'Trips')],
      albums: const [],
      overrides: [spaceAlbumActionsProvider.overrideWithValue(actions)],
    );

    await tester.tap(_folderMenuFinder('trips'));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('space-album-folder-card-delete')));
    await tester.pumpAndSettle();

    await tester.tap(find.byKey(const Key('space-album-folder-delete-confirm')));
    await tester.pumpAndSettle();

    verify(() => actions.deleteFolder(spaceId, 'trips')).called(1);
  });

  testWidgets('cancelling the folder deletion confirmation does not call deleteFolder', (tester) async {
    final actions = MockSpaceAlbumActions();

    await pumpPage(
      tester,
      folders: [folder('trips', 'Trips')],
      albums: const [],
      overrides: [spaceAlbumActionsProvider.overrideWithValue(actions)],
    );

    await tester.tap(_folderMenuFinder('trips'));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('space-album-folder-card-delete')));
    await tester.pumpAndSettle();

    await tester.tap(find.byKey(const Key('space-album-folder-delete-cancel')));
    await tester.pumpAndSettle();

    verifyNever(() => actions.deleteFolder(any(), any()));
  });

  // ---------------------------------------------------------------------
  // M-5 — folder-mutation failures map to the specific space_album_folder_name_taken /
  // depth_exceeded / limit_reached keys when the server's error identifies one of those known
  // failure classes, instead of always showing the action's generic error toast.
  // ---------------------------------------------------------------------

  String apiErrorBody(String message) => jsonEncode({'statusCode': 400, 'message': message, 'error': 'Bad Request'});

  testWidgets('M-5: a duplicate-name failure on New folder shows the specific error, not the generic one', (
    tester,
  ) async {
    final actions = MockSpaceAlbumActions();
    when(
      () => actions.createFolder(any(), any(), parentId: any(named: 'parentId')),
    ).thenThrow(ApiException(400, apiErrorBody('A folder with that name already exists here')));

    await pumpPage(
      tester,
      folders: const [],
      albums: const [],
      overrides: [spaceAlbumActionsProvider.overrideWithValue(actions)],
    );

    await tester.tap(find.byKey(const Key('space-albums-new-folder-action')));
    await tester.pumpAndSettle();
    await tester.enterText(find.byKey(const Key('space-album-folder-name-field')), 'Trips');
    await tester.tap(find.byKey(const Key('space-album-folder-name-confirm')));
    await tester.pumpAndSettle();

    expect(find.text('A folder with that name already exists here'), findsOneWidget);
    expect(find.text('Unable to create folder'), findsNothing);

    await settleToast(tester);
  });

  testWidgets('M-5: a depth-exceeded failure on Move folder shows the specific error, not the generic one', (
    tester,
  ) async {
    final actions = MockSpaceAlbumActions();
    when(
      () => actions.moveFolder(any(), any(), any()),
    ).thenThrow(ApiException(400, apiErrorBody('Folder nesting is limited to 10 levels (this would be 11)')));

    await pumpPage(
      tester,
      folders: [folder('trips', 'Trips'), folder('other', 'Other')],
      albums: const [],
      overrides: [spaceAlbumActionsProvider.overrideWithValue(actions)],
    );

    await tester.tap(_folderMenuFinder('trips'));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('space-album-folder-card-move')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('folder-option-other')));
    await tester.pumpAndSettle();

    expect(find.text('Folders can only be nested 10 levels deep'), findsOneWidget);

    await settleToast(tester);
  });

  testWidgets('M-5: an unrecognized failure still falls back to the generic per-action error', (tester) async {
    final actions = MockSpaceAlbumActions();
    when(
      () => actions.renameFolder(any(), any(), any()),
    ).thenThrow(ApiException(500, apiErrorBody('Internal server error')));

    await pumpPage(
      tester,
      folders: [folder('trips', 'Trips')],
      albums: const [],
      overrides: [spaceAlbumActionsProvider.overrideWithValue(actions)],
    );

    await tester.tap(_folderMenuFinder('trips'));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('space-album-folder-card-rename')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('space-album-folder-name-confirm')));
    await tester.pumpAndSettle();

    expect(find.text('Unable to rename folder'), findsOneWidget);

    await settleToast(tester);
  });

  // ---------------------------------------------------------------------
  // "New album" (createAlbum) — creates the album, then links it into the
  // CURRENT folder (mirrors web's handleCreateAlbum). Creation and the
  // subsequent link are two DIFFERENT failure domains: a link failure after
  // a successful creation must never claim creation itself failed — the
  // album already exists (unlinked, invisible in the space), and a
  // "creation failed" toast would tempt a retry that creates a duplicate.
  // ---------------------------------------------------------------------

  testWidgets('New album: creation failing shows the create-error toast', (tester) async {
    final actions = MockSpaceAlbumActions();

    await pumpPage(
      tester,
      folders: const [],
      albums: const [],
      overrides: [
        spaceAlbumActionsProvider.overrideWithValue(actions),
        remoteAlbumProvider.overrideWith(() => _StubRemoteAlbumNotifier((_) async => throw Exception('boom'))),
      ],
    );

    await tester.tap(find.byKey(const Key('space-albums-new-album-action')));
    await tester.pumpAndSettle();
    await tester.enterText(find.byKey(const Key('space-album-folder-name-field')), 'Trips');
    await tester.tap(find.byKey(const Key('space-album-folder-name-confirm')));
    await tester.pumpAndSettle();

    expect(find.text('Unable to create album'), findsOneWidget);
    verifyNever(() => actions.link(any(), any(), folderId: any(named: 'folderId')));

    await settleToast(tester);
  });

  testWidgets(
    'New album: creation succeeds but the space-link fails shows a link-specific toast, not the create-error one',
    (tester) async {
      final actions = MockSpaceAlbumActions();
      when(() => actions.link(any(), any(), folderId: any(named: 'folderId'))).thenThrow(Exception('link failed'));

      var createCallCount = 0;
      await pumpPage(
        tester,
        folders: const [],
        albums: const [],
        overrides: [
          spaceAlbumActionsProvider.overrideWithValue(actions),
          remoteAlbumProvider.overrideWith(
            () => _StubRemoteAlbumNotifier((_) async {
              createCallCount++;
              return _newAlbumFixture('new-album-1');
            }),
          ),
        ],
      );

      await tester.tap(find.byKey(const Key('space-albums-new-album-action')));
      await tester.pumpAndSettle();
      await tester.enterText(find.byKey(const Key('space-album-folder-name-field')), 'Trips');
      await tester.tap(find.byKey(const Key('space-album-folder-name-confirm')));
      await tester.pumpAndSettle();

      expect(find.text('Album created, but could not be linked to this space'), findsOneWidget);
      expect(find.text('Unable to create album'), findsNothing);
      verify(() => actions.link(spaceId, ['new-album-1'], folderId: null)).called(1);
      // A link failure must never trigger a create retry, which would silently leave a
      // duplicate album behind — exactly one create call for one dialog confirmation.
      expect(createCallCount, 1);

      await settleToast(tester);
    },
  );
}
