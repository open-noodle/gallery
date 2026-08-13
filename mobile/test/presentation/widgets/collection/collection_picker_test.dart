import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/constants/enums.dart';
import 'package:immich_mobile/domain/models/album/album.model.dart';
import 'package:immich_mobile/domain/models/asset/base_asset.model.dart';
import 'package:immich_mobile/domain/models/config/app_config.dart';
import 'package:immich_mobile/domain/models/space_album.model.dart';
import 'package:immich_mobile/domain/models/user.model.dart';
import 'package:immich_mobile/domain/services/user.service.dart';
import 'package:immich_mobile/models/albums/album_search.model.dart';
import 'package:immich_mobile/presentation/widgets/album/album_selector.widget.dart';
import 'package:immich_mobile/presentation/widgets/collection/collection_picker.widget.dart';
import 'package:immich_mobile/presentation/widgets/collection/space_collection_section.widget.dart';
import 'package:immich_mobile/presentation/widgets/album/album_selector.widget.dart';
import 'package:immich_mobile/providers/infrastructure/action.provider.dart';
import 'package:immich_mobile/providers/infrastructure/album.provider.dart';
import 'package:immich_mobile/providers/infrastructure/remote_album.provider.dart';
import 'package:immich_mobile/providers/infrastructure/settings.provider.dart';
import 'package:immich_mobile/providers/infrastructure/space_album.provider.dart';
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

/// Captures which [ActionSource] the picker dispatched against, and lets a test make the
/// dispatch fail, without standing up the real action plumbing.
class _RecordingActionNotifier extends ActionNotifier {
  _RecordingActionNotifier({this.succeeds = true});

  final bool succeeds;
  final List<ActionSource> albumSources = [];
  final List<ActionSource> spaceSources = [];
  final List<(ActionSource, String, String)> spaceAlbumDispatches = [];

  @override
  void build() {}

  @override
  Future<ActionResult> addToAlbum(ActionSource source, RemoteAlbum album) async {
    albumSources.add(source);
    return ActionResult(count: succeeds ? 1 : 0, success: succeeds);
  }

  @override
  Future<ActionResult> addToSpace(ActionSource source, SharedSpaceResponseDto space) async {
    spaceSources.add(source);
    return ActionResult(count: succeeds ? 1 : 0, success: succeeds);
  }

  @override
  Future<ActionResult> addToSpaceAlbum(ActionSource source, String spaceId, SpaceAlbum album) async {
    spaceAlbumDispatches.add((source, spaceId, album.id));
    return ActionResult(count: succeeds ? 1 : 0, success: succeeds);
  }
}

void main() {
  Future<void> pumpPicker(
    WidgetTester tester, {
    List<SharedSpaceResponseDto> spaces = const [],
    List<RemoteAsset> selection = const [],
  }) async {
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
        sharedSpacesProvider.overrideWith((ref) async => spaces),
        multiSelectProvider.overrideWith(
          () => MultiSelectNotifier(
            MultiSelectState(selectedAssets: selection.toSet(), lockedSelectionAssets: const {}),
          ),
        ),
      ],
    );
    await tester.pump();
  }

  SharedSpaceMemberResponseDto member(String userId, SharedSpaceRole role) => SharedSpaceMemberResponseDto(
    userId: userId,
    name: userId,
    email: '$userId@e.com',
    role: role,
    joinedAt: '2026-01-01T00:00:00Z',
    sharePersonMetadata: true,
    showInTimeline: true,
  );

  SharedSpaceResponseDto space(String id, String name, {int albums = 0}) => SharedSpaceResponseDto(
    id: id,
    name: name,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    createdById: 'someone-else',
    members: Optional.present([member('user-1', SharedSpaceRole.owner)]),
    albumCount: Optional.present(albums),
  );

  SpaceAlbum spaceAlbum(String id, String name) => SpaceAlbum(
    id: id,
    name: name,
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

  testWidgets('L1: spaces render above albums, and both below the search field', (tester) async {
    await pumpPicker(tester, spaces: [space('s1', 'Family')]);

    final searchY = tester.getTopLeft(find.byType(SearchField)).dy;
    final spacesY = tester.getTopLeft(find.byKey(const Key('space-collection-header'))).dy;
    final albumsY = tester.getTopLeft(find.byKey(const Key('collection-picker-albums-header'))).dy;

    expect(searchY, lessThan(spacesY));
    expect(spacesY, lessThan(albumsY));
  });

  testWidgets('L2: both section labels render when the user has writable spaces', (tester) async {
    await pumpPicker(tester, spaces: [space('s1', 'Family')]);

    expect(find.byKey(const Key('space-collection-header')), findsOneWidget);
    expect(find.byKey(const Key('collection-picker-albums-header')), findsOneWidget);
  });

  testWidgets('L3: neither label renders when the user has no writable spaces', (tester) async {
    await pumpPicker(tester, spaces: const []);

    expect(find.byKey(const Key('space-collection-header')), findsNothing);
    expect(find.byKey(const Key('collection-picker-albums-header')), findsNothing);
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

  testWidgets('L4: a query matching albums but no space collapses the section and both labels', (tester) async {
    await pumpPicker(tester, spaces: [space('s1', 'Family')]);

    await tester.enterText(find.byType(SearchField), 'zzz-no-space-matches');
    await tester.pump();

    // Intended: with only one section left, section labels are noise. Do not "fix" this.
    expect(find.byKey(const Key('space-collection-header')), findsNothing);
    expect(find.byKey(const Key('collection-picker-albums-header')), findsNothing);
  });

  testWidgets('L5: the notice path still renders the albums label', (tester) async {
    // A selection containing a non-owned asset drives the section's notice branch: header and
    // notice render, space rows do not — and albums still follow.
    await pumpPicker(
      tester,
      spaces: [space('s1', 'Family')],
      selection: [asset('a1', ownerId: 'someone-else')],
    );

    expect(find.byKey(const Key('space-collection-notice')), findsOneWidget);
    expect(find.byKey(const Key('space-row-s1')), findsNothing);
    expect(find.byKey(const Key('collection-picker-albums-header')), findsOneWidget);
  });

  testWidgets('L6: typing keeps the search field focused and narrows the spaces section', (tester) async {
    await pumpPicker(tester, spaces: [space('s1', 'Family'), space('s2', 'Holiday')]);

    // enterText focuses the field itself (it calls showKeyboard), so no explicit tap is needed --
    // and the focus assertion below is therefore NOT "did typing acquire focus" but "did focus
    // SURVIVE the rebuild that the keystroke triggered". That is the regression this task guards:
    // onSearchChanged -> setState -> AlbumSelector is handed a new child.
    await tester.enterText(find.byType(SearchField), 'Fam');
    await tester.pump();

    expect(find.byKey(const Key('space-row-s1')), findsOneWidget);
    expect(find.byKey(const Key('space-row-s2')), findsNothing);

    // Asserting only on the narrowed rows would pass even if every keystroke dropped focus.
    final editable = tester.widget<EditableText>(find.descendant(
      of: find.byType(SearchField),
      matching: find.byType(EditableText),
    ));
    expect(editable.focusNode.hasFocus, isTrue);
  });

  // #965: the same picker is now mounted from surfaces that have no timeline multiselect —
  // the asset viewer above all — so the source it dispatches against and the assets it
  // reasons about both have to be things the caller can state.
  group('mounted outside the timeline', () {
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

    RemoteAlbum personalAlbum() => RemoteAlbum(
      id: 'pa1',
      name: 'Personal',
      ownerId: 'user-1',
      ownerName: 'user-1',
      description: '',
      createdAt: DateTime(2026, 1, 1),
      updatedAt: DateTime(2026, 1, 1),
      isActivityEnabled: false,
      order: AlbumAssetOrder.desc,
      assetCount: 0,
      isShared: false,
    );

    Future<void> pumpPicker(
      WidgetTester tester, {
      required Widget picker,
      List<SharedSpaceResponseDto> spaces = const [],
      Map<String, List<SpaceAlbum>> spaceAlbums = const {},
      List<Override> extraOverrides = const [],
    }) async {
      final userService = _MockUserService();
      final user = UserStub.user1; // id: 'user-1'
      when(() => userService.tryGetMyUser()).thenReturn(user);
      when(() => userService.watchMyUser()).thenAnswer((_) => const Stream.empty());

      await tester.pumpConsumerWidgetRaw(
        CustomScrollView(slivers: [picker]),
        overrides: [
          currentUserProvider.overrideWith((ref) => _StubCurrentUserNotifier(userService, user)),
          remoteAlbumProvider.overrideWith(() => _StubRemoteAlbumNotifier()),
          appConfigProvider.overrideWithValue(const AppConfig()),
          sharedSpacesProvider.overrideWith((ref) async => spaces),
          multiSelectProvider.overrideWith(
            () => MultiSelectNotifier(const MultiSelectState(selectedAssets: {}, lockedSelectionAssets: {})),
          ),
          for (final entry in spaceAlbums.entries)
            spaceAlbumsProvider(entry.key).overrideWith((ref) => Stream.value(entry.value)),
          ...extraOverrides,
        ],
      );
      await tester.pump();
    }

    /// `ImmichToast` schedules a 3s fluttertoast Timer outside the frame scheduler, so a
    /// plain `pumpAndSettle()` leaves it pending and teardown fails with "A Timer is still
    /// pending". Pump past its lifetime instead.
    Future<void> tapSpaceRow(WidgetTester tester, String id) async {
      await tester.tap(find.byKey(Key('space-row-$id')));
      await tester.pumpAndSettle();
      await tester.pump(const Duration(seconds: 4));
      await tester.pumpAndSettle();
    }

    testWidgets('judges space targets by the assets it was given, not the empty multiselect', (tester) async {
      await pumpPicker(
        tester,
        picker: CollectionPicker(assets: [asset('a', ownerId: 'someone-else')]),
        spaces: [space('s1', 'Family')],
      );

      expect(find.byKey(const Key('space-row-s1')), findsNothing);
      expect(find.byKey(const Key('space-collection-notice')), findsOneWidget);
    });

    testWidgets('dispatches the space pool against the source it was given', (tester) async {
      final notifier = _RecordingActionNotifier();
      await pumpPicker(
        tester,
        picker: CollectionPicker(source: ActionSource.viewer, assets: [asset('a')]),
        spaces: [space('s1', 'Family')],
        extraOverrides: [actionProvider.overrideWith(() => notifier)],
      );

      await tapSpaceRow(tester, 's1');

      expect(notifier.spaceSources, [ActionSource.viewer]);
    });

    testWidgets('still defaults to the timeline source', (tester) async {
      final notifier = _RecordingActionNotifier();
      await pumpPicker(
        tester,
        picker: const CollectionPicker(),
        spaces: [space('s1', 'Family')],
        extraOverrides: [actionProvider.overrideWith(() => notifier)],
      );

      await tapSpaceRow(tester, 's1');

      expect(notifier.spaceSources, [ActionSource.timeline]);
    });

    testWidgets('reports completion only when the add succeeded', (tester) async {
      var completions = 0;
      final notifier = _RecordingActionNotifier(succeeds: true);
      await pumpPicker(
        tester,
        picker: CollectionPicker(onCompleted: () => completions++),
        spaces: [space('s1', 'Family')],
        extraOverrides: [actionProvider.overrideWith(() => notifier)],
      );

      await tapSpaceRow(tester, 's1');

      expect(completions, 1);
    });

    // The literal subject of #965: reaching an album *inside* a space. Nothing else in this
    // suite exercises `addToSpaceAlbum`, so without this the dispatch could break unnoticed.
    testWidgets('dispatches a space album with its source, owning space and album id', (tester) async {
      final notifier = _RecordingActionNotifier();
      await pumpPicker(
        tester,
        picker: CollectionPicker(source: ActionSource.viewer, assets: [asset('a')]),
        spaces: [space('s1', 'Family', albums: 1)],
        spaceAlbums: {
          's1': [spaceAlbum('sa1', 'Holiday')],
        },
        extraOverrides: [actionProvider.overrideWith(() => notifier)],
      );

      await tester.tap(find.byKey(const Key('space-row-s1'))); // expands, does not dispatch
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('space-album-child-sa1')));
      await tester.pumpAndSettle();
      await tester.pump(const Duration(seconds: 4));
      await tester.pumpAndSettle();

      expect(notifier.spaceAlbumDispatches, [(ActionSource.viewer, 's1', 'sa1')]);
      expect(notifier.spaceSources, isEmpty, reason: 'an album child must not hit the space pool');
    });

    // `_addToAlbum` is reached through `AlbumSelector`'s callback. Driving it at that seam keeps
    // the test off upstream's list rendering while still running the fork's own dispatch: a
    // regression to a hard-coded `timeline` source here would make the asset viewer a silent
    // no-op, because the sheet's multiselect is empty.
    testWidgets('dispatches a personal album against the source it was given', (tester) async {
      final notifier = _RecordingActionNotifier();
      var completions = 0;
      await pumpPicker(
        tester,
        picker: CollectionPicker(source: ActionSource.viewer, assets: [asset('a')], onCompleted: () => completions++),
        extraOverrides: [actionProvider.overrideWith(() => notifier)],
      );

      // The callback is void-returning (fire-and-forget), so pump for the dispatch instead.
      tester.widget<AlbumSelector>(find.byType(AlbumSelector)).onAlbumSelected(personalAlbum());
      await tester.pumpAndSettle();
      await tester.pump(const Duration(seconds: 4));
      await tester.pumpAndSettle();

      expect(notifier.albumSources, [ActionSource.viewer]);
      expect(completions, 1);
    });

    testWidgets('does not report completion when the add failed', (tester) async {
      var completions = 0;
      final notifier = _RecordingActionNotifier(succeeds: false);
      await pumpPicker(
        tester,
        picker: CollectionPicker(onCompleted: () => completions++),
        spaces: [space('s1', 'Family')],
        extraOverrides: [actionProvider.overrideWith(() => notifier)],
      );

      await tapSpaceRow(tester, 's1');

      expect(completions, 0, reason: 'the sheet must stay open so the user can retry');
    });
  });
}
