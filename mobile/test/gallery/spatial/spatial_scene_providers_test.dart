import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/gallery/spatial/spatial_scene.providers.dart';
import 'package:immich_mobile/models/server_info/server_features.model.dart';
import 'package:immich_mobile/providers/api.provider.dart';
import 'package:mocktail/mocktail.dart';
import 'package:openapi/api.dart';

import '../../service.mocks.dart';

class _MockAssetsApi extends Mock implements AssetsApi {}

class _MockAsset extends Mock implements AssetResponseDto {}

/// `GET /server/features` as the search contract recorded it from a current Gallery server.
Map<String, dynamic> _recordedFeatures() {
  final fixture = jsonDecode(File('test/fixtures/search_contract/server-features.json').readAsStringSync());
  return Map<String, dynamic>.from(fixture['response']['body'] as Map);
}

void main() {
  group('ServerFeatures.spatialScene', () {
    ServerFeatures fromJson(Map<String, dynamic> json) => ServerFeatures.fromDto(ServerFeaturesDto.fromJson(json)!);

    test('reads the server flag', () {
      expect(fromJson(_recordedFeatures()..['spatialScene'] = true).spatialScene, isTrue);
      expect(fromJson(_recordedFeatures()..['spatialScene'] = false).spatialScene, isFalse);
    });

    test('is off on a server that predates the flag', () {
      expect(fromJson(_recordedFeatures()..remove('spatialScene')).spatialScene, isFalse);
    });
  });

  group('spatialSceneOfferedProvider', () {
    late _MockAssetsApi assets;
    late ProviderContainer container;
    final enabled = StateProvider<bool>((ref) => true);

    void assetSays(String id, Optional<bool?> spatialScene) {
      final asset = _MockAsset();
      when(() => asset.spatialScene).thenReturn(spatialScene);
      when(() => assets.getAssetInfo(id)).thenAnswer((_) async => asset);
    }

    Future<bool> offered(String id) async {
      final subscription = container.listen(spatialSceneOfferedProvider(id), (_, _) {});
      addTearDown(subscription.close);
      return container.read(spatialSceneOfferedProvider(id).future);
    }

    setUp(() {
      assets = _MockAssetsApi();
      final api = MockApiService();
      when(() => api.assetsApi).thenReturn(assets);
      container = ProviderContainer(
        overrides: [
          apiServiceProvider.overrideWithValue(api),
          spatialSceneEnabledProvider.overrideWith((ref) => ref.watch(enabled)),
        ],
      );
      addTearDown(container.dispose);
    });

    test('offers it on a photo the server marks, when the feature is on', () async {
      assetSays('a', const Optional.present(true));
      expect(await offered('a'), isTrue);
    });

    test('does not offer it on a photo the server does not mark', () async {
      assetSays('a', const Optional.present(false));
      expect(await offered('a'), isFalse);
    });

    test('does not ask about the photo when the feature is off', () async {
      container.read(enabled.notifier).state = false;
      expect(await offered('a'), isFalse);
      verifyNever(() => assets.getAssetInfo(any()));
    });

    test('notices the admin turning it on while the viewer stays open', () async {
      container.read(enabled.notifier).state = false;
      assetSays('a', const Optional.present(true));
      expect(await offered('a'), isFalse);

      container.read(enabled.notifier).state = true;
      expect(await container.read(spatialSceneOfferedProvider('a').future), isTrue);
    });

    test('does not offer it when the photo cannot be read', () async {
      when(() => assets.getAssetInfo('a')).thenThrow(ApiException(404, 'not found'));
      expect(await offered('a'), isFalse);
    });
  });
}
