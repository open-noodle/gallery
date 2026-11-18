import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/domain/models/config/app_config.dart';
import 'package:immich_mobile/domain/models/config/nav_config.dart';
import 'package:immich_mobile/domain/models/events.model.dart';
import 'package:immich_mobile/domain/utils/event_stream.dart';
import 'package:immich_mobile/gallery/dock/gallery_dock.widget.dart';
import 'package:immich_mobile/gallery/dock/gallery_dock_style.dart';
import 'package:immich_mobile/gallery/search/search_mode.provider.dart';
import 'package:immich_mobile/generated/translations.g.dart';
import 'package:immich_mobile/presentation/widgets/gallery_nav/gallery_bottom_nav.widget.dart';
import 'package:immich_mobile/providers/gallery_nav/bottom_nav_height.provider.dart';
import 'package:immich_mobile/providers/gallery_nav/gallery_tab_enum.dart';
import 'package:immich_mobile/providers/haptic_feedback.provider.dart';
import 'package:immich_mobile/providers/infrastructure/album.provider.dart';
import 'package:immich_mobile/providers/infrastructure/readonly_mode.provider.dart';
import 'package:immich_mobile/providers/infrastructure/remote_album.provider.dart';
import 'package:immich_mobile/providers/infrastructure/settings.provider.dart';
import 'package:immich_mobile/providers/shared_space.provider.dart';

import '../../../test_helpers/fake_tabs_router.dart';
import '../../../widget_tester_extensions.dart';

/// ReadOnlyModeNotifier replacement that short-circuits the build-time read of
/// appSettingsServiceProvider.
class _FakeReadonly extends ReadOnlyModeNotifier {
  final bool v;
  _FakeReadonly(this.v);
  @override
  bool build() => v;
  @override
  void setMode(bool value) {}
  @override
  void setReadonlyMode(bool isEnabled) {}
  @override
  void toggleReadonlyMode() {}
}

/// HapticNotifier stub that doesn't read appSettingsServiceProvider.
class _NoOpHaptic extends HapticNotifier {
  _NoOpHaptic(super.ref);
  @override
  dynamic selectionClick() => null;
  @override
  dynamic mediumImpact() => null;
  @override
  dynamic heavyImpact() => null;
}

class _FakeRemoteAlbumNotifier extends RemoteAlbumNotifier {
  int refreshCalls = 0;

  @override
  RemoteAlbumState build() => const RemoteAlbumState(albums: []);

  @override
  Future<void> refresh() async {
    refreshCalls++;
  }
}

/// Default portrait MediaQueryData (400x900) so tests exercise the dock branch.
/// Tests that need landscape or other viewInsets pass their own `mq`.
const _portraitMq = MediaQueryData(size: Size(400, 900));

/// Pins the nav configuration for a test. The nav now derives its slots from
/// `appConfigProvider`, which without an override reaches for the
/// uninitialized `SettingsRepository.instance` and throws — so every test in
/// this file needs one. `overrideWithValue` on a directly-constructed
/// `AppConfig` is the pattern the rest of the repo uses (e.g.
/// collection_picker_test.dart).
///
/// Top-level rather than a local inside `main` so `_wrap` can reuse it;
/// `no_leading_underscores_for_local_identifiers` only covers locals.
List<Override> _navOverrides({required bool showSpaces}) => [
  appConfigProvider.overrideWithValue(AppConfig(nav: NavConfig(showSpaces: showSpaces))),
  serverSupportsSpacesProvider.overrideWithValue(true),
];

Widget _wrap(Widget child, {List<Override> overrides = const [], MediaQueryData? mq}) {
  return ProviderScope(
    overrides: [
      readonlyModeProvider.overrideWith(() => _FakeReadonly(false)),
      hapticFeedbackProvider.overrideWith((ref) => _NoOpHaptic(ref)),
      // Albums in slot 1 by default: the assertions predating the Spaces slot
      // are written against that configuration. A caller-supplied override
      // comes later in the list and wins.
      ..._navOverrides(showSpaces: false),
      ...overrides,
    ],
    child: MaterialApp(
      home: MediaQuery(
        data: mq ?? _portraitMq,
        child: Material(child: child),
      ),
    ),
  );
}

void main() {
  testWidgets('portrait: the dock renders its tab bar and search slot', (tester) async {
    final router = FakeTabsRouter();
    await tester.pumpWidget(localizedForTest(_wrap(GalleryBottomNav(tabsRouter: router))));
    await tester.pumpAndSettle();
    expect(find.byType(GalleryDock), findsOneWidget);
    expect(find.byKey(const Key('gallery-dock-tabs')), findsOneWidget);
    expect(find.byKey(const Key('gallery-dock-search')), findsOneWidget);
  });

  testWidgets('multi-select event hides nav (opacity→0)', (tester) async {
    final router = FakeTabsRouter();
    await tester.pumpWidget(localizedForTest(_wrap(GalleryBottomNav(tabsRouter: router))));
    await tester.pumpAndSettle();

    EventStream.shared.emit(const MultiSelectToggleEvent(true));
    await tester.pumpAndSettle();

    final opacity = tester.widget<AnimatedOpacity>(find.byKey(const Key('gallery-bottom-nav-opacity')));
    expect(opacity.opacity, 0);

    // Restore for clean teardown.
    EventStream.shared.emit(const MultiSelectToggleEvent(false));
    await tester.pumpAndSettle();
  });

  testWidgets('hide animation completion writes bottomNavHeightProvider=0', (tester) async {
    final router = FakeTabsRouter();
    final container = ProviderContainer(
      overrides: [
        readonlyModeProvider.overrideWith(() => _FakeReadonly(false)),
        hapticFeedbackProvider.overrideWith((ref) => _NoOpHaptic(ref)),
        ..._navOverrides(showSpaces: false),
      ],
    );
    addTearDown(container.dispose);

    await tester.pumpWidget(
      localizedForTest(
        UncontrolledProviderScope(
          container: container,
          child: MaterialApp(
            home: MediaQuery(
              data: _portraitMq,
              child: Material(child: GalleryBottomNav(tabsRouter: router)),
            ),
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();
    final shownHeight = container.read(bottomNavHeightProvider);
    expect(shownHeight, greaterThan(0));

    EventStream.shared.emit(const MultiSelectToggleEvent(true));
    await tester.pumpAndSettle();
    expect(container.read(bottomNavHeightProvider), 0, reason: 'onEnd writes 0 after hide completes');

    // Restore.
    EventStream.shared.emit(const MultiSelectToggleEvent(false));
    await tester.pumpAndSettle();
  });

  testWidgets('keyboard-up: hides above 80pt threshold, shows at 79pt', (tester) async {
    final router = FakeTabsRouter();

    await tester.pumpWidget(
      localizedForTest(
        _wrap(
          GalleryBottomNav(tabsRouter: router),
          mq: const MediaQueryData(size: Size(400, 900), viewInsets: EdgeInsets.only(bottom: 79)),
        ),
      ),
    );
    await tester.pumpAndSettle();
    var opacity = tester.widget<AnimatedOpacity>(find.byKey(const Key('gallery-bottom-nav-opacity')));
    expect(opacity.opacity, 1, reason: 'at 79pt, still shown');

    await tester.pumpWidget(
      localizedForTest(
        _wrap(
          GalleryBottomNav(tabsRouter: router),
          mq: const MediaQueryData(size: Size(400, 900), viewInsets: EdgeInsets.only(bottom: 81)),
        ),
      ),
    );
    await tester.pumpAndSettle();
    opacity = tester.widget<AnimatedOpacity>(find.byKey(const Key('gallery-bottom-nav-opacity')));
    expect(opacity.opacity, 0, reason: 'at 81pt, hidden');
  });

  testWidgets('landscape: NavigationRail with 3 destinations + trailing search', (tester) async {
    final router = FakeTabsRouter();
    await tester.pumpWidget(
      localizedForTest(
        _wrap(
          GalleryBottomNav(tabsRouter: router),
          mq: const MediaQueryData(size: Size(900, 400)),
        ),
      ),
    );
    await tester.pumpAndSettle();
    expect(find.byType(GalleryDock), findsNothing);
    expect(find.byKey(const Key('gallery-bottom-nav-rail')), findsOneWidget);
    final rail = tester.widget<NavigationRail>(find.byKey(const Key('gallery-bottom-nav-rail')));
    expect(rail.destinations, hasLength(3));
    expect(find.byKey(const Key('gallery-bottom-nav-rail-search')), findsOneWidget);
  });

  testWidgets('readonly: search disabled, the dock dims Albums+Library, Photos enabled', (tester) async {
    final router = FakeTabsRouter();
    await tester.pumpWidget(
      localizedForTest(
        _wrap(
          GalleryBottomNav(tabsRouter: router),
          overrides: [readonlyModeProvider.overrideWith(() => _FakeReadonly(true))],
        ),
      ),
    );
    await tester.pumpAndSettle();

    final dock = tester.widget<GalleryDock>(find.byType(GalleryDock));
    expect(dock.disabledTabs, containsAll({GalleryTabEnum.albums, GalleryTabEnum.library}));
    expect(dock.disabledTabs.contains(GalleryTabEnum.photos), isFalse);
    expect(dock.searchEnabled, isFalse);
  });

  testWidgets('publishes height to bottomNavHeightProvider when shown', (tester) async {
    final router = FakeTabsRouter();
    final container = ProviderContainer(
      overrides: [
        readonlyModeProvider.overrideWith(() => _FakeReadonly(false)),
        hapticFeedbackProvider.overrideWith((ref) => _NoOpHaptic(ref)),
        ..._navOverrides(showSpaces: false),
      ],
    );
    addTearDown(container.dispose);

    await tester.pumpWidget(
      localizedForTest(
        UncontrolledProviderScope(
          container: container,
          child: MaterialApp(
            home: MediaQuery(
              data: _portraitMq,
              child: Material(child: GalleryBottomNav(tabsRouter: router)),
            ),
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();
    expect(container.read(bottomNavHeightProvider), greaterThan(0));
  });

  // iOS: 34 safe area less 14, down inside the home-indicator area as iOS's own tab bar sits. Android: above the safe
  // area, out of the zone where a swipe up is the system's home gesture.
  for (final (platform, float) in [(TargetPlatform.iOS, 20.0), (TargetPlatform.android, 34.0)]) {
    testWidgets('${platform.name}: the dock floats $float above the bottom with a 34 safe area', (tester) async {
      tester.view.devicePixelRatio = 1;
      tester.view.physicalSize = const Size(430, 932);
      addTearDown(() {
        tester.view.resetDevicePixelRatio();
        tester.view.resetPhysicalSize();
      });

      final router = FakeTabsRouter();
      final container = ProviderContainer(
        overrides: [
          readonlyModeProvider.overrideWith(() => _FakeReadonly(false)),
          hapticFeedbackProvider.overrideWith((ref) => _NoOpHaptic(ref)),
          ..._navOverrides(showSpaces: false),
        ],
      );
      addTearDown(container.dispose);

      await tester.pumpWidget(
        localizedForTest(
          UncontrolledProviderScope(
            container: container,
            child: MaterialApp(
              theme: ThemeData(platform: platform),
              home: MediaQuery(
                data: const MediaQueryData(
                  size: Size(430, 932),
                  padding: EdgeInsets.only(bottom: 34),
                  textScaler: TextScaler.linear(0.45),
                ),
                child: Scaffold(bottomNavigationBar: GalleryBottomNav(tabsRouter: router)),
              ),
            ),
          ),
        ),
      );
      await tester.pumpAndSettle();

      // Photos: the float plus the dock's unfolded height (tab bar, gap, grouping row).
      expect(container.read(bottomNavHeightProvider), float + GalleryDock.reservedHeight(showGrouping: true));
      expect(tester.getRect(find.byKey(const Key('gallery-dock-tabs'))).bottom, 932 - float);
    });
  }

  testWidgets('narrow phone: the whole cluster stays inside the screen (#909)', (tester) async {
    tester.view.devicePixelRatio = 1;
    tester.view.physicalSize = const Size(360, 800);
    addTearDown(() {
      tester.view.resetDevicePixelRatio();
      tester.view.resetPhysicalSize();
    });

    final router = FakeTabsRouter();
    await tester.pumpWidget(
      localizedForTest(
        _wrap(
          GalleryBottomNav(tabsRouter: router),
          mq: const MediaQueryData(size: Size(360, 800)),
        ),
      ),
    );
    await tester.pumpAndSettle();

    final tabs = tester.getRect(find.byKey(const Key('gallery-dock-tabs')));
    final search = tester.getRect(find.byKey(const Key('gallery-dock-search')));

    expect(tabs.left, greaterThanOrEqualTo(0), reason: 'the tab bar must not run off the left edge');
    expect(tabs.right, lessThanOrEqualTo(360), reason: 'the tab bar must not run off the right edge');
    expect(search.right, lessThanOrEqualTo(tabs.right), reason: 'search keeps its slot inside the bar');
    expect(tester.takeException(), isNull, reason: 'long labels shrink instead of overflowing');
  });

  testWidgets('roomy screen: the dock spans the width between the side gutters', (tester) async {
    tester.view.devicePixelRatio = 1;
    tester.view.physicalSize = const Size(1024, 800);
    addTearDown(() {
      tester.view.resetDevicePixelRatio();
      tester.view.resetPhysicalSize();
    });

    final router = FakeTabsRouter();
    await tester.pumpWidget(
      localizedForTest(
        _wrap(
          GalleryBottomNav(tabsRouter: router),
          // Portrait MediaQuery so the dock branch is exercised, not the rail.
          mq: const MediaQueryData(size: Size(1024, 1400)),
        ),
      ),
    );
    await tester.pumpAndSettle();

    final tabs = tester.getRect(find.byKey(const Key('gallery-dock-tabs')));
    expect(tabs.left, GalleryDockStyle.sideInset);
    expect(tabs.right, 1024 - GalleryDockStyle.sideInset);
  });

  testWidgets('Photos search keeps the dock: the tab circle and the grouping row on the bottom edge', (tester) async {
    final router = FakeTabsRouter(initialIndex: GalleryTabEnum.photos.index);
    final container = ProviderContainer(
      overrides: [
        readonlyModeProvider.overrideWith(() => _FakeReadonly(false)),
        hapticFeedbackProvider.overrideWith((ref) => _NoOpHaptic(ref)),
        ..._navOverrides(showSpaces: false),
      ],
    );
    addTearDown(container.dispose);

    await tester.pumpWidget(
      localizedForTest(
        UncontrolledProviderScope(
          container: container,
          child: MaterialApp(
            home: MediaQuery(
              data: _portraitMq,
              child: Scaffold(bottomNavigationBar: GalleryBottomNav(tabsRouter: router)),
            ),
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();
    container.read(searchModeProvider.notifier).enter();
    await tester.pumpAndSettle();

    final dock = tester.widget<GalleryDock>(find.byType(GalleryDock));
    expect(dock.mode, GalleryDockMode.search);
    final opacity = tester.widget<AnimatedOpacity>(find.byKey(const Key('gallery-bottom-nav-opacity')));
    expect(opacity.opacity, 1, reason: 'search mode no longer hides the nav');
    final tabs = tester.getRect(find.byKey(const Key('gallery-dock-tabs')));
    final grouping = tester.getRect(find.byKey(const Key('gallery-dock-grouping')));
    expect(grouping.bottom, tabs.bottom);
    expect(grouping.left, greaterThan(tabs.right));
  });

  testWidgets('narrow phone: the search blob is still tappable (#909)', (tester) async {
    tester.view.devicePixelRatio = 1;
    tester.view.physicalSize = const Size(360, 800);
    addTearDown(() {
      tester.view.resetDevicePixelRatio();
      tester.view.resetPhysicalSize();
    });

    final router = FakeTabsRouter(initialIndex: GalleryTabEnum.photos.index);
    final container = ProviderContainer(
      overrides: [
        readonlyModeProvider.overrideWith(() => _FakeReadonly(false)),
        hapticFeedbackProvider.overrideWith((ref) => _NoOpHaptic(ref)),
        ..._navOverrides(showSpaces: false),
      ],
    );
    addTearDown(container.dispose);

    await tester.pumpWidget(
      localizedForTest(
        UncontrolledProviderScope(
          container: container,
          child: MaterialApp(
            home: MediaQuery(
              data: const MediaQueryData(size: Size(360, 800)),
              child: Material(child: GalleryBottomNav(tabsRouter: router)),
            ),
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();

    await tester.tap(find.byKey(const Key('gallery-dock-search')));
    await tester.pumpAndSettle();

    expect(container.read(searchModeProvider), isTrue);
  });

  testWidgets('re-tap Photos (already active): emits ScrollToTopEvent', (tester) async {
    final router = FakeTabsRouter(initialIndex: GalleryTabEnum.photos.index);
    int scrollEvents = 0;
    final sub = EventStream.shared.listen<ScrollToTopEvent>((_) => scrollEvents++);
    addTearDown(sub.cancel);

    await tester.pumpWidget(localizedForTest(_wrap(GalleryBottomNav(tabsRouter: router))));
    await tester.pumpAndSettle();

    await tester.tap(find.text(StaticTranslations.instance.nav_photos));
    await tester.pumpAndSettle();

    expect(scrollEvents, 1);
  });

  testWidgets('tapping a different tab calls tabsRouter.setActiveIndex', (tester) async {
    final router = FakeTabsRouter(initialIndex: GalleryTabEnum.photos.index);
    await tester.pumpWidget(
      localizedForTest(
        _wrap(
          GalleryBottomNav(tabsRouter: router),
          overrides: [remoteAlbumProvider.overrideWith(_FakeRemoteAlbumNotifier.new)],
        ),
      ),
    );
    await tester.pumpAndSettle();

    await tester.tap(find.text(StaticTranslations.instance.nav_albums));
    await tester.pumpAndSettle();

    expect(router.setCalls, contains(GalleryTabEnum.albums.index));
  });

  testWidgets('tapping Library calls setActiveIndex with the slot index, not GalleryTabEnum.index', (tester) async {
    // Regression: GalleryTabEnum.library.index is 3 (declaration order), but
    // the shell only registers 3 routes (slots 0-2). Albums-only coverage
    // above can't catch this — GalleryTabEnum.albums.index (1) still
    // coincides with its slot. Library is the one tab whose enum index and
    // slot index now diverge.
    final router = FakeTabsRouter(initialIndex: GalleryTabEnum.photos.index);
    await tester.pumpWidget(
      localizedForTest(
        _wrap(
          GalleryBottomNav(tabsRouter: router),
          overrides: [remoteAlbumProvider.overrideWith(_FakeRemoteAlbumNotifier.new)],
        ),
      ),
    );
    await tester.pumpAndSettle();

    await tester.tap(find.text(StaticTranslations.instance.nav_library));
    await tester.pumpAndSettle();

    expect(router.setCalls, [2]);
  });

  testWidgets('tapping Albums refreshes the existing album provider', (tester) async {
    final router = FakeTabsRouter(initialIndex: GalleryTabEnum.photos.index);
    final remoteAlbumNotifier = _FakeRemoteAlbumNotifier();
    await tester.pumpWidget(
      localizedForTest(
        _wrap(
          GalleryBottomNav(tabsRouter: router),
          overrides: [remoteAlbumProvider.overrideWith(() => remoteAlbumNotifier)],
        ),
      ),
    );
    await tester.pumpAndSettle();

    await tester.tap(find.text(StaticTranslations.instance.nav_albums));
    await tester.pumpAndSettle();

    expect(remoteAlbumNotifier.refreshCalls, 1);
  });

  testWidgets('readonly landscape rail: Photos destination enabled, others disabled', (tester) async {
    final router = FakeTabsRouter();
    await tester.pumpWidget(
      localizedForTest(
        _wrap(
          GalleryBottomNav(tabsRouter: router),
          overrides: [readonlyModeProvider.overrideWith(() => _FakeReadonly(true))],
          mq: const MediaQueryData(size: Size(900, 400)),
        ),
      ),
    );
    await tester.pumpAndSettle();

    final rail = tester.widget<NavigationRail>(find.byKey(const Key('gallery-bottom-nav-rail')));
    // `destinations` is indexed by SLOT, so every lookup here resolves through
    // the slot list — `GalleryTabEnum.index` happens to coincide for Photos and
    // Albums, but never for Library, and would silently stop coinciding for the
    // others if the enum's declaration order changed.
    final slots = galleryNavSlots(showSpaces: false);
    expect(rail.destinations[slots.indexOf(GalleryTabEnum.photos)].disabled, isFalse);
    expect(rail.destinations[slots.indexOf(GalleryTabEnum.albums)].disabled, isTrue);
    expect(rail.destinations[slots.indexOf(GalleryTabEnum.library)].disabled, isTrue);
  });

  testWidgets('with Spaces on, the dock renders a Spaces tab and no Albums tab', (tester) async {
    final router = FakeTabsRouter();
    await tester.pumpWidget(
      localizedForTest(_wrap(GalleryBottomNav(tabsRouter: router), overrides: _navOverrides(showSpaces: true))),
    );
    await tester.pumpAndSettle();

    expect(find.byKey(const Key('gallery-dock-tab-spaces')), findsOneWidget);
    expect(find.byKey(const Key('gallery-dock-tab-albums')), findsNothing);
  });

  testWidgets('with Spaces off, the dock renders an Albums tab and no Spaces tab', (tester) async {
    final router = FakeTabsRouter();
    await tester.pumpWidget(
      localizedForTest(_wrap(GalleryBottomNav(tabsRouter: router), overrides: _navOverrides(showSpaces: false))),
    );
    await tester.pumpAndSettle();

    expect(find.byKey(const Key('gallery-dock-tab-albums')), findsOneWidget);
    expect(find.byKey(const Key('gallery-dock-tab-spaces')), findsNothing);
  });

  testWidgets('tapping the Spaces tab activates slot 1 and does not refresh albums', (tester) async {
    final router = FakeTabsRouter();
    final albums = _FakeRemoteAlbumNotifier();

    await tester.pumpWidget(
      localizedForTest(
        _wrap(
          GalleryBottomNav(tabsRouter: router),
          overrides: [..._navOverrides(showSpaces: true), remoteAlbumProvider.overrideWith(() => albums)],
        ),
      ),
    );
    await tester.pumpAndSettle();

    await tester.tap(find.byKey(const Key('gallery-dock-tab-spaces')));
    await tester.pumpAndSettle();

    expect(router.setCalls, [1]);
    expect(albums.refreshCalls, 0, reason: 'the albums tab is not on screen');
  });

  testWidgets('tapping the Spaces tab refreshes the spaces list', (tester) async {
    // The Spaces mirror of 'tapping Albums refreshes the existing album
    // provider'. Without it, dropping the invalidation back to a bare `break;`
    // leaves the whole nav suite green.
    final router = FakeTabsRouter();
    var spacesBuilds = 0;
    final container = ProviderContainer(
      overrides: [
        readonlyModeProvider.overrideWith(() => _FakeReadonly(false)),
        hapticFeedbackProvider.overrideWith((ref) => _NoOpHaptic(ref)),
        ..._navOverrides(showSpaces: true),
        sharedSpacesProvider.overrideWith((ref) async {
          spacesBuilds++;
          return const [];
        }),
      ],
    );
    addTearDown(container.dispose);

    // Listen the way the Spaces page does: invalidating a provider nobody
    // listens to is a no-op no assertion could observe.
    final sub = container.listen(sharedSpacesProvider, (_, _) {});
    addTearDown(sub.close);

    await tester.pumpWidget(
      localizedForTest(
        UncontrolledProviderScope(
          container: container,
          child: MaterialApp(
            home: MediaQuery(
              data: _portraitMq,
              child: Material(child: GalleryBottomNav(tabsRouter: router)),
            ),
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();
    expect(spacesBuilds, 1, reason: 'built once for the listener');

    await tester.tap(find.byKey(const Key('gallery-dock-tab-spaces')));
    await tester.pumpAndSettle();

    expect(spacesBuilds, 2, reason: 'the tap invalidates sharedSpacesProvider, which rebuilds for its listener');
  });

  testWidgets('tapping the Albums tab still refreshes albums', (tester) async {
    final router = FakeTabsRouter();
    final albums = _FakeRemoteAlbumNotifier();

    await tester.pumpWidget(
      localizedForTest(
        _wrap(
          GalleryBottomNav(tabsRouter: router),
          overrides: [..._navOverrides(showSpaces: false), remoteAlbumProvider.overrideWith(() => albums)],
        ),
      ),
    );
    await tester.pumpAndSettle();

    await tester.tap(find.byKey(const Key('gallery-dock-tab-albums')));
    await tester.pumpAndSettle();

    expect(router.setCalls, [1]);
    expect(albums.refreshCalls, 1);
  });

  testWidgets('readonly mode disables slot 1 whichever tab occupies it', (tester) async {
    final router = FakeTabsRouter();

    await tester.pumpWidget(
      localizedForTest(
        _wrap(
          GalleryBottomNav(tabsRouter: router),
          overrides: [..._navOverrides(showSpaces: true), readonlyModeProvider.overrideWith(() => _FakeReadonly(true))],
        ),
      ),
    );
    await tester.pumpAndSettle();

    final dock = tester.widget<GalleryDock>(find.byType(GalleryDock));
    expect(dock.disabledTabs, {GalleryTabEnum.spaces, GalleryTabEnum.library});
  });

  testWidgets('the landscape rail follows the same slots', (tester) async {
    final router = FakeTabsRouter();

    await tester.pumpWidget(
      localizedForTest(
        _wrap(
          GalleryBottomNav(tabsRouter: router),
          overrides: _navOverrides(showSpaces: true),
          mq: const MediaQueryData(size: Size(900, 400)),
        ),
      ),
    );
    await tester.pumpAndSettle();

    final rail = tester.widget<NavigationRail>(find.byKey(const Key('gallery-bottom-nav-rail')));
    expect(rail.destinations, hasLength(3));
    // Raw keys, not translations: this harness has no EasyLocalization above
    // it, so `tr()` returns the key — same convention as the taps above.
    expect(find.text(StaticTranslations.instance.spaces), findsOneWidget);
    expect(find.text(StaticTranslations.instance.nav_albums), findsNothing);
  });

  testWidgets('the active segment follows the slot occupant after a flip', (tester) async {
    final router = FakeTabsRouter(initialIndex: 1);
    final container = ProviderContainer(
      overrides: [
        readonlyModeProvider.overrideWith(() => _FakeReadonly(false)),
        hapticFeedbackProvider.overrideWith((ref) => _NoOpHaptic(ref)),
        ..._navOverrides(showSpaces: true),
      ],
    );
    addTearDown(container.dispose);

    await tester.pumpWidget(
      localizedForTest(
        UncontrolledProviderScope(
          container: container,
          child: MaterialApp(
            home: MediaQuery(
              data: _portraitMq,
              child: Material(child: GalleryBottomNav(tabsRouter: router)),
            ),
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();

    var dock = tester.widget<GalleryDock>(find.byType(GalleryDock));
    expect(dock.activeTab, GalleryTabEnum.spaces);

    container.updateOverrides([
      readonlyModeProvider.overrideWith(() => _FakeReadonly(false)),
      hapticFeedbackProvider.overrideWith((ref) => _NoOpHaptic(ref)),
      ..._navOverrides(showSpaces: false),
    ]);
    await tester.pumpAndSettle();

    dock = tester.widget<GalleryDock>(find.byType(GalleryDock));
    expect(dock.activeTab, GalleryTabEnum.albums, reason: 'slot 1 changed occupant, the index did not');
    expect(dock.slots, [GalleryTabEnum.photos, GalleryTabEnum.albums, GalleryTabEnum.library]);
  });
}
