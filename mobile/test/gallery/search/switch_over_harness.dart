import 'dart:async';

import 'package:auto_route/auto_route.dart';
import 'package:easy_localization/easy_localization.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/domain/models/asset/base_asset.model.dart';
import 'package:immich_mobile/domain/services/timeline.service.dart';
import 'package:immich_mobile/platform/remote_image_api.g.dart';
import 'package:immich_mobile/presentation/pages/dev/main_timeline.page.dart';
import 'package:immich_mobile/presentation/widgets/asset_viewer/asset_viewer.page.dart';
import 'package:immich_mobile/providers/asset_viewer/asset_viewer.provider.dart';
import 'package:immich_mobile/routing/router.dart';

import '../../widget_tester_extensions.dart';
import 'search_mode_harness.dart';

// Slice 5's flows cross routes: the asset viewer is pushed over Photos, and its actions pop it and navigate back to
// Photos. A small router with exactly those two pages runs them with the real Photos page and the real asset viewer.

const _viewerName = 'SwitchOverViewer';

class SwitchOverRouter extends RootStackRouter {
  SwitchOverRouter();

  /// The timeline the viewer pages through, set before [openViewer].
  TimelineService? viewerTimeline;

  late final _photos = PageInfo(MainTimelineRoute.name, builder: (_) => const MainTimelinePage());
  late final _viewer = PageInfo(
    _viewerName,
    builder: (_) => AssetViewerPage(initialIndex: 0, timelineService: viewerTimeline!),
  );

  @override
  List<AutoRoute> get routes => [AutoRoute(page: _photos, initial: true), AutoRoute(page: _viewer)];
}

/// Pumps the real Photos page under [router].
Future<void> pumpPhotosWithRouter(WidgetTester tester, ProviderContainer container, SwitchOverRouter router) async {
  stubRemoteImages(tester);
  tester.view.physicalSize = const Size(1080, 2340);
  tester.view.devicePixelRatio = 2.75;
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);
  await tester.pumpWidget(
    localizedForTest(
      UncontrolledProviderScope(
        container: container,
        child: Builder(
          builder: (context) => MaterialApp.router(
            localizationsDelegates: context.localizationDelegates,
            supportedLocales: context.supportedLocales,
            locale: context.locale,
            routerConfig: router.config(),
          ),
        ),
      ),
    ),
  );
  await settleFrames(tester);
}

/// Opens [asset] in the real asset viewer over Photos, the way a tile tap does (AssetViewer.setAsset, then the route),
/// with [timeline] as the viewer's timeline.
Future<void> openViewer(
  WidgetTester tester,
  ProviderContainer container,
  SwitchOverRouter router,
  BaseAsset asset,
  TimelineService timeline,
) async {
  router.viewerTimeline = timeline;
  // What AssetViewer.setAsset does for a photo.
  container.read(assetViewerProvider.notifier)
    ..reset()
    ..setAsset(asset);
  // push completes when the route pops.
  unawaited(router.push(const PageRouteInfo(_viewerName)));
  await settleFrames(tester);
}

/// Opens the viewer's ⋮ menu and taps [label].
Future<void> tapViewerMenu(WidgetTester tester, String label) async {
  await tester.tap(find.byIcon(Icons.more_vert_rounded));
  await settleFrames(tester);
  await tester.tap(find.text(label));
  await settleFrames(tester);
}

/// Remote images (thumbnails, the viewer's photo) load through a platform channel the test has none of: requests stay
/// pending and cancelling one succeeds, so a viewer that closes mid-load does not throw.
void stubRemoteImages(WidgetTester tester) {
  const api = 'dev.flutter.pigeon.immich_mobile.RemoteImageApi';
  tester.binding.defaultBinaryMessenger
    ..setMockDecodedMessageHandler<Object?>(
      const BasicMessageChannel<Object?>('$api.requestImage', RemoteImageApi.pigeonChannelCodec),
      (_) => Completer<Object?>().future,
    )
    ..setMockDecodedMessageHandler<Object?>(
      const BasicMessageChannel<Object?>('$api.cancelRequest', RemoteImageApi.pigeonChannelCodec),
      (_) async => const <Object?>[null],
    );
}
