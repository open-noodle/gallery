import 'package:easy_localization/easy_localization.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/domain/models/album/album.model.dart';
import 'package:immich_mobile/domain/models/config/app_config.dart';
import 'package:immich_mobile/domain/models/setting.model.dart';
import 'package:immich_mobile/domain/services/setting.service.dart';
import 'package:immich_mobile/domain/services/user.service.dart';
import 'package:immich_mobile/models/albums/album_search.model.dart';
import 'package:immich_mobile/presentation/actions/action.dart';
import 'package:immich_mobile/presentation/actions/action.widget.dart';
import 'package:immich_mobile/presentation/actions/download.action.dart';
import 'package:immich_mobile/presentation/actions/share.action.dart';
import 'package:immich_mobile/presentation/widgets/action_buttons/remove_from_album_action_button.widget.dart';
import 'package:immich_mobile/presentation/widgets/spaces/space_album_bottom_sheet.widget.dart';
import 'package:immich_mobile/presentation/widgets/timeline/timeline.state.dart';
import 'package:immich_mobile/providers/infrastructure/album.provider.dart';
import 'package:immich_mobile/providers/infrastructure/remote_album.provider.dart';
import 'package:immich_mobile/providers/infrastructure/setting.provider.dart';
import 'package:immich_mobile/providers/infrastructure/settings.provider.dart';
import 'package:immich_mobile/providers/shared_space.provider.dart';
import 'package:immich_mobile/providers/timeline/multiselect.provider.dart';
import 'package:immich_mobile/providers/user.provider.dart';
import 'package:mocktail/mocktail.dart';
// easy_localization initializes shared_preferences internally; tests need the mock initializer.
// ignore: depend_on_referenced_packages
import 'package:shared_preferences/shared_preferences.dart';

import '../../../fixtures/user.stub.dart';
import '../../../service.mocks.dart';

// Download and Share both render as ActionMenuItem after upstream's action-model
// migration, so match on the wrapped action type — byType(ActionMenuItem) alone
// could not tell them apart.
Finder _actionOfType<T extends ActionBuilder>() => find.byWidgetPredicate((w) => w is ActionWidget && w.action is T);

class _MockUserService extends Mock implements UserService {}

class _StubCurrentUserNotifier extends CurrentUserProvider {
  _StubCurrentUserNotifier(super.service) {
    state = UserStub.user1;
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

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

// AssetDebugAction (upstream #30611, carried into this sheet) reads
// settingsProvider, whose real notifier builds a SettingsService over
// StoreService — and StoreService needs a Drift-backed init this deliberately
// lightweight harness does not do. Serve setting defaults directly instead;
// advancedTroubleshooting defaults to false, which is exactly the state these
// action-set assertions describe (the troubleshoot entry stays hidden).
class _DefaultSettingsNotifier extends SettingsNotifier {
  @override
  SettingsService build() => SettingsService(storeService: MockStoreService());

  @override
  T get<T>(Setting<T> setting) => setting.defaultValue;
}

Widget _wrap(Widget widget, {List<Override> overrides = const []}) {
  final userService = _MockUserService();
  when(() => userService.tryGetMyUser()).thenReturn(UserStub.user1);
  when(() => userService.watchMyUser()).thenAnswer((_) => const Stream.empty());

  return ProviderScope(
    overrides: [
      timelineStateProvider.overrideWith(TimelineStateNotifier.new),
      multiSelectProvider.overrideWith(MultiSelectNotifier.new),
      settingsProvider.overrideWith(_DefaultSettingsNotifier.new),
      // The sheet now always mounts CollectionPicker (#965 follow-up), which composes
      // AlbumSelector + SpaceCollectionSection; both read live providers this harness has no
      // reason to stand up.
      currentUserProvider.overrideWith((ref) => _StubCurrentUserNotifier(userService)),
      remoteAlbumProvider.overrideWith(() => _StubRemoteAlbumNotifier()),
      appConfigProvider.overrideWithValue(const AppConfig()),
      sharedSpacesProvider.overrideWith((ref) async => const []),
      ...overrides,
    ],
    child: EasyLocalization(
      supportedLocales: const [Locale('en')],
      path: '../i18n',
      fallbackLocale: const Locale('en'),
      child: MaterialApp(home: Scaffold(body: widget)),
    ),
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

void main() {
  setUpAll(() async {
    SharedPreferences.setMockInitialValues({});
    await EasyLocalization.ensureInitialized();
  });

  testWidgets('canEdit:true — has Download, Share, and RemoveFromAlbum buttons', (tester) async {
    await tester.pumpWidget(_wrap(const SpaceAlbumBottomSheet(canEdit: true, albumId: 'a1')));
    await tester.pump();

    expect(_actionOfType<DownloadAction>(), findsOneWidget);
    expect(_actionOfType<ShareAction>(), findsOneWidget);
    expect(find.byType(RemoveFromAlbumActionButton), findsOneWidget);
  });

  testWidgets('canEdit:false — has Download and Share but NO RemoveFromAlbum button', (tester) async {
    await tester.pumpWidget(_wrap(const SpaceAlbumBottomSheet(canEdit: false, albumId: 'a1')));
    await tester.pump();

    expect(_actionOfType<DownloadAction>(), findsOneWidget);
    expect(_actionOfType<ShareAction>(), findsOneWidget);
    expect(find.byType(RemoveFromAlbumActionButton), findsNothing);
  });

  testWidgets('canEdit:true — does NOT have Favorite, Archive, Trash, or MoveToLockFolder buttons', (tester) async {
    await tester.pumpWidget(_wrap(const SpaceAlbumBottomSheet(canEdit: true, albumId: 'a1')));
    await tester.pump();

    // Verify forbidden action buttons are absent by checking for their label text
    expect(find.text('Favorite'), findsNothing);
    expect(find.text('Archive'), findsNothing);
    expect(find.text('Trash'), findsNothing);
    expect(find.text('Lock'), findsNothing);
  });
}
