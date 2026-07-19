import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/domain/models/album/album.model.dart';
import 'package:immich_mobile/domain/models/user.model.dart';
import 'package:immich_mobile/domain/services/user.service.dart';
import 'package:immich_mobile/pages/library/spaces/space_link_album.page.dart';
import 'package:immich_mobile/providers/infrastructure/album.provider.dart';
import 'package:immich_mobile/providers/infrastructure/remote_album.provider.dart';
import 'package:immich_mobile/providers/user.provider.dart';
import 'package:mocktail/mocktail.dart';

import '../../widget_tester_extensions.dart';

// ---------------------------------------------------------------------------
// Fakes / stubs
// ---------------------------------------------------------------------------

class _MockUserService extends Mock implements UserService {}

RemoteAlbum _album({
  required String id,
  required String ownerId,
  String? name,
  int assetCount = 0,
  AlbumUserRole? currentUserRole,
}) =>
    RemoteAlbum(
      id: id,
      name: name ?? 'Album $id',
      ownerId: ownerId,
      description: '',
      createdAt: DateTime(2026, 1, 1),
      updatedAt: DateTime(2026, 1, 1),
      isActivityEnabled: false,
      order: AlbumAssetOrder.desc,
      assetCount: assetCount,
      ownerName: 'Test User',
      isShared: false,
      currentUserRole: currentUserRole,
    );

const _currentUserId = 'user-me';

UserDto _userDto(String id) =>
    UserDto(id: id, email: '$id@example.com', name: id, profileChangedAt: DateTime(2024));

class _StubRemoteAlbumNotifier extends RemoteAlbumNotifier {
  final List<RemoteAlbum> _albums;
  _StubRemoteAlbumNotifier(this._albums);

  @override
  RemoteAlbumState build() => RemoteAlbumState(albums: _albums);
}

class _StubCurrentUserNotifier extends CurrentUserProvider {
  _StubCurrentUserNotifier(super.service, UserDto user) {
    state = user;
  }
}

List<Override> _overrides({required List<RemoteAlbum> albums}) {
  final userService = _MockUserService();
  final user = _userDto(_currentUserId);
  when(() => userService.tryGetMyUser()).thenReturn(user);
  when(() => userService.watchMyUser()).thenAnswer((_) => const Stream.empty());

  return [
    remoteAlbumProvider.overrideWith(() => _StubRemoteAlbumNotifier(albums)),
    currentUserProvider.overrideWith((ref) => _StubCurrentUserNotifier(userService, user)),
  ];
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

void main() {
  const spaceId = 'space-1';

  testWidgets(
      '2 candidates (1 already linked) → only 2 selectable rows; linked one absent',
      (tester) async {
    final albums = [
      _album(id: 'a1', ownerId: _currentUserId, name: 'Hawaii'),
      _album(id: 'a2', ownerId: _currentUserId, name: 'Sunsets'),
      _album(id: 'a3', ownerId: _currentUserId, name: 'Already Linked'),
    ];

    await tester.pumpConsumerWidget(
      const SpaceLinkAlbumPage(
        spaceId: spaceId,
        linkedAlbumIds: ['a3'],
      ),
      overrides: _overrides(albums: albums),
    );

    expect(find.byKey(const Key('link-album-row-a1')), findsOneWidget);
    expect(find.byKey(const Key('link-album-row-a2')), findsOneWidget);
    expect(find.byKey(const Key('link-album-row-a3')), findsNothing);
  });

  testWidgets('search field filters rows by name (case-insensitive)',
      (tester) async {
    final albums = [
      _album(id: 'a1', ownerId: _currentUserId, name: 'Hawaii Trip'),
      _album(id: 'a2', ownerId: _currentUserId, name: 'Sunsets'),
      _album(id: 'a3', ownerId: _currentUserId, name: 'Beach hawaii'),
    ];

    await tester.pumpConsumerWidget(
      const SpaceLinkAlbumPage(spaceId: spaceId, linkedAlbumIds: []),
      overrides: _overrides(albums: albums),
    );

    // Type a query.
    await tester.enterText(find.byType(TextField), 'HAWAII');
    await tester.pump();

    expect(find.byKey(const Key('link-album-row-a1')), findsOneWidget);
    expect(find.byKey(const Key('link-album-row-a2')), findsNothing);
    expect(find.byKey(const Key('link-album-row-a3')), findsOneWidget);
  });

  testWidgets(
      'selecting 2 rows enables "Link (2)" confirm action; tapping it calls onAlbumsPicked',
      (tester) async {
    final albums = [
      _album(id: 'a1', ownerId: _currentUserId, name: 'Hawaii'),
      _album(id: 'a2', ownerId: _currentUserId, name: 'Sunsets'),
    ];

    final List<String> picked = [];

    await tester.pumpConsumerWidget(
      SpaceLinkAlbumPage(
        spaceId: spaceId,
        linkedAlbumIds: const [],
        onAlbumsPicked: picked.addAll,
      ),
      overrides: _overrides(albums: albums),
    );

    // Confirm button should be present when nothing selected (disabled).
    expect(find.byKey(const Key('link-album-confirm')), findsOneWidget);
    // The button text should be plain "Link" when 0 selected.
    expect(find.text('Link'), findsOneWidget);

    // Select both rows.
    await tester.tap(find.byKey(const Key('link-album-row-a1')));
    await tester.pump();
    await tester.tap(find.byKey(const Key('link-album-row-a2')));
    await tester.pump();

    // Button label updates to "Link (2)".
    expect(find.text('Link (2)'), findsOneWidget);

    // Tap confirm.
    await tester.tap(find.byKey(const Key('link-album-confirm')));
    await tester.pump();

    expect(picked.toSet(), equals({'a1', 'a2'}));
  });

  testWidgets('empty candidates → empty state key present', (tester) async {
    // Viewer album only — not included as a candidate.
    final albums = [
      _album(
        id: 'v1',
        ownerId: 'other-user',
        name: 'View Only',
        currentUserRole: AlbumUserRole.viewer,
      ),
    ];

    await tester.pumpConsumerWidget(
      const SpaceLinkAlbumPage(spaceId: spaceId, linkedAlbumIds: []),
      overrides: _overrides(albums: albums),
    );

    expect(find.byKey(const Key('link-album-empty')), findsOneWidget);
    expect(
      find.byWidgetPredicate(
        (w) =>
            w.key is ValueKey<String> &&
            (w.key as ValueKey<String>).value.startsWith('link-album-row-'),
      ),
      findsNothing,
    );
  });
}
