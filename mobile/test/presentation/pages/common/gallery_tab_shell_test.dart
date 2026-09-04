import 'dart:async';

import 'package:auto_route/auto_route.dart';
import 'package:easy_localization/easy_localization.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/constants/locales.dart';
import 'package:immich_mobile/domain/models/config/app_config.dart';
import 'package:immich_mobile/domain/models/config/nav_config.dart';
import 'package:immich_mobile/generated/codegen_loader.g.dart';
import 'package:immich_mobile/presentation/widgets/gallery_nav/gallery_bottom_nav.widget.dart';
import 'package:immich_mobile/providers/gallery_nav/gallery_tab_enum.dart';
import 'package:immich_mobile/providers/infrastructure/readonly_mode.provider.dart';
import 'package:immich_mobile/providers/infrastructure/settings.provider.dart';
import 'package:immich_mobile/routing/auth_guard.dart';
import 'package:immich_mobile/routing/duplicate_guard.dart';
import 'package:immich_mobile/routing/router.dart';
import 'package:immich_mobile/services/api.service.dart';
import 'package:immich_mobile/services/auth.service.dart';
import 'package:immich_mobile/services/local_auth.service.dart';
import 'package:immich_mobile/services/secure_storage.service.dart';
import 'package:mocktail/mocktail.dart';

class _MockApiService extends Mock implements ApiService {}

class _MockAuthService extends Mock implements AuthService {}

class _MockSecureStorageService extends Mock implements SecureStorageService {}

class _MockLocalAuthService extends Mock implements LocalAuthService {}

/// [ReadOnlyModeNotifier] replacement that short-circuits the build-time read of
/// `appSettingsServiceProvider` (same shape as the sibling fake in
/// `gallery_bottom_nav_test.dart`). [GalleryBottomNav] watches this on every
/// build, so the shell cannot be pumped without it.
class _FakeReadonly extends ReadOnlyModeNotifier {
  @override
  bool build() => false;

  @override
  void setMode(bool value) {}

  @override
  void setReadonlyMode(bool isEnabled) {}

  @override
  void toggleReadonlyMode() {}
}

/// The four tab pages `GalleryTabShellRoute` declares as children in
/// `AppRouter`. `_harnessRouter` re-declares them under the SAME names with
/// cheap stand-ins (see its doc comment), and
/// `'the harness mirrors AppRouter's tab-child declaration'` pins the two
/// lists together so the stand-ins can never drift from production.
const _tabRouteNames = ['MainTimelineRoute', 'AlbumsRoute', 'SpacesRoute', 'LibraryRoute'];

/// A stand-in for a tab page, keyed by the route name that built it.
Widget _tabStub(String routeName) => Scaffold(key: Key('tab-$routeName'), body: const SizedBox.shrink());

/// A router whose `GalleryTabShellRoute` subtree mirrors `AppRouter`'s, but
/// whose tab children are [_tabStub]s rather than the real pages.
///
/// Why not `AppRouter` itself: the real tab pages reach far past routing on
/// their first build. `DriftAlbumsPage`'s `ImmichSliverAppBar` alone watches
/// `castProvider`, `multiSelectProvider`, `currentUserProvider`,
/// `serverInfoProvider`, `driftBackupProvider` and `syncStatusProvider`, and
/// `MainTimelinePage` — which `AutoTabsRouter` builds eagerly, since slot 0 is
/// the initially active tab and is rebuilt from scratch on every routes-list
/// swap — pulls in the whole timeline stack. Standing those up would make this
/// an auth/server fixture rather than a routing test, and every one of those
/// fixtures would be load-bearing for assertions that are purely about WHICH
/// route sits in WHICH slot.
///
/// What the stand-ins give up is the `SpacesRoute` -> `SpacesPage` mapping,
/// which is generated code (`router.gr.dart`), plus the production child
/// declaration — covered directly by the `AppRouter` tests at the bottom of
/// this file.
///
/// `CreateAlbumRoute` is declared top-level, exactly as in `AppRouter`:
/// each tab child is a LEAF `AutoRoute` with no `children:`, so a push from a
/// tab resolves against the top-level declarations and covers the whole shell.
RootStackRouter _harnessRouter() => RootStackRouter.build(
  routes: [
    AutoRoute(
      initial: true,
      page: GalleryTabShellRoute.page,
      children: [for (final name in _tabRouteNames) AutoRoute(page: PageInfo(name, builder: (_) => _tabStub(name)))],
    ),
    AutoRoute(
      page: PageInfo(
        CreateAlbumRoute.name,
        builder: (_) => const Scaffold(key: Key('pushed-over-shell'), body: SizedBox.shrink()),
      ),
    ),
  ],
);

List<Override> _overrides({required bool showSpaces}) => [
  appConfigProvider.overrideWithValue(AppConfig(nav: NavConfig(showSpaces: showSpaces))),
  readonlyModeProvider.overrideWith(_FakeReadonly.new),
];

/// Anything below the shell's `AutoTabsRouter`; [GalleryBottomNav] is built
/// inside its `builder`, so its element resolves the tabs router scope.
TabsRouter _tabsRouter(WidgetTester tester) => AutoTabsRouter.of(tester.element(find.byType(GalleryBottomNav)));

/// The route names occupying the shell's three nav slots, in slot order.
List<String> currentTabRoutes(WidgetTester tester) =>
    _tabsRouter(tester).stack.map((page) => page.routeData.name).toList();

int activeIndex(WidgetTester tester) => _tabsRouter(tester).activeIndex;

/// The route the shell's [TabsRouter] considers active. Router state only: it
/// reads the controller, never the rendered widget, so it could not by itself
/// catch an [IndexedStack] displaying a different slot.
///
/// What actually pins the pixels is the paired `find.byKey(Key('tab-<name>'))`
/// assertion at each call site. That finder is meaningful — not merely
/// "somewhere in the stack" — because a changed `routes:` list gives
/// `AutoTabsRouter` a new `tabsHash`, which makes `_IndexedStackBuilder`
/// clear `_initializedPagesTracker` and re-run `_setup()`; with `lazyLoad`
/// (default true) that marks ONLY the active index as initialized, so every
/// other slot renders a `SizedBox.shrink()` placeholder. After a flip, the tab
/// stub the finder locates is necessarily the one on screen.
String activeTabRoute(WidgetTester tester) => currentTabRoutes(tester)[activeIndex(tester)];

Future<void> activateIndex(WidgetTester tester, int index) async {
  _tabsRouter(tester).setActiveIndex(index);
  await tester.pumpAndSettle();
}

class TabShellHarness {
  final ProviderContainer container;
  final RootStackRouter router;
  const TabShellHarness(this.container, this.router);
}

Future<TabShellHarness> pumpShell(WidgetTester tester, {required bool showSpaces}) async {
  final container = ProviderContainer(overrides: _overrides(showSpaces: showSpaces));
  addTearDown(container.dispose);
  final router = _harnessRouter();

  await tester.pumpWidget(
    EasyLocalization(
      supportedLocales: locales.values.toList(),
      path: translationsPath,
      startLocale: locales.values.first,
      fallbackLocale: locales.values.first,
      saveLocale: false,
      useFallbackTranslations: true,
      assetLoader: const CodegenLoader(),
      child: UncontrolledProviderScope(
        container: container,
        child: Builder(
          builder: (context) => MaterialApp.router(
            debugShowCheckedModeBanner: false,
            routerConfig: router.config(),
            localizationsDelegates: context.localizationDelegates,
            supportedLocales: context.supportedLocales,
            locale: context.locale,
          ),
        ),
      ),
    ),
  );
  await tester.pumpAndSettle();
  return TabShellHarness(container, router);
}

/// Flips `SettingsKey.navShowSpaces` the way the Preferences switch does: by
/// republishing `appConfigProvider`, which `galleryNavSlotsProvider` watches.
Future<void> setShowSpaces(WidgetTester tester, TabShellHarness harness, bool showSpaces) async {
  harness.container.updateOverrides(_overrides(showSpaces: showSpaces));
  await tester.pumpAndSettle();
}

/// `push` resolves only when the pushed route is popped, so it is deliberately
/// not awaited (same reasoning as `space_albums_page_test.dart`).
Future<void> pushOverShell(WidgetTester tester, TabShellHarness harness, PageRouteInfo route) async {
  unawaited(harness.router.push(route));
  await tester.pumpAndSettle();
}

Future<void> popRoute(WidgetTester tester, TabShellHarness harness) async {
  await harness.router.maybePop();
  await tester.pumpAndSettle();
}

void main() {
  testWidgets('slot 1 routes to Spaces when the setting is on', (tester) async {
    await pumpShell(tester, showSpaces: true);

    expect(currentTabRoutes(tester), ['MainTimelineRoute', 'SpacesRoute', 'LibraryRoute']);
  });

  testWidgets('slot 1 routes to Albums when the setting is off', (tester) async {
    await pumpShell(tester, showSpaces: false);

    expect(currentTabRoutes(tester), ['MainTimelineRoute', 'AlbumsRoute', 'LibraryRoute']);
  });

  testWidgets('galleryTabProvider reports the slot occupant, not the slot name', (tester) async {
    final harness = await pumpShell(tester, showSpaces: true);

    await activateIndex(tester, kGalleryCollectionIndex);

    expect(harness.container.read(galleryTabProvider), GalleryTabEnum.spaces);
  });

  testWidgets('flipping the setting while standing on slot 1 keeps the index and swaps the page', (tester) async {
    final harness = await pumpShell(tester, showSpaces: true);
    await activateIndex(tester, kGalleryCollectionIndex);
    expect(find.byKey(const Key('tab-SpacesRoute')), findsOneWidget);

    await setShowSpaces(tester, harness, false);

    expect(tester.takeException(), isNull);
    expect(activeIndex(tester), kGalleryCollectionIndex);
    expect(activeTabRoute(tester), 'AlbumsRoute');
    expect(find.byKey(const Key('tab-AlbumsRoute')), findsOneWidget);
    expect(find.byKey(const Key('tab-SpacesRoute')), findsNothing);
    // The latent half of the same bug: the router index did not move, so an
    // index-deduped sync would leave this reporting the OUTGOING occupant.
    expect(harness.container.read(galleryTabProvider), GalleryTabEnum.albums);
  });

  testWidgets('flipping the setting on while standing on slot 1 does the reverse', (tester) async {
    final harness = await pumpShell(tester, showSpaces: false);
    await activateIndex(tester, kGalleryCollectionIndex);
    expect(find.byKey(const Key('tab-AlbumsRoute')), findsOneWidget);

    await setShowSpaces(tester, harness, true);

    expect(tester.takeException(), isNull);
    expect(activeIndex(tester), kGalleryCollectionIndex);
    expect(activeTabRoute(tester), 'SpacesRoute');
    expect(find.byKey(const Key('tab-SpacesRoute')), findsOneWidget);
    expect(harness.container.read(galleryTabProvider), GalleryTabEnum.spaces);
  });

  testWidgets('a flip that happens while a pushed page covers the shell lands correctly on pop', (tester) async {
    final harness = await pumpShell(tester, showSpaces: false);
    await activateIndex(tester, kGalleryCollectionIndex);
    expect(find.byKey(const Key('tab-AlbumsRoute')), findsOneWidget);

    await pushOverShell(tester, harness, const CreateAlbumRoute());
    expect(find.byKey(const Key('pushed-over-shell')), findsOneWidget);

    await setShowSpaces(tester, harness, true);
    await popRoute(tester, harness);

    expect(tester.takeException(), isNull);
    expect(activeIndex(tester), kGalleryCollectionIndex);
    expect(activeTabRoute(tester), 'SpacesRoute');
    expect(find.byKey(const Key('tab-SpacesRoute')), findsOneWidget);
  });

  testWidgets('the tabs the shell can host stay put when the flip lands on another slot', (tester) async {
    final harness = await pumpShell(tester, showSpaces: true);
    await activateIndex(tester, kGalleryLibraryIndex);

    await setShowSpaces(tester, harness, false);

    expect(tester.takeException(), isNull);
    expect(activeIndex(tester), kGalleryLibraryIndex);
    expect(activeTabRoute(tester), 'LibraryRoute');
    expect(harness.container.read(galleryTabProvider), GalleryTabEnum.library);
  });

  group('AppRouter', () {
    late AppRouter router;

    setUp(() {
      // The guards only stash their dependencies at construction time, so mocks
      // are enough to read the route table back (see routing/router_test.dart).
      router = AppRouter(_MockApiService(), _MockAuthService(), _MockSecureStorageService(), _MockLocalAuthService());
    });

    List<AutoRoute> shellChildren() =>
        router.routes.firstWhere((route) => route.name == GalleryTabShellRoute.name).children!;

    // The shell's `routes:` list picks three of four declared children per the
    // user's preference. A slot pointing at a route the shell does not declare
    // as a child is unresolvable at runtime — which is what makes the Spaces
    // declaration load-bearing rather than decorative.
    test('GalleryTabShellRoute declares every tab page the nav can put in a slot', () {
      expect(shellChildren().map((route) => route.name), unorderedEquals(_tabRouteNames));
    });

    // Slot 1's occupant is user-configurable, so Spaces has to arrive under the
    // shell with the same protection its siblings have — an unguarded tab would
    // render for a signed-out user, and would re-push itself on a double tap.
    test('every shell tab child carries the auth and duplicate guards', () {
      for (final child in shellChildren()) {
        expect(child.guards.whereType<AuthGuard>(), hasLength(1), reason: '${child.name} should carry _authGuard');
        expect(
          child.guards.whereType<DuplicateGuard>(),
          hasLength(1),
          reason: '${child.name} should carry _duplicateGuard',
        );
      }
    });

    test('the harness mirrors AppRouter\'s tab-child declaration', () {
      final harnessChildren = _harnessRouter().routes
          .firstWhere((route) => route.name == GalleryTabShellRoute.name)
          .children!
          .map((route) => route.name);

      expect(harnessChildren, unorderedEquals(shellChildren().map((route) => route.name)));
    });
  });
}
