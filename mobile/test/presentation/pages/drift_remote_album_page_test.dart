import 'dart:async';

import 'package:drift/drift.dart' as drift;
import 'package:drift/native.dart';
import 'package:easy_localization/easy_localization.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/data/db/main/database.dart';
import 'package:immich_mobile/domain/models/album/album.model.dart';
import 'package:immich_mobile/domain/models/asset/base_asset.model.dart';
import 'package:immich_mobile/domain/models/settings_key.dart';
import 'package:immich_mobile/domain/models/store.model.dart';
import 'package:immich_mobile/domain/models/timeline.model.dart';
import 'package:immich_mobile/domain/models/timeline_temporal_scope.model.dart';
import 'package:immich_mobile/domain/models/user.model.dart';
import 'package:immich_mobile/domain/services/remote_album.service.dart';
import 'package:immich_mobile/domain/services/store.service.dart';
import 'package:immich_mobile/domain/services/timeline.service.dart';
import 'package:immich_mobile/domain/services/user.service.dart';
import 'package:immich_mobile/entities/store.entity.dart';
import 'package:immich_mobile/infrastructure/repositories/settings.repository.dart';
import 'package:immich_mobile/infrastructure/repositories/store.repository.dart';
import 'package:immich_mobile/presentation/pages/drift_remote_album.page.dart';
import 'package:immich_mobile/presentation/widgets/remote_album/drift_album_option.widget.dart';
import 'package:immich_mobile/presentation/widgets/timeline/timeline_grouping_bottom_pill.widget.dart';
import 'package:immich_mobile/providers/infrastructure/album.provider.dart';
import 'package:immich_mobile/providers/infrastructure/timeline.provider.dart';
import 'package:immich_mobile/providers/infrastructure/user.provider.dart' as infra;
import 'package:immich_mobile/providers/user.provider.dart';
import 'package:intl/date_symbol_data_local.dart';
import 'package:mocktail/mocktail.dart';
// easy_localization initializes shared_preferences internally; tests need the mock initializer.
// ignore: depend_on_referenced_packages
import 'package:shared_preferences/shared_preferences.dart';
import 'package:timezone/data/latest.dart';

import '../../test_utils.dart';
import '../../widget_tester_extensions.dart';

class _MockTimelineFactory extends Mock implements TimelineFactory {}

class _MockRemoteAlbumService extends Mock implements RemoteAlbumService {}

class _MockUserService extends Mock implements UserService {}

class _StubCurrentUserNotifier extends CurrentUserProvider {
  _StubCurrentUserNotifier(super.service, UserDto user) {
    state = user;
  }
}

class _NullCurrentUserNotifier extends CurrentUserProvider {
  _NullCurrentUserNotifier(super.service) {
    state = null;
  }
}

UserDto _user(String id) => UserDto(id: id, email: '$id@example.com', name: id, profileChangedAt: DateTime(2024));

RemoteAlbum _albumFixture(String ownerId) => RemoteAlbum(
  id: 'album-1',
  name: 'Test Album',
  ownerId: ownerId,
  description: '',
  createdAt: DateTime(2026, 1, 1),
  updatedAt: DateTime(2026, 1, 1),
  isActivityEnabled: false,
  order: AlbumAssetOrder.desc,
  assetCount: 72,
  ownerName: 'Test User',
  isShared: false,
);

TimelineService _service(List<Bucket> buckets) {
  final assets = <BaseAsset>[
    for (var i = 0; i < buckets.fold<int>(0, (total, bucket) => total + bucket.assetCount); i++)
      TestUtils.createRemoteAsset(id: 'asset-$i'),
  ];

  return TimelineService((
    bucketSource: () => Stream.value(buckets),
    assetSource: (offset, count) async {
      final end = (offset + count).clamp(0, assets.length);
      if (offset >= end) {
        return const <BaseAsset>[];
      }
      return assets.sublist(offset, end);
    },
    origin: TimelineOrigin.remoteAlbum,
  ));
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  late Drift db;

  setUpAll(() async {
    TestUtils.init();
    SharedPreferences.setMockInitialValues({});
    await EasyLocalization.ensureInitialized();
    await initializeDateFormatting('en');
    initializeTimeZones();
    registerFallbackValue(const TimelineTemporalScope.none());
    registerFallbackValue(GroupAssetsBy.day);
    db = Drift(drift.DatabaseConnection(NativeDatabase.memory(), closeStreamsSynchronously: true));
    await StoreService.init(storeRepository: StoreRepository(db), listenUpdates: false);
    await SettingsRepository.ensureInitialized(db);
  });

  setUp(() async {
    await Store.clear();
    await Store.put(StoreKey.serverEndpoint, 'http://test-server');
    await SettingsRepository.instance.write(SettingsKey.timelineTilesPerRow, 3);
  });

  tearDownAll(() async {
    await Store.clear();
    await db.close();
  });

  // 6 day buckets × 12 assets each = 72 assets — enough content to scroll past
  // the viewport and verify the pill persists.
  final buckets = [
    TimeBucket(date: DateTime(2026, 6, 1), assetCount: 12),
    TimeBucket(date: DateTime(2026, 5, 1), assetCount: 12),
    TimeBucket(date: DateTime(2026, 4, 1), assetCount: 12),
    TimeBucket(date: DateTime(2026, 3, 1), assetCount: 12),
    TimeBucket(date: DateTime(2026, 2, 1), assetCount: 12),
    TimeBucket(date: DateTime(2026, 1, 1), assetCount: 12),
  ];

  Future<_MockRemoteAlbumService> pumpAlbumPage(
    WidgetTester tester, {
    String ownerId = 'user-1',
    AlbumUserRole role = AlbumUserRole.viewer,
    Completer<AlbumUserRole?>? roleCompleter,
    bool noCurrentUser = false,
  }) async {
    final user = _user('user-1');
    final album = _albumFixture(ownerId);

    final albumService = _MockRemoteAlbumService();
    // watchAlbum: return a stream that emits the album then closes.
    when(() => albumService.watchAlbum(any())).thenAnswer((_) => Stream.value(album));
    // watchDateRange: emit one range then close. Upstream #29008 turned this from a
    // Future (getDateRange) into a Stream, so the stub has to emit rather than resolve.
    when(
      () => albumService.watchDateRange(any()),
    ).thenAnswer((_) => Stream.value((DateTime(2026, 1, 1), DateTime(2026, 6, 1))));
    // getSharedUsers: empty list (no shared users icons).
    when(() => albumService.getSharedUsers(any())).thenAnswer((_) async => <UserDto>[]);
    // An unresolved completer lets a test observe the pending state of the role lookup.
    when(() => albumService.getUserRole(any(), any())).thenAnswer((_) => roleCompleter?.future ?? Future.value(role));
    when(
      () => albumService.updateAlbum(
        any(),
        name: any(named: 'name'),
        description: any(named: 'description'),
        createdAt: any(named: 'createdAt'),
      ),
    ).thenAnswer((_) async => album);

    final factory = _MockTimelineFactory();
    final service = _service(buckets);
    addTearDown(service.dispose);
    when(
      () => factory.remoteAlbum(
        albumId: any(named: 'albumId'),
        groupBy: any(named: 'groupBy'),
        temporalScope: any(named: 'temporalScope'),
      ),
    ).thenReturn(service);

    final userService = _MockUserService();
    when(() => userService.tryGetMyUser()).thenReturn(noCurrentUser ? null : user);
    when(() => userService.watchMyUser()).thenAnswer((_) => const Stream<UserDto?>.empty());

    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          timelineFactoryProvider.overrideWithValue(factory),
          remoteAlbumServiceProvider.overrideWithValue(albumService),
          infra.userServiceProvider.overrideWithValue(userService),
          currentUserProvider.overrideWith(
            (ref) =>
                noCurrentUser ? _NullCurrentUserNotifier(userService) : _StubCurrentUserNotifier(userService, user),
          ),
          timelineUsersProvider.overrideWith((_) => Stream<List<String>>.value([user.id])),
        ],
        child: EasyLocalization(
          supportedLocales: const [Locale('en')],
          path: '../i18n',
          fallbackLocale: const Locale('en'),
          child: MaterialApp(home: withStubRouter(RemoteAlbumPage(album: album))),
        ),
      ),
    );
    // The app bar has a continuously-running zoom-pan background animation.
    // pumpAndSettle times out on it; pump explicit frames instead.
    // 3 frames → microtasks flush, stream emits, Riverpod rebuilds, segments render.
    await tester.pump();
    await tester.pump();
    await tester.pump();
    // Let the slide-in animation complete and layout settle.
    await tester.pump(const Duration(milliseconds: 100));
    await tester.pump(const Duration(milliseconds: 500));
    await tester.pump(const Duration(milliseconds: 500));

    return albumService;
  }

  DriftRemoteAlbumOption albumOption(WidgetTester tester) =>
      tester.widget<DriftRemoteAlbumOption>(find.byType(DriftRemoteAlbumOption));

  Future<void> openEditDialog(WidgetTester tester) async {
    albumOption(tester).onEditAlbum!();
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 300));
  }

  /// Opens the created-at picker (assumes the edit dialog is open and its date is still the
  /// fixture's original 2026-01-01) and drives it to day 12 of the same month, leaving the time
  /// untouched. Confirms both the calendar and the outer date/time picker.
  ///
  /// Flutter's built-in calendar/time pickers ('12', 'OK') use MaterialLocalizations, which
  /// resolves independently of this app's own i18n loader — reliable here. The picker's own
  /// Cancel/Update buttons go through that app i18n loader, which this harness does not
  /// reliably finish loading in time, so those two are targeted by position instead of text.
  Future<void> pickCreatedAtDay12(WidgetTester tester) async {
    await tester.tap(find.byKey(const Key('album-edit-created-at')));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 300));

    final originalPickerTile = DateFormat("dd-MM-yyyy hh:mm a").format(DateTime(2026, 1, 1));
    await tester.tap(find.text(originalPickerTile));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 300));

    await tester.tap(find.text('12').last);
    await tester.pump();
    await tester.tap(find.text('OK').last);
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 300));

    // Confirm the time picker with the unchanged time.
    await tester.tap(find.text('OK').last);
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 300));

    // Confirm the outer date/time picker (Update is the second action button).
    final dateTimePickerActions = find.descendant(of: find.byType(AlertDialog), matching: find.byType(TextButton));
    expect(dateTimePickerActions, findsNWidgets(2));
    await tester.tap(dateTimePickerActions.at(1));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 300));
  }

  testWidgets('grouping selector stays visible after scrolling deep (bottom pill)', (tester) async {
    await pumpAlbumPage(tester);

    // Selector visible at top.
    expect(find.byKey(const Key('timeline-grouping-selector')), findsOneWidget);

    // Scroll far down — jump to max to guarantee we hit bottom.
    final scrollable = tester.state<ScrollableState>(find.byType(Scrollable).first);
    scrollable.position.jumpTo(scrollable.position.maxScrollExtent);
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 300));

    // THE regression guard: still visible (was RED with the scrolls-away header).
    expect(find.byKey(const Key('timeline-grouping-selector')), findsOneWidget);
    expect(find.byKey(const Key('timeline-grouping-bottom-pill')), findsOneWidget);
  });

  testWidgets('header sliver is gone from the album page', (tester) async {
    await pumpAlbumPage(tester);
    expect(find.byKey(const Key('timeline-grouping-header-sliver')), findsNothing);
  });

  testWidgets('last-row reachability: bottom-most tile is above the pill top edge', (tester) async {
    await pumpAlbumPage(tester);

    // Scroll to maxScrollExtent.
    final scrollable = tester.state<ScrollableState>(find.byType(Scrollable).first);
    scrollable.position.jumpTo(scrollable.position.maxScrollExtent);
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 300));

    // The pill must still be visible.
    final pillFinder = find.byKey(const Key('timeline-grouping-bottom-pill'));
    expect(pillFinder, findsOneWidget);

    // Overlap-free clearance, page-level: the pill occupies exactly its reserved 84px
    // band (pillHeight 58 + bottomFloat 26) at the bottom of the REAL page, and Slice 2's
    // Timeline tests prove the scroll extent grows by that same 84px — so at
    // maxScrollExtent the last content row ends at the pill's top edge. This catches a
    // page-level wrapper (extra SafeArea/padding) shifting the pill out of its band.
    final screenHeight = tester.view.physicalSize.height / tester.view.devicePixelRatio;
    final pillRect = tester.getRect(pillFinder);
    const float = TimelineGroupingBottomPill.bottomFloat;
    const band = TimelineGroupingBottomPill.pillHeight + TimelineGroupingBottomPill.bottomFloat;
    expect(pillRect.bottom, closeTo(screenHeight - float, 1)); // floats bottomFloat above the edge
    expect(pillRect.top, closeTo(screenHeight - band, 1)); // top of the reserved clearance band
  });

  testWidgets('owner gets the edit album affordance', (tester) async {
    await pumpAlbumPage(tester, ownerId: 'user-1');

    expect(albumOption(tester).onEditAlbum, isNotNull);
  });

  testWidgets('editor gets the edit album affordance', (tester) async {
    await pumpAlbumPage(tester, ownerId: 'someone-else', role: AlbumUserRole.editor);

    expect(albumOption(tester).onEditAlbum, isNotNull);
  });

  testWidgets('viewer does not get the edit album affordance', (tester) async {
    await pumpAlbumPage(tester, ownerId: 'someone-else', role: AlbumUserRole.viewer);

    expect(albumOption(tester).onEditAlbum, isNull);
  });

  testWidgets('edit album affordance is withheld while the role is still resolving', (tester) async {
    final completer = Completer<AlbumUserRole?>();
    await pumpAlbumPage(tester, ownerId: 'someone-else', roleCompleter: completer);

    // FutureBuilder default is `snapshot.data ?? false` — fail closed, matching onAddPhotos.
    expect(albumOption(tester).onEditAlbum, isNull);

    completer.complete(AlbumUserRole.editor);
    await tester.pump();
    await tester.pump();

    expect(albumOption(tester).onEditAlbum, isNotNull);
  });

  testWidgets('edit dialog shows the album created date', (tester) async {
    await pumpAlbumPage(tester, ownerId: 'user-1');
    await openEditDialog(tester);

    expect(find.byKey(const Key('album-edit-created-at')), findsOneWidget);
    // _albumFixture pins createdAt to 2026-01-01; DateFormat.yMMMd() renders "Jan 1, 2026".
    expect(find.text(DateFormat.yMMMd().format(DateTime(2026, 1, 1))), findsOneWidget);
  });

  testWidgets('saving without touching the date keeps the original created date', (tester) async {
    final albumService = await pumpAlbumPage(tester, ownerId: 'user-1');
    await openEditDialog(tester);

    await tester.tap(find.byKey(const Key('album-edit-save')));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 300));

    verify(
      () => albumService.updateAlbum(
        'album-1',
        name: 'Test Album',
        description: any(named: 'description'),
        createdAt: DateTime(2026, 1, 1),
      ),
    ).called(1);
  });

  testWidgets('edit album affordance is hidden when there is no current user', (tester) async {
    await pumpAlbumPage(tester, ownerId: 'user-1', noCurrentUser: true);

    expect(albumOption(tester).onEditAlbum, isNull);
  });

  testWidgets('picking a new date updates the tile in local time and is sent on save', (tester) async {
    final albumService = await pumpAlbumPage(tester, ownerId: 'user-1');
    await openEditDialog(tester);

    // Picks day 12 of the same month via the created-at row's picker; leaves the time untouched.
    await pickCreatedAtDay12(tester);

    // The picker always encodes the machine's own offset for the picked wall-clock time
    // (see _getInitiationLocation), so round-tripping through DateTime.parse(...).toLocal()
    // must land exactly back on the wall-clock day/time the user picked — Jan 12, 2026,
    // midnight — regardless of what the host machine's timezone actually is.
    final expected = DateTime(2026, 1, 12);
    expect(find.text(DateFormat.yMMMd().format(expected)), findsOneWidget);

    await tester.tap(find.byKey(const Key('album-edit-save')));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 300));

    final captured =
        verify(
              () => albumService.updateAlbum(
                'album-1',
                name: 'Test Album',
                description: any(named: 'description'),
                createdAt: captureAny(named: 'createdAt'),
              ),
            ).captured.single
            as DateTime;

    expect(captured.isAtSameMomentAs(expected), isTrue);
    // Discriminates the bug regardless of the host's timezone offset: DateTime.parse of an
    // offset-bearing string is always UTC-flagged; only .toLocal() clears the flag.
    expect(captured.isUtc, isFalse);
  });

  testWidgets('dismissing the date/time picker leaves the pending date unchanged and Save resends the original', (
    tester,
  ) async {
    final albumService = await pumpAlbumPage(tester, ownerId: 'user-1');
    await openEditDialog(tester);

    await tester.tap(find.byKey(const Key('album-edit-created-at')));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 300));

    // Dismiss the picker without picking anything. Target by position rather than the
    // (possibly untranslated, see the sibling test) Cancel label — Cancel is the first action.
    final dateTimePickerActions = find.descendant(of: find.byType(AlertDialog), matching: find.byType(TextButton));
    expect(dateTimePickerActions, findsNWidgets(2));
    await tester.tap(dateTimePickerActions.at(0));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 300));

    // The tile still shows the original date — the picked==null branch returned early.
    expect(find.text(DateFormat.yMMMd().format(DateTime(2026, 1, 1))), findsOneWidget);

    await tester.tap(find.byKey(const Key('album-edit-save')));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 300));

    verify(
      () => albumService.updateAlbum(
        'album-1',
        name: 'Test Album',
        description: any(named: 'description'),
        createdAt: DateTime(2026, 1, 1),
      ),
    ).called(1);
  });

  testWidgets('a second edit in the same session opens on the just-saved date, not the stale original', (tester) async {
    await pumpAlbumPage(tester, ownerId: 'user-1');
    await openEditDialog(tester);

    // Pick day 12, then save — the page's own _album state must pick up the new date, not just
    // the server/mock.
    await pickCreatedAtDay12(tester);
    await tester.tap(find.byKey(const Key('album-edit-save')));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 300));

    // Re-open the edit dialog for a second, unrelated edit (e.g. fixing a title typo).
    await openEditDialog(tester);

    // It must seed from the date just saved (Jan 12), not the stale pre-edit value (Jan 1) —
    // otherwise this second, unrelated edit would silently resend the old date on save.
    expect(find.text(DateFormat.yMMMd().format(DateTime(2026, 1, 12))), findsOneWidget);
    expect(find.text(DateFormat.yMMMd().format(DateTime(2026, 1, 1))), findsNothing);
  });
}
