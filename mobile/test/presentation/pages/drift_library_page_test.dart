import 'package:auto_route/auto_route.dart';
import 'package:easy_localization/easy_localization.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/constants/locales.dart';
import 'package:immich_mobile/generated/codegen_loader.g.dart';
import 'package:immich_mobile/presentation/pages/drift_library.page.dart';
import 'package:immich_mobile/providers/infrastructure/album.provider.dart';
import 'package:immich_mobile/providers/infrastructure/remote_album.provider.dart';
import 'package:immich_mobile/routing/router.dart';

/// [RemoteAlbumNotifier] stub: the card only reads `state.albums` (for up to
/// four thumbnails), and an empty list keeps the test off the network.
class _FakeRemoteAlbumNotifier extends RemoteAlbumNotifier {
  @override
  RemoteAlbumState build() => const RemoteAlbumState(albums: []);
}

/// A router that hosts [AlbumsCollectionCard] and re-declares
/// `DriftAlbumsRoute` under its production NAME with a cheap stand-in, so the
/// push can be observed without standing up the real albums page (whose
/// `ImmichSliverAppBar` alone pulls in cast/multi-select/user/server/backup/sync
/// state). Same technique as `gallery_tab_shell_test.dart`'s `_harnessRouter`.
RootStackRouter _harnessRouter() => RootStackRouter.build(
  routes: [
    AutoRoute(
      initial: true,
      page: PageInfo(
        'LibraryHostRoute',
        builder: (_) => const Scaffold(body: Center(child: AlbumsCollectionCard())),
      ),
    ),
    AutoRoute(
      page: PageInfo(
        DriftAlbumsRoute.name,
        builder: (_) => const Scaffold(key: Key('albums-page'), body: SizedBox.shrink()),
      ),
    ),
  ],
);

void main() {
  // With Spaces occupying the middle nav slot by default, this card is the only
  // route to the albums list for anyone who leaves the setting on — and the
  // sole destination the `setting_nav_show_spaces_subtitle` copy promises
  // ("Albums stays available from the Library tab").
  testWidgets('the Library tab\'s Albums card still routes to the albums page', (tester) async {
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
        child: ProviderScope(
          overrides: [remoteAlbumProvider.overrideWith(_FakeRemoteAlbumNotifier.new)],
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

    expect(find.byKey(const Key('library-albums-card')), findsOneWidget);
    expect(find.byKey(const Key('albums-page')), findsNothing);

    // Tapped on the card's LABEL, not its centre. The card's `GestureDetector`
    // is `deferToChild` (the default) and nothing inside the artwork square
    // absorbs pointer events — the gradient is a `DecoratedBox`, the grid is a
    // non-scrollable `GridView`, the tiles are `DecoratedBox`/`Image` — so the
    // title text is the only part of the card that hit-tests. That is true of
    // all five `_*CollectionCard`s on this page and is out of scope here, but
    // it is why this tap is aimed where it is.
    await tester.tap(find.descendant(of: find.byKey(const Key('library-albums-card')), matching: find.byType(Text)));
    await tester.pumpAndSettle();

    expect(find.byKey(const Key('albums-page')), findsOneWidget);
    expect(router.current.name, DriftAlbumsRoute.name);
  });
}
