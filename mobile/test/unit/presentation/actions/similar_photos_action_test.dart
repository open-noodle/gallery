import 'package:auto_route/auto_route.dart';
import 'package:easy_localization/easy_localization.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/constants/locales.dart';
import 'package:immich_mobile/generated/codegen_loader.g.dart';
import 'package:immich_mobile/presentation/actions/action.widget.dart';
import 'package:immich_mobile/presentation/actions/similar_photos.action.dart';
import 'package:immich_mobile/providers/asset_viewer/asset_viewer.provider.dart';
import 'package:immich_mobile/providers/photos_filter/photos_filter.provider.dart';
import 'package:immich_mobile/routing/router.dart';
import 'package:immich_ui/immich_ui.dart';
import 'package:mocktail/mocktail.dart';

import '../../factories/remote_asset_factory.dart';
import '../presentation_context.dart';

/// Minimal, self-contained AutoRoute router — just enough to prove
/// `SimilarPhotosAction` really navigates to [MainTimelineRoute] without
/// pulling in the app's full, auth-guarded `AppRouter` (which needs a live
/// timeline/drift stack). Mirrors the harness in
/// `test/presentation/widgets/filter_sheet/strips/strips_test.dart`.
///
/// `onNavigate` fires synchronously from inside [navigate], i.e. at the
/// exact call site of `context.navigateTo` and before any of AutoRoute's
/// (asynchronous) guard/transition machinery runs — used to pin that the
/// photos filter is already set by the time navigation is *requested*, not
/// just by the time it eventually completes.
const _timelinePageKey = Key('fake-main-timeline');

class _SimilarPhotosTestRouter extends RootStackRouter {
  _SimilarPhotosTestRouter({this.onNavigate});

  final VoidCallback? onNavigate;

  static final _homePage = PageInfo(
    'SimilarPhotosActionHarness',
    builder: (data) => const Material(
      child: ActionIconButton(action: SimilarPhotosAction(assetId: assetId)),
    ),
  );

  static final _timelinePage = PageInfo(
    MainTimelineRoute.name,
    builder: (data) => const SizedBox(key: _timelinePageKey),
  );

  @override
  List<AutoRoute> get routes => [AutoRoute(page: _homePage, initial: true), AutoRoute(page: _timelinePage)];

  @override
  Future<dynamic> navigate(PageRouteInfo route, {OnNavigationFailure? onFailure}) {
    onNavigate?.call();
    return super.navigate(route, onFailure: onFailure);
  }
}

const assetId = 'asset-1';

void main() {
  late PresentationContext context;

  setUp(() async {
    context = await PresentationContext.create();
  });

  tearDown(() => context.dispose());

  Future<void> pumpWithRouter(WidgetTester tester, {VoidCallback? onNavigate}) async {
    final router = _SimilarPhotosTestRouter(onNavigate: onNavigate);
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
          overrides: context.overrides,
          child: Builder(
            builder: (ctx) => MaterialApp.router(
              debugShowCheckedModeBanner: false,
              routerConfig: router.config(),
              localizationsDelegates: ctx.localizationDelegates,
              supportedLocales: ctx.supportedLocales,
              locale: ctx.locale,
            ),
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();
  }

  group('SimilarPhotosAction', () {
    testWidgets('renders an action button for a valid asset', (tester) async {
      await tester.pumpTestWidget(context, const ActionIconButton(action: SimilarPhotosAction(assetId: assetId)));

      expect(find.byType(ImmichIconButton), findsOneWidget);
    });

    testWidgets('sets the similar-to filter for the asset when tapped, and navigates to the timeline', (tester) async {
      await pumpWithRouter(tester);

      await tester.tap(find.byType(ImmichIconButton));
      await tester.pumpAndSettle();

      expect(tester.takeException(), isNull);
      final container = ProviderScope.containerOf(tester.element(find.byKey(_timelinePageKey)));
      expect(container.read(photosFilterProvider).assetId, assetId);
      expect(find.byKey(_timelinePageKey), findsOneWidget, reason: 'navigated to the (fake) main timeline');
    });

    testWidgets('invalidates the asset viewer', (tester) async {
      when(() => context.service.asset.service.watchAsset(any())).thenAnswer((_) => const Stream.empty());
      await pumpWithRouter(tester);
      final container = ProviderScope.containerOf(tester.element(find.byType(ActionIconButton)));

      // Seed the asset viewer with a "current asset" the way the real viewer
      // would have it set before the user opens the similar-photos action.
      // If the action fails to invalidate, this stays around after the tap.
      container.read(assetViewerProvider.notifier).setAsset(RemoteAssetFactory.create());
      expect(container.read(assetViewerProvider).currentAsset, isNotNull);

      await tester.tap(find.byType(ImmichIconButton));
      await tester.pumpAndSettle();

      expect(
        container.read(assetViewerProvider).currentAsset,
        isNull,
        reason: 'ref.invalidate(assetViewerProvider) resets it back to the fresh AssetViewerState()',
      );
    });

    // The filter must be set BEFORE navigation is requested, not just
    // "eventually, once everything settles" — otherwise the timeline can
    // open unfiltered. `onNavigate` fires synchronously at the exact call
    // site of `context.navigateTo`, before any of the router's async
    // guard/transition machinery runs, so this captures the filter's value
    // at that precise moment. An implementation that navigates first and
    // only then sets the filter would be caught navigating with the filter
    // still unset.
    testWidgets('sets the similar-to filter before navigation is requested', (tester) async {
      String? assetIdWhenNavigateWasCalled;
      late ProviderContainer container;

      await pumpWithRouter(
        tester,
        onNavigate: () => assetIdWhenNavigateWasCalled = container.read(photosFilterProvider).assetId,
      );
      container = ProviderScope.containerOf(tester.element(find.byType(ActionIconButton)));

      await tester.tap(find.byType(ImmichIconButton));
      await tester.pumpAndSettle();

      expect(tester.takeException(), isNull);
      expect(assetIdWhenNavigateWasCalled, assetId);
    });
  });
}
