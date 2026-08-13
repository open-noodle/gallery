import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/domain/models/asset/base_asset.model.dart';
import 'package:immich_mobile/domain/models/space_album.model.dart';
import 'package:immich_mobile/domain/services/asset.service.dart';
import 'package:immich_mobile/presentation/widgets/images/thumbnail.widget.dart';
import 'package:immich_mobile/presentation/widgets/spaces/space_albums_shelf.widget.dart';
import 'package:immich_mobile/providers/infrastructure/asset.provider.dart';
import 'package:immich_mobile/providers/infrastructure/space_album.provider.dart';
import 'package:mocktail/mocktail.dart';

import '../../../unit/presentation/presentation_context.dart';
import '../../../widget_tester_extensions.dart';

class _MockAssetService extends Mock implements AssetService {}

RemoteAsset _remoteAsset({required String id}) => RemoteAsset(
  id: id,
  checksum: 'checksum1',
  ownerId: 'owner1',
  name: 'test.jpg',
  type: AssetType.image,
  createdAt: DateTime(2024, 1, 1),
  updatedAt: DateTime(2024, 1, 1),
  isEdited: false,
);

/// Finds widgets whose [ValueKey<String>] starts with [prefix].
Finder findByKeyPrefix(String prefix) => find.byWidgetPredicate(
  (widget) => widget.key is ValueKey<String> && (widget.key! as ValueKey<String>).value.startsWith(prefix),
);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

SpaceAlbum _album({required String id, String? name, String? thumbnailAssetId, bool showInTimeline = true}) =>
    SpaceAlbum(
      id: id,
      name: name ?? 'Album $id',
      thumbnailAssetId: thumbnailAssetId,
      showInTimeline: showInTimeline,
      linkedAt: DateTime.utc(2026, 1, 1),
      updatedAt: DateTime.utc(2026, 1, 1),
      createdAt: DateTime.utc(2026, 1, 1),
    );

/// Overrides [spaceAlbumsProvider] with a fixed list, for use with
/// [WidgetTester.pumpConsumerWidget]'s `overrides` param (which already
/// supplies the `ProviderScope` + `MaterialApp` + `EasyLocalization` shell).
///
/// Pass [assetService] to also override [assetServiceProvider] — needed for
/// cover-thumbnail tests that call [assetServiceProvider.getRemoteAsset].
List<Override> _overrides({required String spaceId, required List<SpaceAlbum> albums, AssetService? assetService}) => [
  spaceAlbumsProvider(spaceId).overrideWith((_) => Stream.value(albums)),
  if (assetService != null) assetServiceProvider.overrideWithValue(assetService),
];

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

void main() {
  setUpAll(() async {
    // PresentationContext.create() calls TestUtils.init() + initializes
    // StoreService (needed by Thumbnail.remote's RemoteImageProvider).
    await PresentationContext.create();
  });

  const spaceId = 'space-1';

  testWidgets('count>0 + canEdit: shows cover tiles and Link tile', (tester) async {
    final albums = [_album(id: 'a1', name: 'Hawaii'), _album(id: 'a2', name: 'Sunset')];

    await tester.pumpConsumerWidget(
      SpaceAlbumsShelf(spaceId: spaceId, canEdit: true, onLinkTap: () {}, onAlbumTap: (_) {}),
      overrides: _overrides(spaceId: spaceId, albums: albums),
    );

    expect(find.byKey(const Key('space-albums-shelf')), findsOneWidget);
    expect(find.byKey(const Key('space-album-tile-a1')), findsOneWidget);
    expect(find.byKey(const Key('space-album-tile-a2')), findsOneWidget);
    expect(find.byKey(const Key('space-album-link-tile')), findsOneWidget);
  });

  testWidgets('off-timeline album shows visibility_off icon', (tester) async {
    final albums = [
      _album(id: 'a1', name: 'Hawaii', showInTimeline: true),
      _album(id: 'a2', name: 'Reef', showInTimeline: false),
    ];

    await tester.pumpConsumerWidget(
      SpaceAlbumsShelf(spaceId: spaceId, canEdit: true, onLinkTap: () {}, onAlbumTap: (_) {}),
      overrides: _overrides(spaceId: spaceId, albums: albums),
    );

    // Reef tile is off-timeline → has visibility_off overlay
    expect(find.byIcon(Icons.visibility_off), findsOneWidget);
  });

  testWidgets('count==0 + canEdit=true: shows only the Link tile', (tester) async {
    await tester.pumpConsumerWidget(
      SpaceAlbumsShelf(spaceId: spaceId, canEdit: true, onLinkTap: () {}, onAlbumTap: (_) {}),
      overrides: _overrides(spaceId: spaceId, albums: const []),
    );

    expect(find.byKey(const Key('space-album-link-tile')), findsOneWidget);
    // No cover tiles
    expect(findByKeyPrefix('space-album-tile-'), findsNothing);
  });

  testWidgets('count==0 + canEdit=false: renders nothing', (tester) async {
    await tester.pumpConsumerWidget(
      SpaceAlbumsShelf(spaceId: spaceId, canEdit: false, onLinkTap: () {}, onAlbumTap: (_) {}),
      overrides: _overrides(spaceId: spaceId, albums: const []),
    );

    expect(find.byKey(const Key('space-albums-shelf')), findsNothing);
    expect(find.byKey(const Key('space-album-link-tile')), findsNothing);
    expect(findByKeyPrefix('space-album-tile-'), findsNothing);
  });

  testWidgets('album with null thumbnailAssetId uses photo_album_outlined fallback icon', (tester) async {
    final albums = [_album(id: 'a1', name: 'Unsynced', thumbnailAssetId: null)];

    await tester.pumpConsumerWidget(
      SpaceAlbumsShelf(spaceId: spaceId, canEdit: false, onLinkTap: () {}, onAlbumTap: (_) {}),
      overrides: _overrides(spaceId: spaceId, albums: albums),
    );

    // Cover has no thumbnail → fallback icon is shown
    expect(find.byIcon(Icons.photo_album_outlined), findsOneWidget);
  });

  testWidgets('tapping "See all ▸" invokes the onSeeAll callback', (tester) async {
    var called = false;
    final albums = [_album(id: 'a1', name: 'Hawaii')];

    await tester.pumpConsumerWidget(
      SpaceAlbumsShelf(
        spaceId: spaceId,
        canEdit: true,
        onLinkTap: () {},
        onAlbumTap: (_) {},
        onSeeAll: () => called = true,
      ),
      overrides: _overrides(spaceId: spaceId, albums: albums),
    );

    await tester.tap(find.text('See all ▸'));
    expect(called, isTrue);
  });

  testWidgets('regression: album cover tile is HitTestBehavior.opaque so cover taps register', (tester) async {
    // The cover art is an image (Thumbnail) whose render object does NOT
    // participate in hit-testing. With the GestureDetector's default
    // `deferToChild` behavior, a tap on the cover — where users actually tap an
    // album — found no hittable child and was a dead no-op (only the small name
    // Text below was tappable), so tapping an album "did nothing". The fix sets
    // `HitTestBehavior.opaque` so the whole tile is tappable. This asserts that
    // behavior on the tile's own GestureDetector; it fails on the default
    // (null) behavior.
    final albums = [_album(id: 'a1', name: 'Hawaii')];

    await tester.pumpConsumerWidget(
      SpaceAlbumsShelf(spaceId: spaceId, canEdit: false, onLinkTap: () {}, onAlbumTap: (_) {}),
      overrides: _overrides(spaceId: spaceId, albums: albums),
    );

    final gesture = tester.widget<GestureDetector>(
      find.descendant(of: find.byKey(const Key('space-album-tile-a1')), matching: find.byType(GestureDetector)),
    );
    expect(gesture.onTap, isNotNull);
    expect(gesture.behavior, HitTestBehavior.opaque);
  });

  testWidgets('album WITH thumbnailAssetId resolving to asset shows Thumbnail cover (not placeholder icon)', (
    tester,
  ) async {
    final mockService = _MockAssetService();
    final asset = _remoteAsset(id: 'thumb-1');
    when(() => mockService.getRemoteAsset('thumb-1')).thenAnswer((_) async => asset);

    final albums = [_album(id: 'a1', name: 'Hawaii', thumbnailAssetId: 'thumb-1')];

    await tester.pumpConsumerWidget(
      SpaceAlbumsShelf(spaceId: spaceId, canEdit: false, onLinkTap: () {}, onAlbumTap: (_) {}),
      overrides: _overrides(spaceId: spaceId, albums: albums, assetService: mockService),
    );

    expect(find.byType(Thumbnail), findsOneWidget);
    expect(find.byIcon(Icons.photo_album_outlined), findsNothing);
  });
}
