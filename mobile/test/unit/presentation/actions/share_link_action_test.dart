import 'package:auto_route/auto_route.dart';
import 'package:easy_localization/easy_localization.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/constants/locales.dart';
import 'package:immich_mobile/domain/models/asset/base_asset.model.dart';
import 'package:immich_mobile/generated/codegen_loader.g.dart';
import 'package:immich_mobile/presentation/actions/action.widget.dart';
import 'package:immich_mobile/presentation/actions/share_link.action.dart';
import 'package:immich_mobile/routing/router.dart';
import 'package:immich_ui/immich_ui.dart';

import '../../factories/remote_asset_factory.dart';
import '../presentation_context.dart';

/// #1018: the shared-link editor's consent warning is only as good as the count it is handed.
/// The widget tests over the editor prove it renders for a given count; they cannot see that the
/// number comes from the real selection's owners rather than a constant. These do — they drive
/// the actual chain (selection -> ShareLinkAction -> the route's arguments), so a hardcoded or
/// inverted count fails here rather than shipping a warning that misreports how many of someone
/// else's photos are about to become public.
///
/// Minimal self-contained router, in the style of `similar_photos_action_test.dart`: the app's
/// real `AppRouter` is auth-guarded and needs a live drift stack.
const _editorPageKey = Key('fake-shared-link-edit');

class _ShareLinkTestRouter extends RootStackRouter {
  _ShareLinkTestRouter({required this.action});

  final ShareLinkAction action;
  PageRouteInfo? pushed;

  late final PageInfo _homePage = PageInfo(
    'ShareLinkActionHarness',
    builder: (data) => Material(child: ActionIconButton(action: action)),
  );

  static final _editorPage = PageInfo(
    SharedLinkEditRoute.name,
    builder: (data) => const SizedBox(key: _editorPageKey),
  );

  @override
  List<AutoRoute> get routes => [AutoRoute(page: _homePage, initial: true), AutoRoute(page: _editorPage)];

  @override
  Future<T?> push<T extends Object?>(PageRouteInfo route, {OnNavigationFailure? onFailure}) {
    pushed = route;
    return super.push<T>(route, onFailure: onFailure);
  }
}

void main() {
  late PresentationContext context;

  setUp(() async {
    context = await PresentationContext.create();
  });

  tearDown(() => context.dispose());

  RemoteAsset mine() => RemoteAssetFactory.create(ownerId: context.currentUser.id);
  RemoteAsset theirs() => RemoteAssetFactory.create(ownerId: 'someone-else');
  RemoteAsset alsoTheirs() => RemoteAssetFactory.create(ownerId: 'another-member');

  /// Taps the action and returns the arguments it pushed at the editor.
  Future<Map<String, dynamic>> tapAndCapture(
    WidgetTester tester,
    Set<BaseAsset> selection, {
    String? spaceId,
  }) async {
    final router = _ShareLinkTestRouter(action: ShareLinkAction(source: .timeline, spaceId: spaceId));
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
          overrides: [...context.overrides, ...context.selected(selection)],
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

    await tester.tap(find.byType(ImmichIconButton));
    await tester.pumpAndSettle();

    expect(tester.takeException(), isNull);
    expect(router.pushed, isNotNull, reason: 'the action must open the shared-link editor');
    return router.pushed!.rawArgs;
  }

  group('ShareLinkAction contributedCount', () {
    testWidgets('counts only the assets other members own', (tester) async {
      final args = await tapAndCapture(tester, {mine(), theirs(), alsoTheirs()}, spaceId: 'space-1');

      expect(args['contributedCount'], 2);
      expect(args['spaceId'], 'space-1');
      expect((args['assetsList'] as List).length, 3, reason: 'the whole selection is published, not the owned subset');
    });

    testWidgets('counts none when the caller owns the whole selection', (tester) async {
      final args = await tapAndCapture(tester, {mine()}, spaceId: 'space-1');

      expect(args['contributedCount'], 0);
    });

    testWidgets('counts none off a space surface, where the link is narrowed to the caller anyway', (tester) async {
      final args = await tapAndCapture(tester, {mine(), theirs()});

      expect(args['contributedCount'], 0);
      expect(args['spaceId'], isNull);
    });
  });
}
