import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/domain/models/asset/base_asset.model.dart';
import 'package:immich_mobile/domain/models/collection_target.dart';
import 'package:immich_mobile/domain/models/space_album.model.dart';
import 'package:immich_mobile/domain/models/user.model.dart';
import 'package:immich_mobile/domain/services/user.service.dart';
import 'package:immich_mobile/presentation/widgets/collection/space_collection_section.widget.dart';
import 'package:immich_mobile/presentation/widgets/images/thumbnail.widget.dart';
import 'package:immich_mobile/providers/infrastructure/space_album.provider.dart';
import 'package:immich_mobile/providers/shared_space.provider.dart';
import 'package:immich_mobile/providers/timeline/multiselect.provider.dart';
import 'package:immich_mobile/providers/user.provider.dart';
import 'package:immich_mobile/widgets/spaces/space_collage.dart';
import 'package:mocktail/mocktail.dart';
import 'package:openapi/api.dart';

import '../../../fixtures/user.stub.dart';
import '../../../unit/presentation/presentation_context.dart';
import '../../../widget_tester_extensions.dart';

class _MockUserService extends Mock implements UserService {}

// The real `CurrentUserProvider` reads its initial state from a `UserService` in its
// constructor, so a widget test seeds the *notifier* rather than a plain `UserDto?` value --
// `currentUserProvider` is a `StateNotifierProvider`, whose `overrideWith` builder must return
// a `StateNotifier`, not the state itself. Mirrors the pattern used by
// `space_link_album_page_test.dart` / `people_details_widget_test.dart`.
class _StubCurrentUserNotifier extends CurrentUserProvider {
  _StubCurrentUserNotifier(super.service, UserDto? user) {
    state = user;
  }
}

void main() {
  setUpAll(() async {
    // PresentationContext.create() runs TestUtils.init() and initializes StoreService, which
    // SpaceCollage's RemoteImageProvider reads when it builds its image URLs.
    await PresentationContext.create();
  });

  SharedSpaceMemberResponseDto member(String userId, SharedSpaceRole role) => SharedSpaceMemberResponseDto(
    userId: userId,
    name: userId,
    email: '$userId@e.com',
    role: role,
    joinedAt: '2026-01-01T00:00:00Z',
    sharePersonMetadata: true,
    showInTimeline: true,
  );

  SharedSpaceResponseDto space(
    String id, {
    SharedSpaceRole role = SharedSpaceRole.owner,
    int albums = 0,
    String? name,
    List<String> recentAssetIds = const [],
  }) => SharedSpaceResponseDto(
    id: id,
    name: name ?? 'Space $id',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    createdById: 'someone-else',
    recentAssetIds: Optional.present(recentAssetIds),
    recentAssetThumbhashes: const Optional.present([]),
    members: Optional.present([member('user-1', role)]),
    albumCount: Optional.present(albums),
  );

  SpaceAlbum album(String id, String name, {String? thumbnailAssetId}) => SpaceAlbum(
    id: id,
    name: name,
    thumbnailAssetId: thumbnailAssetId,
    showInTimeline: true,
    linkedAt: DateTime(2026, 1, 1),
    updatedAt: DateTime(2026, 1, 1),
    createdAt: DateTime(2026, 1, 1),
  );

  RemoteAsset asset(String id, {String ownerId = 'user-1'}) => RemoteAsset(
    id: id,
    name: id,
    ownerId: ownerId,
    checksum: id,
    type: AssetType.image,
    createdAt: DateTime(2026, 1, 1),
    updatedAt: DateTime(2026, 1, 1),
    isEdited: false,
  );

  Override currentUserOverride(String? userId) {
    final userService = _MockUserService();
    final user = userId == null ? null : UserStub.user1;
    when(() => userService.tryGetMyUser()).thenReturn(user);
    when(() => userService.watchMyUser()).thenAnswer((_) => const Stream.empty());
    return currentUserProvider.overrideWith((ref) => _StubCurrentUserNotifier(userService, user));
  }

  Future<List<CollectionTarget>> pump(
    WidgetTester tester, {
    required List<SharedSpaceResponseDto> spaces,
    Map<String, List<SpaceAlbum>> albums = const {},
    List<RemoteAsset>? selection,
    List<RemoteAsset>? assets,
    String? excludeSpaceId,
    String? userId = 'user-1',
    String searchQuery = '',
    bool raw = false,
    Set<String> pendingAlbumSpaceIds = const {},
  }) async {
    final targets = <CollectionTarget>[];
    final overrides = <Override>[
      sharedSpacesProvider.overrideWith((ref) async => spaces),
      currentUserOverride(userId),
      multiSelectProvider.overrideWith(
        () => MultiSelectNotifier(
          MultiSelectState(
            selectedAssets: {
              ...(selection ?? [asset('a')]),
            },
            lockedSelectionAssets: const {},
          ),
        ),
      ),
      for (final entry in albums.entries)
        if (!pendingAlbumSpaceIds.contains(entry.key))
          spaceAlbumsProvider(entry.key).overrideWith((ref) => Stream.value(entry.value)),
      // A stream that never emits — the provider stays in its loading state.
      for (final spaceId in pendingAlbumSpaceIds)
        spaceAlbumsProvider(spaceId).overrideWith((ref) => const Stream<List<SpaceAlbum>>.empty()),
    ];
    final widget = SpaceCollectionSection(
      onTargetSelected: targets.add,
      excludeSpaceId: excludeSpaceId,
      searchQuery: searchQuery,
      assets: assets,
    );
    if (raw) {
      await tester.pumpConsumerWidgetRaw(widget, overrides: overrides);
    } else {
      await tester.pumpConsumerWidget(widget, overrides: overrides);
    }
    return targets;
  }

  testWidgets('renders nothing when there are no writable spaces', (tester) async {
    await pump(tester, spaces: [space('s1', role: SharedSpaceRole.viewer)]);

    expect(find.byKey(const Key('space-collection-header')), findsNothing);
    expect(find.byKey(const Key('space-row-s1')), findsNothing);
  });

  testWidgets('lists only writable spaces, ordered by name', (tester) async {
    await pump(
      tester,
      spaces: [
        space('s2'),
        space('s1'),
        space('s3', role: SharedSpaceRole.viewer),
      ],
    );

    expect(find.byKey(const Key('space-row-s1')), findsOneWidget);
    expect(find.byKey(const Key('space-row-s2')), findsOneWidget);
    expect(find.byKey(const Key('space-row-s3')), findsNothing);
    final y1 = tester.getTopLeft(find.byKey(const Key('space-row-s1'))).dy;
    final y2 = tester.getTopLeft(find.byKey(const Key('space-row-s2'))).dy;
    expect(y1, lessThan(y2));
  });

  testWidgets('a space with no linked albums adds to the pool on a single tap', (tester) async {
    final targets = await pump(tester, spaces: [space('s1', albums: 0)]);

    await tester.tap(find.byKey(const Key('space-row-s1')));
    await tester.pumpAndSettle();

    expect(targets, hasLength(1));
    expect((targets.single as SpacePoolTarget).space.id, 's1');
  });

  testWidgets('a space with albums expands instead of adding, then collapses', (tester) async {
    final targets = await pump(
      tester,
      spaces: [space('s1', albums: 2)],
      albums: {
        's1': [album('a1', 'Ski trip'), album('a2', 'Christmas')],
      },
    );

    await tester.tap(find.byKey(const Key('space-row-s1')));
    await tester.pumpAndSettle();

    expect(targets, isEmpty, reason: 'expanding must not dump photos into the space');
    expect(find.byKey(const Key('space-pool-child-s1')), findsOneWidget);
    expect(find.byKey(const Key('space-album-child-a1')), findsOneWidget);

    await tester.tap(find.byKey(const Key('space-row-s1')));
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('space-pool-child-s1')), findsNothing);
  });

  testWidgets('the pool child emits a SpacePoolTarget', (tester) async {
    final targets = await pump(
      tester,
      spaces: [space('s1', albums: 1)],
      albums: {
        's1': [album('a1', 'Ski')],
      },
    );

    await tester.tap(find.byKey(const Key('space-row-s1')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('space-pool-child-s1')));
    await tester.pumpAndSettle();

    expect((targets.single as SpacePoolTarget).space.id, 's1');
  });

  testWidgets('an album child emits a SpaceAlbumTarget carrying the owning space id', (tester) async {
    final targets = await pump(
      tester,
      spaces: [space('s1', albums: 1)],
      albums: {
        's1': [album('a1', 'Ski')],
      },
    );

    await tester.tap(find.byKey(const Key('space-row-s1')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('space-album-child-a1')));
    await tester.pumpAndSettle();

    final target = targets.single as SpaceAlbumTarget;
    expect(target.spaceId, 's1');
    expect(target.album.id, 'a1');
  });

  testWidgets('expanding a second space collapses the first', (tester) async {
    await pump(
      tester,
      spaces: [space('s1', albums: 1), space('s2', albums: 1)],
      albums: {
        's1': [album('a1', 'One')],
        's2': [album('a2', 'Two')],
      },
    );

    await tester.tap(find.byKey(const Key('space-row-s1')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('space-row-s2')));
    await tester.pumpAndSettle();

    expect(find.byKey(const Key('space-pool-child-s1')), findsNothing);
    expect(find.byKey(const Key('space-pool-child-s2')), findsOneWidget);
  });

  testWidgets('albumCount > 0 but an empty stream still offers the pool', (tester) async {
    final targets = await pump(tester, spaces: [space('s1', albums: 3)], albums: {'s1': const []});

    await tester.tap(find.byKey(const Key('space-row-s1')));
    await tester.pumpAndSettle();

    expect(find.byKey(const Key('space-albums-empty-s1')), findsOneWidget);
    await tester.tap(find.byKey(const Key('space-pool-child-s1')));
    await tester.pumpAndSettle();
    expect(targets, hasLength(1));
  });

  // "This space has no albums yet" must not flash before the Drift watch has answered — it is
  // a claim about the space, and while loading we do not know it. Web draws the same line.
  testWidgets('an expanded space says nothing about its albums until the watch answers', (tester) async {
    await pump(
      tester,
      spaces: [space('s1', albums: 2)],
      albums: {'s1': const []}, // no stream value pumped for s1 below
      pendingAlbumSpaceIds: {'s1'},
    );

    await tester.tap(find.byKey(const Key('space-row-s1')));
    await tester.pumpAndSettle();

    expect(find.byKey(const Key('space-pool-child-s1')), findsOneWidget, reason: 'the pool is always reachable');
    expect(find.byKey(const Key('space-albums-empty-s1')), findsNothing);
  });

  testWidgets('a double-tap on a plain row emits exactly one target', (tester) async {
    final targets = await pump(tester, spaces: [space('s1', albums: 0)]);

    await tester.tap(find.byKey(const Key('space-row-s1')));
    await tester.tap(find.byKey(const Key('space-row-s1')));
    await tester.pumpAndSettle();

    expect(targets, hasLength(1), reason: 'two adds would fire two activity entries');
  });

  testWidgets('the search query narrows the rows to spaces whose name contains it', (tester) async {
    await pump(
      tester,
      spaces: [
        space('s1', name: 'Family Vacation'),
        space('s2', name: 'Photography Club'),
      ],
      searchQuery: 'famil',
    );

    expect(find.byKey(const Key('space-row-s1')), findsOneWidget);
    expect(find.byKey(const Key('space-row-s2')), findsNothing);
  });

  testWidgets('the search query matches case-insensitively, ignoring surrounding whitespace', (tester) async {
    await pump(
      tester,
      spaces: [space('s1', name: 'Family Vacation')],
      searchQuery: '  FAMILY  ',
    );

    expect(find.byKey(const Key('space-row-s1')), findsOneWidget);
  });

  testWidgets('a query matching no space hides the section entirely', (tester) async {
    await pump(
      tester,
      spaces: [space('s1', name: 'Family Vacation')],
      searchQuery: 'zzz',
    );

    expect(find.byKey(const Key('space-collection-header')), findsNothing);
    expect(find.byKey(const Key('space-row-s1')), findsNothing);
  });

  testWidgets('a non-owned selection hides every row behind a notice', (tester) async {
    await pump(
      tester,
      spaces: [space('s1')],
      selection: [
        asset('a'),
        asset('b', ownerId: 'other'),
      ],
    );

    expect(
      find.text("Your selection includes photos owned by other members, so it can't be added to a space."),
      findsOneWidget,
    );
    expect(find.byKey(const Key('space-row-s1')), findsNothing);
  });

  // #965: the asset viewer has no multiselect, so it hands the section the one asset the
  // viewer is on. Falling back to the (empty) multiselect there would read as "nothing
  // non-owned" and offer space targets for a photo that can never reach one.
  testWidgets('an explicit asset list is used instead of the multiselect', (tester) async {
    await pump(
      tester,
      spaces: [space('s1')],
      selection: [asset('a')], // owned — on its own this would show the rows
      assets: [asset('b', ownerId: 'other')],
    );

    expect(
      find.text("Your selection includes photos owned by other members, so it can't be added to a space."),
      findsOneWidget,
    );
    expect(find.byKey(const Key('space-row-s1')), findsNothing);
  });

  testWidgets('an explicit owned asset list still offers the rows', (tester) async {
    await pump(
      tester,
      spaces: [space('s1')],
      selection: [asset('a', ownerId: 'other')], // ignored
      assets: [asset('b')],
    );

    expect(find.byKey(const Key('space-row-s1')), findsOneWidget);
  });

  testWidgets('an unknown current user hides the rows (fail closed)', (tester) async {
    await pump(tester, spaces: [space('s1')], userId: null);

    expect(find.byKey(const Key('space-row-s1')), findsNothing);
  });

  testWidgets('the excluded space is absent from its own list', (tester) async {
    await pump(tester, spaces: [space('s1'), space('s2')], excludeSpaceId: 's1');

    expect(find.byKey(const Key('space-row-s1')), findsNothing);
    expect(find.byKey(const Key('space-row-s2')), findsOneWidget);
  });

  testWidgets('a provider error hides the section rather than surfacing an error', (tester) async {
    final targets = <CollectionTarget>[];
    await tester.pumpConsumerWidget(
      SpaceCollectionSection(onTargetSelected: targets.add),
      overrides: [
        sharedSpacesProvider.overrideWith((ref) async => throw Exception('offline')),
        currentUserOverride('user-1'),
      ],
    );

    expect(find.byKey(const Key('space-collection-header')), findsNothing);
  });

  testWidgets('the double-tap latch clears once the parent is no longer busy', (tester) async {
    final targets = <CollectionTarget>[];
    var busy = false;
    late StateSetter setOuter;

    await tester.pumpConsumerWidget(
      StatefulBuilder(
        builder: (context, setState) {
          setOuter = setState;
          return SpaceCollectionSection(
            onTargetSelected: (target) {
              targets.add(target);
              setState(() => busy = true);
            },
            isBusy: busy,
          );
        },
      ),
      overrides: [
        sharedSpacesProvider.overrideWith((ref) async => [space('s1', albums: 0)]),
        currentUserOverride('user-1'),
        multiSelectProvider.overrideWith(
          () => MultiSelectNotifier(MultiSelectState(selectedAssets: {asset('a')}, lockedSelectionAssets: const {})),
        ),
      ],
    );

    await tester.tap(find.byKey(const Key('space-row-s1')));
    await tester.pumpAndSettle();
    expect(targets, hasLength(1));

    // The add failed: the parent clears busy and the sheet stays open.
    setOuter(() => busy = false);
    await tester.pumpAndSettle();

    await tester.tap(find.byKey(const Key('space-row-s1')));
    await tester.pumpAndSettle();

    expect(targets, hasLength(2), reason: 'a failed add must not leave the section permanently inert');
  });

  testWidgets('T1: a space with recent assets renders a collage, not a plain colour disc', (tester) async {
    await pump(tester, spaces: [space('s1', recentAssetIds: ['a1', 'a2'])]);

    expect(find.byType(SpaceCollage), findsOneWidget);
    expect(find.byType(CircleAvatar), findsNothing);
  });

  testWidgets('T2: a space with no recent assets still renders the collage on its empty state', (tester) async {
    await pump(tester, spaces: [space('s1', recentAssetIds: const [])]);

    // The collage draws its own gradient fallback when the id list is empty; the row must not
    // silently drop its leading widget in that case.
    expect(find.byType(SpaceCollage), findsOneWidget);
  });

  testWidgets('T3: a space album with a thumbnail asset renders it', (tester) async {
    await pump(
      tester,
      spaces: [space('s1', albums: 1)],
      albums: {
        's1': [album('al1', 'Hawaii', thumbnailAssetId: 'asset-1')],
      },
    );
    await tester.tap(find.byKey(const Key('space-row-s1')));
    // A single pump only rebuilds with the album stream override still in its loading state --
    // spaceAlbumsProvider's first value arrives via a microtask the frame doesn't wait on --
    // so the album child never mounts under one pump. pumpAndSettle matches every other
    // expand-then-read-children case in this file (e.g. "an album child emits a
    // SpaceAlbumTarget...").
    await tester.pumpAndSettle();

    expect(find.byType(Thumbnail), findsOneWidget);
  });

  testWidgets('T4: a space album with no thumbnail asset falls back to the icon', (tester) async {
    await pump(
      tester,
      spaces: [space('s1', albums: 1)],
      albums: {
        's1': [album('al1', 'Hawaii', thumbnailAssetId: null)],
      },
    );
    await tester.tap(find.byKey(const Key('space-row-s1')));
    await tester.pumpAndSettle();

    expect(find.byIcon(Icons.photo_album_outlined), findsOneWidget);
    expect(find.byType(Thumbnail), findsNothing);
  });

  testWidgets('T5: the pool child keeps its action icon and never becomes a thumbnail', (tester) async {
    await pump(
      tester,
      spaces: [space('s1', albums: 1)],
      albums: {
        's1': [album('al1', 'Hawaii', thumbnailAssetId: 'asset-1')],
      },
    );
    await tester.tap(find.byKey(const Key('space-row-s1')));
    await tester.pumpAndSettle();

    expect(find.byIcon(Icons.workspaces_outline), findsOneWidget);
  });
}
