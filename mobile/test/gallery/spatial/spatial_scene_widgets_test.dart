import 'dart:async';
import 'dart:typed_data';
import 'dart:ui' as ui;

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/gallery/spatial/spatial_scene.providers.dart';
import 'package:immich_mobile/gallery/spatial/spatial_scene_overlay.widget.dart';
import 'package:immich_mobile/gallery/spatial/spatial_scene_toggle_button.widget.dart';
import 'package:immich_mobile/widgets/common/immich_loading_indicator.dart';

import '../../test_utils.dart';
import '../../widget_tester_extensions.dart';

void main() {
  final photo = TestUtils.createRemoteAsset(id: 'photo');

  /// The button and the overlay together, as the viewer has them, with the server's answer for [photo].
  Future<ProviderContainer> pumpViewer(
    WidgetTester tester, {
    required bool offered,
    Future<SpatialSceneTextures> Function()? textures,
  }) async {
    await tester.pumpConsumerWidgetRaw(
      Stack(
        children: [
          Positioned.fill(child: SpatialSceneOverlay(asset: photo)),
          SpatialSceneToggleButton(asset: photo),
        ],
      ),
      overrides: [
        spatialSceneOfferedProvider.overrideWith((ref, id) async => offered),
        spatialSceneTexturesProvider.overrideWith(
          (ref, key) => textures?.call() ?? Completer<SpatialSceneTextures>().future,
        ),
      ],
    );
    await tester.pump();
    await tester.pump(Durations.long2);
    return ProviderScope.containerOf(tester.element(find.byType(Stack).first));
  }

  testWidgets('shows no button on a photo the server does not offer it for', (tester) async {
    await pumpViewer(tester, offered: false);
    expect(find.byIcon(Icons.view_in_ar_outlined), findsNothing);
    expect(find.byType(ImmichLoadingIndicator), findsNothing);
  });

  testWidgets('opens and closes the scene from the button', (tester) async {
    final container = await pumpViewer(tester, offered: true);
    expect(find.byIcon(Icons.view_in_ar_outlined), findsOneWidget);
    expect(find.byType(ImmichLoadingIndicator), findsNothing);

    await tester.tap(find.byIcon(Icons.view_in_ar_outlined));
    await tester.pump(Durations.long2);
    expect(container.read(spatialSceneAssetProvider), 'photo');
    expect(find.byIcon(Icons.view_in_ar_rounded), findsOneWidget);
    // the depth map is still loading
    expect(find.byType(ImmichLoadingIndicator), findsOneWidget);

    await tester.tap(find.byIcon(Icons.view_in_ar_rounded));
    await tester.pump(Durations.long2);
    expect(container.read(spatialSceneAssetProvider), isNull);
    expect(find.byType(ImmichLoadingIndicator), findsNothing);
  });

  testWidgets('stays closed for a photo the Spatial view is not on', (tester) async {
    final container = await pumpViewer(tester, offered: true);
    container.read(spatialSceneAssetProvider.notifier).state = 'another-photo';
    await tester.pump();
    expect(find.byType(ImmichLoadingIndicator), findsNothing);
    expect(find.byIcon(Icons.view_in_ar_outlined), findsOneWidget);
  });

  testWidgets('draws the scene with the real shader once the depth map is in', (tester) async {
    final textures = await tester.runAsync(() async {
      Future<ui.Image> solid(List<int> rgba) {
        final completer = Completer<ui.Image>();
        final pixels = Uint8List.fromList([for (var i = 0; i < 16; i++) ...rgba]);
        ui.decodeImageFromPixels(pixels, 4, 4, ui.PixelFormat.rgba8888, completer.complete);
        return completer.future;
      }

      return SpatialSceneTextures(
        image: await solid([200, 40, 40, 255]),
        depth: await solid([128, 128, 128, 255]),
        focus: 0.5,
      );
    });
    addTearDown(textures!.dispose);

    final container = await pumpViewer(tester, offered: true, textures: () async => textures);
    container.read(spatialSceneAssetProvider.notifier).state = 'photo';
    await tester.pump();
    // the shader program loads off the frame
    await tester.runAsync(() => ui.FragmentProgram.fromAsset('shaders/spatial_scene.frag'));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 100));

    expect(tester.takeException(), isNull);
    expect(find.byType(ImmichLoadingIndicator), findsNothing);
    expect(find.bySemanticsLabel('Spatial Scene'), findsOneWidget);
    expect(find.descendant(of: find.byType(SpatialSceneOverlay), matching: find.byType(CustomPaint)), findsOneWidget);

    container.read(spatialSceneAssetProvider.notifier).state = null;
    await tester.pump();
  });

  testWidgets('closes again when the depth map cannot be loaded', (tester) async {
    final container = await pumpViewer(tester, offered: true, textures: () => Future.error(Exception('404')));
    await tester.tap(find.byIcon(Icons.view_in_ar_outlined));
    await tester.pump();
    await tester.pump(Durations.long2);
    expect(container.read(spatialSceneAssetProvider), isNull);
    expect(find.byType(ImmichLoadingIndicator), findsNothing);
    // let the error toast run out
    await tester.pump(const Duration(seconds: 5));
  });
}
