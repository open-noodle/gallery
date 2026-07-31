import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:immich_mobile/domain/models/album/album.model.dart';
import 'package:immich_mobile/domain/models/config/app_config.dart';
import 'package:immich_mobile/domain/models/user.model.dart';
import 'package:immich_mobile/domain/services/user.service.dart';
import 'package:immich_mobile/models/albums/album_search.model.dart';
import 'package:immich_mobile/presentation/widgets/album/album_selector.widget.dart';
import 'package:immich_mobile/presentation/widgets/collection/collection_picker.widget.dart';
import 'package:immich_mobile/presentation/widgets/collection/space_collection_section.widget.dart';
import 'package:immich_mobile/providers/infrastructure/album.provider.dart';
import 'package:immich_mobile/providers/infrastructure/remote_album.provider.dart';
import 'package:immich_mobile/providers/infrastructure/settings.provider.dart';
import 'package:immich_mobile/providers/shared_space.provider.dart';
import 'package:immich_mobile/providers/timeline/multiselect.provider.dart';
import 'package:immich_mobile/providers/user.provider.dart';
import 'package:immich_mobile/widgets/common/search_field.dart';
import 'package:mocktail/mocktail.dart';
import 'package:openapi/api.dart';

import '../../../fixtures/user.stub.dart';
import '../../../widget_tester_extensions.dart';

class _MockUserService extends Mock implements UserService {}

// Mirrors `space_collection_section_test.dart`: `currentUserProvider` is a
// `StateNotifierProvider` whose `overrideWith` builder must return a `StateNotifier`.
class _StubCurrentUserNotifier extends CurrentUserProvider {
  _StubCurrentUserNotifier(super.service, UserDto? user) {
    state = user;
  }
}

// `AlbumSelector`'s `initState` fires a post-frame callback that calls
// `refresh()` on the real notifier -- which needs a live `RemoteAlbumService` this
// harness has no reason to stand up. Overriding just `build()` (as
// `space_link_album_page_test.dart` does) leaves `refresh()` pointed at an
// uninitialized service field, so this stub also no-ops `refresh()`.
class _StubRemoteAlbumNotifier extends RemoteAlbumNotifier {
  @override
  RemoteAlbumState build() => const RemoteAlbumState(albums: []);

  @override
  Future<void> refresh() async {}

  // Typing in the search field routes through here; the real one needs the same live
  // service `refresh()` does. The album list is empty in this harness, so echo it back.
  @override
  List<RemoteAlbum> searchAlbums(
    List<RemoteAlbum> albums,
    String query,
    String? userId, [
    QuickFilterMode filterMode = QuickFilterMode.all,
  ]) => albums;
}

void main() {
  SharedSpaceMemberResponseDto member(String userId, SharedSpaceRole role) => SharedSpaceMemberResponseDto(
    userId: userId,
    name: userId,
    email: '$userId@e.com',
    role: role,
    joinedAt: '2026-01-01T00:00:00Z',
    sharePersonMetadata: true,
    showInTimeline: true,
  );

  SharedSpaceResponseDto space(String id, String name) => SharedSpaceResponseDto(
    id: id,
    name: name,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    createdById: 'someone-else',
    members: Optional.present([member('user-1', SharedSpaceRole.owner)]),
    albumCount: const Optional.present(0),
  );

  testWidgets('composes the header, the album selector and the spaces section, in that order', (tester) async {
    final userService = _MockUserService();
    final user = UserStub.user1;
    when(() => userService.tryGetMyUser()).thenReturn(user);
    when(() => userService.watchMyUser()).thenAnswer((_) => const Stream.empty());

    await tester.pumpConsumerWidgetRaw(
      const CustomScrollView(slivers: [CollectionPicker()]),
      overrides: [
        currentUserProvider.overrideWith((ref) => _StubCurrentUserNotifier(userService, user)),
        remoteAlbumProvider.overrideWith(() => _StubRemoteAlbumNotifier()),
        appConfigProvider.overrideWithValue(const AppConfig()),
        sharedSpacesProvider.overrideWith((ref) async => const []),
        multiSelectProvider.overrideWith(
          () => MultiSelectNotifier(const MultiSelectState(selectedAssets: {}, lockedSelectionAssets: {})),
        ),
      ],
    );
    await tester.pump();

    expect(find.byKey(const Key('collection-picker-header')), findsOneWidget);
    expect(find.byType(AlbumSelector), findsOneWidget);
    expect(find.byType(SpaceCollectionSection), findsOneWidget);

    // `AlbumSelector` itself renders a `MultiSliver` (a `RenderSliver`, not a
    // `RenderBox`), so `getTopLeft` cannot target the widget directly; its first
    // content sliver (the search field) stands in for "where AlbumSelector starts".
    final headerY = tester.getTopLeft(find.byKey(const Key('collection-picker-header'))).dy;
    final albumsY = tester.getTopLeft(find.byType(SearchField)).dy;
    expect(headerY, lessThan(albumsY));
  });

  testWidgets('typing in the search field narrows the spaces section too', (tester) async {
    final userService = _MockUserService();
    final user = UserStub.user1;
    when(() => userService.tryGetMyUser()).thenReturn(user);
    when(() => userService.watchMyUser()).thenAnswer((_) => const Stream.empty());

    await tester.pumpConsumerWidgetRaw(
      const CustomScrollView(slivers: [CollectionPicker()]),
      overrides: [
        currentUserProvider.overrideWith((ref) => _StubCurrentUserNotifier(userService, user)),
        remoteAlbumProvider.overrideWith(() => _StubRemoteAlbumNotifier()),
        appConfigProvider.overrideWithValue(const AppConfig()),
        sharedSpacesProvider.overrideWith(
          (ref) async => [space('s1', 'Family Vacation'), space('s2', 'Photography Club')],
        ),
        multiSelectProvider.overrideWith(
          () => MultiSelectNotifier(const MultiSelectState(selectedAssets: {}, lockedSelectionAssets: {})),
        ),
      ],
    );
    await tester.pump();

    expect(find.byKey(const Key('space-row-s1')), findsOneWidget);
    expect(find.byKey(const Key('space-row-s2')), findsOneWidget);

    await tester.enterText(find.byType(SearchField), 'family');
    await tester.pump();

    expect(find.byKey(const Key('space-row-s1')), findsOneWidget);
    expect(
      find.byKey(const Key('space-row-s2')),
      findsNothing,
      reason: 'the search field must filter spaces, not just albums',
    );

    await tester.enterText(find.byType(SearchField), '');
    await tester.pump();

    expect(find.byKey(const Key('space-row-s2')), findsOneWidget);
  });
}
