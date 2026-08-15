// #965: "add to a Shared Space album" used to depend on which screen you started from —
// only the surfaces mounting the fork's `CollectionPicker` offered spaces at all, and the
// rest mounted upstream's bare `AlbumSelector`. These tests pin the wiring: every
// add-to-collection surface mounts the one picker.
//
// The picker's own behaviour (which spaces, which albums, which dispatch) is covered by
// `collection/collection_picker_test.dart` and `collection/space_collection_section_test.dart`;
// what can silently regress here is a surface being left behind on the album-only selector.
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:immich_mobile/constants/enums.dart';
import 'package:immich_mobile/domain/models/album/album.model.dart';
import 'package:immich_mobile/domain/models/asset/base_asset.model.dart';
import 'package:immich_mobile/domain/models/config/app_config.dart';
import 'package:immich_mobile/domain/models/setting.model.dart';
import 'package:immich_mobile/domain/models/user.model.dart';
import 'package:immich_mobile/domain/services/setting.service.dart';
import 'package:immich_mobile/domain/services/user.service.dart';
import 'package:immich_mobile/models/albums/album_search.model.dart';
import 'package:immich_mobile/presentation/widgets/action_buttons/add_action_button.widget.dart';
import 'package:immich_mobile/presentation/widgets/action_buttons/base_action_button.widget.dart';
import 'package:immich_mobile/presentation/widgets/bottom_sheet/archive_bottom_sheet.widget.dart';
import 'package:immich_mobile/presentation/widgets/bottom_sheet/base_bottom_sheet.widget.dart';
import 'package:immich_mobile/presentation/widgets/bottom_sheet/favorite_bottom_sheet.widget.dart';
import 'package:immich_mobile/presentation/widgets/bottom_sheet/local_album_bottom_sheet.widget.dart';
import 'package:immich_mobile/presentation/widgets/bottom_sheet/remote_album_bottom_sheet.widget.dart';
import 'package:immich_mobile/presentation/widgets/collection/collection_picker.widget.dart';
import 'package:immich_mobile/presentation/widgets/spaces/space_album_bottom_sheet.widget.dart';
import 'package:immich_mobile/providers/asset_viewer/asset_viewer.provider.dart';
import 'package:immich_mobile/providers/infrastructure/album.provider.dart';
import 'package:immich_mobile/providers/infrastructure/remote_album.provider.dart';
import 'package:immich_mobile/providers/infrastructure/setting.provider.dart';
import 'package:immich_mobile/providers/infrastructure/settings.provider.dart' show appConfigProvider;
import 'package:immich_mobile/providers/routes.provider.dart';
import 'package:immich_mobile/providers/server_info.provider.dart';
import 'package:immich_mobile/providers/shared_space.provider.dart';
import 'package:immich_mobile/providers/timeline/multiselect.provider.dart';
import 'package:immich_mobile/providers/user.provider.dart';
import 'package:immich_mobile/services/server_info.service.dart';
import 'package:mocktail/mocktail.dart';

import '../../../fixtures/user.stub.dart';
import '../../../service.mocks.dart';
import '../../../unit/factories/remote_album_factory.dart';
import '../../../widget_tester_extensions.dart';

class _MockUserService extends Mock implements UserService {}

// AssetDebugAction (upstream #30611, carried into every one of these sheets) reads
// settingsProvider, whose real notifier builds a SettingsService over StoreService — and
// StoreService needs a Drift-backed init() this deliberately lightweight harness does not do.
// Serve setting defaults directly instead. Same shape as space_album_bottom_sheet_test.dart.
class _DefaultSettingsNotifier extends SettingsNotifier {
  @override
  SettingsService build() => SettingsService(storeService: MockStoreService());

  @override
  T get<T>(Setting<T> setting) => setting.defaultValue;
}

class _StubCurrentUserNotifier extends CurrentUserProvider {
  _StubCurrentUserNotifier(super.service, UserDto? user) {
    state = user;
  }
}

/// `AlbumSelector` fires a post-frame `refresh()` against a live `RemoteAlbumService` that
/// this harness has no reason to stand up; the picker composes it, so stub both.
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

class _MockServerInfoService extends Mock implements ServerInfoService {}

class _StubAssetViewerNotifier extends AssetViewerStateNotifier {
  _StubAssetViewerNotifier(this.asset);

  final BaseAsset asset;

  @override
  AssetViewerState build() => AssetViewerState(currentAsset: asset);
}

void main() {
  final user = UserStub.user1;

  RemoteAsset asset(String id) => RemoteAsset(
    id: id,
    name: id,
    ownerId: user.id,
    checksum: id,
    type: AssetType.image,
    createdAt: DateTime(2026, 1, 1),
    updatedAt: DateTime(2026, 1, 1),
    isEdited: false,
  );

  RemoteAlbum ownedAlbum() => RemoteAlbumFactory.create(ownerId: user.id, ownerName: user.name, assetCount: 1);

  RemoteAlbum foreignAlbum() =>
      RemoteAlbumFactory.create(ownerId: 'someone-else', ownerName: 'Someone Else', assetCount: 1);

  Future<void> pumpSheet(WidgetTester tester, Widget sheet) async {
    final userService = _MockUserService();
    when(() => userService.tryGetMyUser()).thenReturn(user);
    when(() => userService.watchMyUser()).thenAnswer((_) => const Stream.empty());

    // The localized helper, not the raw one: these sheets are mostly action buttons, and
    // every one of them resolves an i18n key at build time.
    await tester.pumpConsumerWidget(
      sheet,
      overrides: [
        settingsProvider.overrideWith(_DefaultSettingsNotifier.new),
        currentUserProvider.overrideWith((ref) => _StubCurrentUserNotifier(userService, user)),
        // Reads the auto_route stack, which this harness has none of. Every action these
        // sheets mount gates on it, so it has to be answered before any of them build.
        inLockedViewProvider.overrideWithValue(false),
        remoteAlbumProvider.overrideWith(() => _StubRemoteAlbumNotifier()),
        appConfigProvider.overrideWithValue(const AppConfig()),
        sharedSpacesProvider.overrideWith((ref) async => const []),
        serverInfoProvider.overrideWith((ref) => ServerInfoNotifier(_MockServerInfoService())),
        multiSelectProvider.overrideWith(
          () => MultiSelectNotifier(MultiSelectState(selectedAssets: {asset('a')}, lockedSelectionAssets: const {})),
        ),
      ],
    );
    await tester.pump();
  }

  /// Assert on the sliver list the sheet was handed, not on the rendered tree.
  ///
  /// These sheets open at 0.18–0.4 of the screen. Measured: `find.byType(CollectionPicker)`
  /// finds it in the favorites sheet (0.4) but reports nothing for the remote-album (0.22),
  /// archive (0.25), and space-album (0.18) sheets, because the picker sits below the viewport
  /// and its sliver is never built. That makes a rendered-tree assertion pass or fail on sheet
  /// height rather than on wiring. What the picker renders once built is covered by the picker's
  /// own tests.
  void expectPickerMounted(WidgetTester tester) {
    final slivers = tester.widget<BaseBottomSheet>(find.byType(BaseBottomSheet)).slivers ?? const <Widget>[];
    // Reverting a surface to `[AddToAlbumHeader(), AlbumSelector(...)]` — upstream's album-only
    // picker, which is the bug — empties this.
    expect(slivers.whereType<CollectionPicker>(), hasLength(1));
  }

  testWidgets('a selection inside an owned album offers spaces', (tester) async {
    await pumpSheet(tester, RemoteAlbumBottomSheet(album: ownedAlbum()));
    expectPickerMounted(tester);
  });

  testWidgets('a selection in favorites offers spaces', (tester) async {
    await pumpSheet(tester, const FavoriteBottomSheet());
    expectPickerMounted(tester);
  });

  testWidgets('a selection in the archive offers spaces', (tester) async {
    await pumpSheet(tester, const ArchiveBottomSheet());
    expectPickerMounted(tester);
  });

  testWidgets('a selection in an on-device album offers spaces', (tester) async {
    await pumpSheet(tester, const LocalAlbumBottomSheet());
    expectPickerMounted(tester);
  });

  testWidgets('the asset viewer + button offers spaces, judged against the viewed asset', (tester) async {
    final viewed = asset('viewed');
    final userService = _MockUserService();
    when(() => userService.tryGetMyUser()).thenReturn(user);
    when(() => userService.watchMyUser()).thenAnswer((_) => const Stream.empty());

    await tester.pumpConsumerWidget(
      const AddActionButton(),
      overrides: [
        settingsProvider.overrideWith(_DefaultSettingsNotifier.new),
        currentUserProvider.overrideWith((ref) => _StubCurrentUserNotifier(userService, user)),
        assetViewerProvider.overrideWith(() => _StubAssetViewerNotifier(viewed)),
        // Reads the auto_route stack, which this harness has none of.
        inLockedViewProvider.overrideWithValue(false),
        remoteAlbumProvider.overrideWith(() => _StubRemoteAlbumNotifier()),
        appConfigProvider.overrideWithValue(const AppConfig()),
        sharedSpacesProvider.overrideWith((ref) async => const []),
        multiSelectProvider.overrideWith(
          () => MultiSelectNotifier(const MultiSelectState(selectedAssets: {}, lockedSelectionAssets: {})),
        ),
      ],
    );

    await tester.tap(find.byType(BaseActionButton).first);
    await tester.pumpAndSettle();
    await tester.tap(find.widgetWithText(BaseActionButton, 'Album'));
    await tester.pumpAndSettle();

    final picker = tester
        .widget<BaseBottomSheet>(find.byType(BaseBottomSheet))
        .slivers!
        .whereType<CollectionPicker>()
        .single;
    expect(picker.source, ActionSource.viewer);
    // The viewer has no multiselect, so it must state the asset the notices reason about.
    expect(picker.assets, [viewed]);
  });

  testWidgets('S1: the space album sheet offers the collection picker', (tester) async {
    await pumpSheet(tester, const SpaceAlbumBottomSheet(canEdit: true, albumId: 'al1'));
    expectPickerMounted(tester);
  });

  testWidgets('S2: the space album sheet does not exclude its own space', (tester) async {
    await pumpSheet(tester, const SpaceAlbumBottomSheet(canEdit: true, albumId: 'al1'));

    // Assert on the wiring, not on rendered rows: the space list lives inside the picker, which is
    // below this sheet's 0.18 viewport and never built. A null excludeSpaceId is exactly what keeps
    // the current space reachable, so moving a photo between two albums of one space works.
    final slivers = tester.widget<BaseBottomSheet>(find.byType(BaseBottomSheet)).slivers ?? const <Widget>[];
    final picker = slivers.whereType<CollectionPicker>().single;
    expect(picker.excludeSpaceId, isNull);
  });

  testWidgets('S3: an album the user does not own still offers the picker', (tester) async {
    await pumpSheet(tester, RemoteAlbumBottomSheet(album: foreignAlbum()));
    expectPickerMounted(tester);
  });

  testWidgets('S5: an album the user owns still offers the picker', (tester) async {
    await pumpSheet(tester, RemoteAlbumBottomSheet(album: ownedAlbum()));
    expectPickerMounted(tester);
  });
}
