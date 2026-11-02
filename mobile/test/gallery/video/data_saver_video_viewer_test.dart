import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:immich_mobile/gallery/video/data_saver_video.dart';
import 'package:immich_mobile/platform/connectivity_api.g.dart';
import 'package:immich_mobile/presentation/widgets/asset_viewer/video_viewer.widget.dart';
import 'package:immich_mobile/providers/infrastructure/platform.provider.dart';
import 'package:mocktail/mocktail.dart';
import 'package:native_video_player/native_video_player.dart';

import '../../api.mocks.dart';
import '../../unit/factories/remote_asset_factory.dart';
import '../../unit/presentation/presentation_context.dart';

// The viewer's one call into Data Saver video (specs/2026-11-01-data-saver-video-design.md, "Mobile app"): a remote
// video with no local file streams the route RemoteVideoRoute picks. The route's own rules are in
// data_saver_video_test.dart.
void main() {
  late PresentationContext context;
  late MockConnectivityApi connectivity;

  final remote = RemoteAssetFactory.create(type: .video);

  setUp(() async {
    context = await PresentationContext.create();
    connectivity = MockConnectivityApi();
    when(() => context.service.asset.service.getAsset(remote)).thenAnswer((_) async => remote);
  });

  tearDown(() async {
    await context.dispose();
  });

  Future<VideoSource?> pumpViewer(WidgetTester tester, {required List<NetworkCapability> network}) async {
    when(() => connectivity.getCapabilities()).thenAnswer((_) async => network);
    await tester.pumpTestWidget(
      context,
      NativeVideoViewer(asset: remote, image: const SizedBox()),
      // the harness nests this scope in its own: the route is created here too, so it reads these overrides
      overrides: [
        connectivityApiProvider.overrideWithValue(connectivity),
        dataSaverVideoEnabledProvider.overrideWithValue(true),
        remoteVideoRouteProvider.overrideWith(RemoteVideoRoute.new),
      ],
      expectSettle: false,
    );
    return tester.state<NativeVideoViewerState>(find.byType(NativeVideoViewer)).videoSource;
  }

  testWidgets('streams the Data Saver copy on mobile data', (tester) async {
    final source = await pumpViewer(tester, network: [NetworkCapability.cellular]);

    expect(source?.type, VideoSourceType.network);
    expect(source?.path, endsWith('/assets/${remote.id}/video/data-saver'));
  });

  testWidgets('streams the normal video on Wi-Fi', (tester) async {
    final source = await pumpViewer(tester, network: [NetworkCapability.wifi, NetworkCapability.unmetered]);

    expect(source?.path, endsWith('/assets/${remote.id}/video/playback'));
  });
}
