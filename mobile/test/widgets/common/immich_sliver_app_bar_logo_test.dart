import 'package:drift/drift.dart' as drift;
import 'package:drift/native.dart';
import 'package:flutter/material.dart';
import 'package:flutter_svg/svg.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/data/db/main/database.dart';
import 'package:immich_mobile/domain/models/asset/base_asset.model.dart';
import 'package:immich_mobile/domain/models/settings_key.dart';
import 'package:immich_mobile/domain/models/store.model.dart';
import 'package:immich_mobile/domain/models/user.model.dart';
import 'package:immich_mobile/domain/services/store.service.dart';
import 'package:immich_mobile/domain/services/user.service.dart';
import 'package:immich_mobile/entities/store.entity.dart';
import 'package:immich_mobile/infrastructure/repositories/settings.repository.dart';
import 'package:immich_mobile/infrastructure/repositories/store.repository.dart';
import 'package:immich_mobile/models/cast/cast_manager_state.dart';
import 'package:immich_mobile/presentation/pages/dev/main_timeline.page.dart';
import 'package:immich_mobile/providers/cast.provider.dart';
import 'package:immich_mobile/providers/infrastructure/db.provider.dart';
import 'package:immich_mobile/providers/infrastructure/user.provider.dart' as infra;
import 'package:immich_mobile/providers/photos_filter/photos_filter.provider.dart';
import 'package:immich_mobile/providers/sync_status.provider.dart';
import 'package:immich_mobile/providers/user.provider.dart';
import 'package:immich_mobile/services/server_info.service.dart';
import 'package:immich_mobile/widgets/common/immich_sliver_app_bar.dart';
import 'package:mocktail/mocktail.dart';
import '../../test_utils.dart';
import '../../widget_tester_extensions.dart';

class _MockUserService extends Mock implements UserService {}

class _MockServerInfoService extends Mock implements ServerInfoService {}

class _StubCurrentUserNotifier extends CurrentUserProvider {
  _StubCurrentUserNotifier(super.service, UserDto user) {
    state = user;
  }
}

/// A signed-in user, so the profile action renders the 34 px avatar it does in production
/// rather than the narrower signed-out placeholder — the app bar's widest trailing widget.
final _testUser = UserDto(
  id: 'test-user-1',
  email: 'test@example.com',
  name: 'Test User',
  profileChangedAt: DateTime(2024, 1, 1),
);

/// The real [CastNotifier] wires itself to [GCastService] on construction, which is not
/// available under test. The app bar only ever reads `isCasting`.
class _StubCastNotifier extends StateNotifier<CastManagerState> implements CastNotifier {
  _StubCastNotifier()
    : super(
        const CastManagerState(
          isCasting: false,
          receiverName: '',
          castState: CastState.idle,
          currentTime: Duration.zero,
          duration: Duration.zero,
        ),
      );

  @override
  List<(String, CastDestinationType, dynamic)> discovered = const [];

  @override
  Future<void> connect(CastDestinationType type, device) async {}

  @override
  Future<void> disconnect() async {}

  @override
  Future<List<(String, CastDestinationType, dynamic)>> getDevices() async => discovered;

  @override
  void loadMedia(RemoteAsset asset, bool reload) {}

  @override
  void pause() {}

  @override
  void play() {}

  @override
  void seekTo(Duration position) {}

  @override
  void stop() {}

  @override
  void toggle() {}
}

void main() {
  late Drift db;

  setUpAll(() async {
    TestWidgetsFlutterBinding.ensureInitialized();
    TestUtils.init();
    db = Drift(drift.DatabaseConnection(NativeDatabase.memory(), closeStreamsSynchronously: true));
    await StoreService.init(storeRepository: StoreRepository(db), listenUpdates: false);
    await SettingsRepository.ensureInitialized(db);
  });

  setUp(() async {
    await Store.clear();
    await Store.put(StoreKey.serverEndpoint, 'http://localhost:0');
    await SettingsRepository.instance.clear(SettingsKey.values);
  });

  tearDownAll(() async {
    await Store.clear();
    await db.close();
  });

  // #1030: AppBar measures its actions first and hands the title only what is left
  // (`maxWidth = barWidth - trailingWidth - 2 * titleSpacing`). The logo is a BoxFit.contain
  // SvgPicture, so it silently absorbed the difference and changed size as the sync spinner
  // and the sort button came and went. These are the two phone widths the fix has to hold at:
  // the iPhone 14/15 class and the Galaxy S / budget-Android class.
  const phoneWidths = <double>[390, 360];

  /// Builds a fresh app bar at [width], optionally with a search running and a sync in flight.
  ///
  /// Each call drops the previous tree first: the sync line keeps a `Ticker` running and
  /// Riverpod keeps its container, so re-pumping the same widget shape would otherwise carry
  /// the previous state into the next measurement.
  Future<void> pumpAppBar(
    WidgetTester tester, {
    required double width,
    List<Widget>? actions,
    bool busy = false,
  }) async {
    await tester.pumpWidget(const SizedBox());

    final userService = _MockUserService();
    when(userService.tryGetMyUser).thenReturn(_testUser);
    when(userService.watchMyUser).thenAnswer((_) => Stream.value(_testUser));

    await tester.binding.setSurfaceSize(Size(width, 800));
    await tester.pumpConsumerWidget(
      CustomScrollView(
        slivers: [
          ImmichSliverAppBar(actions: actions),
          const SliverToBoxAdapter(child: SizedBox(height: 1200)),
        ],
      ),
      overrides: [
        castProvider.overrideWith((ref) => _StubCastNotifier()),
        driftProvider.overrideWithValue(db),
        infra.userServiceProvider.overrideWithValue(userService),
        currentUserProvider.overrideWith((ref) => _StubCurrentUserNotifier(userService, _testUser)),
        serverInfoServiceProvider.overrideWithValue(_MockServerInfoService()),
      ],
    );

    if (busy) {
      final container = ProviderScope.containerOf(tester.element(find.byType(ImmichSliverAppBar)));
      container.read(photosFilterProvider.notifier).setText('beach');
      container.read(syncStatusProvider.notifier).startRemoteSync();
      // The sync line animates for as long as it is visible, so the tree never settles once
      // syncing starts; pump fixed frames instead of waiting for quiescence.
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 400));
    }
  }

  Future<Size> measureLogo(
    WidgetTester tester, {
    required double width,
    List<Widget>? actions,
    bool busy = false,
  }) async {
    await pumpAppBar(tester, width: width, actions: actions, busy: busy);
    return tester.getSize(find.byType(SvgPicture));
  }

  group('ImmichSliverAppBar logo', () {
    testWidgets('renders at its design size even with every action on screen', (tester) async {
      addTearDown(() => tester.binding.setSurfaceSize(null));

      // A bar with room to spare renders the logo at the size it was designed at; that is the
      // size every phone should get, because BoxFit.contain can only ever scale it down.
      final designSize = await measureLogo(tester, width: 1024);
      // Guards the comparison below against passing on a degenerate measurement.
      expect(designSize.width, greaterThan(100), reason: 'the design size itself looks wrong');

      for (final width in phoneWidths) {
        final busy = await measureLogo(tester, width: width, actions: PhotosTimelineAppBar.actions, busy: true);

        expect(busy, designSize, reason: 'at ${width}dp the action row squeezed the logo below its design size');
      }
    });

    testWidgets('does not resize when the sync indicator and sort join the bar', (tester) async {
      addTearDown(() => tester.binding.setSurfaceSize(null));

      for (final width in phoneWidths) {
        final quiet = await measureLogo(tester, width: width, actions: PhotosTimelineAppBar.actions);
        final busy = await measureLogo(tester, width: width, actions: PhotosTimelineAppBar.actions, busy: true);

        expect(busy, quiet, reason: 'at ${width}dp the logo changed size between browsing and searching-while-syncing');
      }
    });
  });

  group('ImmichSliverAppBar sync progress', () {
    const progressLine = Key('app-bar-sync-progress');

    testWidgets('shows a line along the bottom edge while syncing, and nothing otherwise', (tester) async {
      addTearDown(() => tester.binding.setSurfaceSize(null));

      await pumpAppBar(tester, width: 390, actions: PhotosTimelineAppBar.actions);
      expect(find.byKey(progressLine), findsNothing, reason: 'idle bars carry no progress line');

      await pumpAppBar(tester, width: 390, actions: PhotosTimelineAppBar.actions, busy: true);
      expect(find.byKey(progressLine), findsOneWidget);

      // It has to sit on the bar's bottom edge, not float over the toolbar contents.
      final bar = tester.getRect(find.byType(AppBar));
      final line = tester.getRect(find.byKey(progressLine));
      expect(line.bottom, closeTo(bar.bottom, 0.5));
      expect(line.width, closeTo(bar.width, 0.5));
      expect(line.height, lessThanOrEqualTo(4), reason: 'a hairline, not a band');
    });

    testWidgets('costs the actions row no width, so nothing beside it moves', (tester) async {
      addTearDown(() => tester.binding.setSurfaceSize(null));

      await pumpAppBar(tester, width: 390, actions: PhotosTimelineAppBar.actions);
      final chipWhenIdle = tester.getRect(find.byKey(const Key('timeline-grouping-compact-selector')));

      await pumpAppBar(tester, width: 390, actions: PhotosTimelineAppBar.actions, busy: true);
      final chipWhenSyncing = tester.getRect(find.byKey(const Key('timeline-grouping-compact-selector')));

      expect(
        chipWhenSyncing,
        chipWhenIdle,
        reason: 'a sync must not shift the actions row — that is what used to squeeze the logo',
      );
    });
  });
}
