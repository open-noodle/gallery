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

import '../../../unit/presentation_context.dart';

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
  (widget) => widget.key is ValueKey<String> && (widget.key as ValueKey<String>).value.startsWith(prefix),
);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

SpaceAlbum _album({
  required String id,
  String? name,
  String? thumbnailAssetId,
  bool showInTimeline = true,
}) =>
    SpaceAlbum(
      id: id,
      name: name ?? 'Album $id',
      thumbnailAssetId: thumbnailAssetId,
      showInTimeline: showInTimeline,
    );

/// Wraps [widget] in a [ProviderScope] that overrides [spaceAlbumsProvider]
/// with a fixed list, and a minimal [MaterialApp] for theme/directionality.
///
/// Pass [assetService] to also override [assetServiceProvider] — needed for
/// cover-thumbnail tests that call [assetServiceProvider.getRemoteAsset].
Widget _wrap(
  Widget widget, {
  required String spaceId,
  required List<SpaceAlbum> albums,
  AssetService? assetService,
}) {
  return ProviderScope(
    overrides: [
      spaceAlbumsProvider(spaceId).overrideWith((_) => Stream.value(albums)),
      if (assetService != null) assetServiceProvider.overrideWithValue(assetService),
    ],
    child: MaterialApp(home: Scaffold(body: widget)),
  );
}

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
    final albums = [
      _album(id: 'a1', name: 'Hawaii'),
      _album(id: 'a2', name: 'Sunset'),
    ];

    await tester.pumpWidget(
      _wrap(
        SpaceAlbumsShelf(
          spaceId: spaceId,
          canEdit: true,
          onLinkTap: () {},
          onAlbumTap: (_) {},
        ),
        spaceId: spaceId,
        albums: albums,
      ),
    );
    await tester.pump(); // let StreamProvider emit

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

    await tester.pumpWidget(
      _wrap(
        SpaceAlbumsShelf(
          spaceId: spaceId,
          canEdit: true,
          onLinkTap: () {},
          onAlbumTap: (_) {},
        ),
        spaceId: spaceId,
        albums: albums,
      ),
    );
    await tester.pump();

    // Reef tile is off-timeline → has visibility_off overlay
    expect(find.byIcon(Icons.visibility_off), findsOneWidget);
  });

  testWidgets('count==0 + canEdit=true: shows only the Link tile', (tester) async {
    await tester.pumpWidget(
      _wrap(
        SpaceAlbumsShelf(
          spaceId: spaceId,
          canEdit: true,
          onLinkTap: () {},
          onAlbumTap: (_) {},
        ),
        spaceId: spaceId,
        albums: [],
      ),
    );
    await tester.pump();

    expect(find.byKey(const Key('space-album-link-tile')), findsOneWidget);
    // No cover tiles
    expect(findByKeyPrefix('space-album-tile-'), findsNothing);
  });

  testWidgets('count==0 + canEdit=false: renders nothing', (tester) async {
    await tester.pumpWidget(
      _wrap(
        SpaceAlbumsShelf(
          spaceId: spaceId,
          canEdit: false,
          onLinkTap: () {},
          onAlbumTap: (_) {},
        ),
        spaceId: spaceId,
        albums: [],
      ),
    );
    await tester.pump();

    expect(find.byKey(const Key('space-albums-shelf')), findsNothing);
    expect(find.byKey(const Key('space-album-link-tile')), findsNothing);
    expect(findByKeyPrefix('space-album-tile-'), findsNothing);
  });

  testWidgets('album with null thumbnailAssetId uses photo_album_outlined fallback icon', (tester) async {
    final albums = [
      _album(id: 'a1', name: 'Unsynced', thumbnailAssetId: null),
    ];

    await tester.pumpWidget(
      _wrap(
        SpaceAlbumsShelf(
          spaceId: spaceId,
          canEdit: false,
          onLinkTap: () {},
          onAlbumTap: (_) {},
        ),
        spaceId: spaceId,
        albums: albums,
      ),
    );
    await tester.pump();

    // Cover has no thumbnail → fallback icon is shown
    expect(find.byIcon(Icons.photo_album_outlined), findsOneWidget);
  });

  testWidgets('tapping "See all ▸" invokes the onSeeAll callback', (tester) async {
    var called = false;
    final albums = [_album(id: 'a1', name: 'Hawaii')];

    await tester.pumpWidget(
      _wrap(
        SpaceAlbumsShelf(
          spaceId: spaceId,
          canEdit: true,
          onLinkTap: () {},
          onAlbumTap: (_) {},
          onSeeAll: () => called = true,
        ),
        spaceId: spaceId,
        albums: albums,
      ),
    );
    await tester.pump();

    await tester.tap(find.text('See all ▸'));
    expect(called, isTrue);
  });

  testWidgets(
    'album WITH thumbnailAssetId resolving to asset shows Thumbnail cover (not placeholder icon)',
    (tester) async {
      final mockService = _MockAssetService();
      final asset = _remoteAsset(id: 'thumb-1');
      when(() => mockService.getRemoteAsset('thumb-1')).thenAnswer((_) async => asset);

      final albums = [_album(id: 'a1', name: 'Hawaii', thumbnailAssetId: 'thumb-1')];

      await tester.pumpWidget(
        _wrap(
          SpaceAlbumsShelf(
            spaceId: spaceId,
            canEdit: false,
            onLinkTap: () {},
            onAlbumTap: (_) {},
          ),
          spaceId: spaceId,
          albums: albums,
          assetService: mockService,
        ),
      );
      await tester.pump(); // StreamProvider emits albums
      await tester.pump(); // FutureBuilder resolves (mock future is immediate)

      expect(find.byType(Thumbnail), findsOneWidget);
      expect(find.byIcon(Icons.photo_album_outlined), findsNothing);
    },
  );
}

