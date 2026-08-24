// #1018: sharing a link from inside a Space. The server authorizes such a link against the space
// role, so the button belongs to the same gate as remove-from-space — an Owner/Editor sees it, a
// Viewer does not. Without it the mobile app has no way to make a link that covers what the space
// shows, which is the gap the discussion reports.
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:immich_mobile/domain/models/album/album.model.dart';
import 'package:immich_mobile/domain/models/asset/base_asset.model.dart';
import 'package:immich_mobile/domain/models/config/app_config.dart';
import 'package:immich_mobile/domain/models/user.model.dart';
import 'package:immich_mobile/domain/services/user.service.dart';
import 'package:immich_mobile/models/albums/album_search.model.dart';
import 'package:immich_mobile/presentation/actions/action.widget.dart';
import 'package:immich_mobile/presentation/actions/share_link.action.dart';
import 'package:immich_mobile/presentation/widgets/bottom_sheet/space_bottom_sheet.widget.dart';
import 'package:immich_mobile/providers/infrastructure/album.provider.dart';
import 'package:immich_mobile/providers/infrastructure/remote_album.provider.dart';
import 'package:immich_mobile/providers/infrastructure/settings.provider.dart';
import 'package:immich_mobile/providers/server_info.provider.dart';
import 'package:immich_mobile/providers/shared_space.provider.dart';
import 'package:immich_mobile/providers/timeline/multiselect.provider.dart';
import 'package:immich_mobile/providers/user.provider.dart';
import 'package:immich_mobile/services/server_info.service.dart';
import 'package:mocktail/mocktail.dart';
import 'package:openapi/api.dart';

import '../../../fixtures/user.stub.dart';
import '../../../widget_tester_extensions.dart';

class _MockUserService extends Mock implements UserService {}

class _MockServerInfoService extends Mock implements ServerInfoService {}

class _StubCurrentUserNotifier extends CurrentUserProvider {
  _StubCurrentUserNotifier(super.service, UserDto? user) {
    state = user;
  }
}

/// The sheet composes `CollectionPicker` → `AlbumSelector`, which fires a post-frame `refresh()`
/// against a live service this harness has no reason to stand up. Same stub as
/// `add_to_collection_surfaces_test.dart`.
class _StubRemoteAlbumNotifier extends RemoteAlbumNotifier {
  @override
  RemoteAlbumState build() => const RemoteAlbumState(albums: []);

  @override
  Future<void> refresh() async {}

  @override
  List<RemoteAlbum> searchAlbums(
    List<RemoteAlbum> albums,
    String query,
    String? userId, [
    QuickFilterMode filterMode = QuickFilterMode.all,
  ]) => albums;
}

/// Rolling carries upstream's action model, so the sheet renders `ShareLinkAction` through an
/// `ActionColumnButton` rather than a bespoke `ShareLinkActionButton` widget.
Finder _shareLinkAction() =>
    find.byWidgetPredicate((widget) => widget is ActionColumnButton && widget.action is ShareLinkAction);

void main() {
  final user = UserStub.user1;

  /// The remote-asset actions only render when the selection holds one. Owned by someone else, so
  /// this is exactly the case the pre-#1018 owner-only link could not cover.
  final contributedAsset = RemoteAsset(
    id: 'asset-1',
    name: 'asset-1',
    ownerId: 'someone-else',
    checksum: 'asset-1',
    type: AssetType.image,
    createdAt: DateTime(2026, 1, 1),
    updatedAt: DateTime(2026, 1, 1),
    isEdited: false,
  );

  Future<void> pumpSheet(WidgetTester tester, SharedSpaceRole role) async {
    final userService = _MockUserService();
    when(() => userService.tryGetMyUser()).thenReturn(user);
    when(() => userService.watchMyUser()).thenAnswer((_) => const Stream.empty());

    await tester.pumpConsumerWidget(
      Scaffold(
        body: SpaceBottomSheet(spaceId: 'space-1', currentUserRole: role),
      ),
      overrides: [
        currentUserProvider.overrideWith((ref) => _StubCurrentUserNotifier(userService, user)),
        remoteAlbumProvider.overrideWith(() => _StubRemoteAlbumNotifier()),
        appConfigProvider.overrideWithValue(const AppConfig()),
        sharedSpacesProvider.overrideWith((ref) async => const []),
        serverInfoProvider.overrideWith((ref) => ServerInfoNotifier(_MockServerInfoService())),
        multiSelectProvider.overrideWith(
          () => MultiSelectNotifier(
            MultiSelectState(selectedAssets: {contributedAsset}, lockedSelectionAssets: const {}),
          ),
        ),
      ],
    );
    await tester.pump();
  }

  testWidgets('offers a share link to a space owner', (tester) async {
    await pumpSheet(tester, SharedSpaceRole.owner);

    expect(_shareLinkAction(), findsOneWidget);
  });

  testWidgets('offers a share link to a space editor', (tester) async {
    await pumpSheet(tester, SharedSpaceRole.editor);

    expect(_shareLinkAction(), findsOneWidget);
  });

  testWidgets('does not offer a share link to a space viewer', (tester) async {
    await pumpSheet(tester, SharedSpaceRole.viewer);

    expect(_shareLinkAction(), findsNothing);
  });

  testWidgets('scopes the link to the space it was opened from', (tester) async {
    await pumpSheet(tester, SharedSpaceRole.editor);

    final button = tester.widget<ActionColumnButton>(_shareLinkAction());
    expect((button.action as ShareLinkAction).spaceId, 'space-1');
  });
}
