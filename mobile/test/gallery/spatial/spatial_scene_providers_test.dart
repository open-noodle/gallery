import 'package:flutter_test/flutter_test.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/gallery/spatial/spatial_scene.providers.dart';
import 'package:immich_mobile/providers/api.provider.dart';
import 'package:mocktail/mocktail.dart';
import 'package:openapi/api.dart';

import '../../api.mocks.dart';
import '../../service.mocks.dart';

class _MockAssetsApi extends Mock implements AssetsApi {}

class _MockServerFeatures extends Mock implements ServerFeaturesDto {}

class _MockAsset extends Mock implements AssetResponseDto {}

void main() {
  late MockServerApi server;
  late _MockAssetsApi assets;
  late ProviderContainer container;

  void serverSays(Optional<bool?> spatialScene) {
    final features = _MockServerFeatures();
    when(() => features.spatialScene).thenReturn(spatialScene);
    when(() => server.getServerFeatures()).thenAnswer((_) async => features);
  }

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
    server = MockServerApi();
    assets = _MockAssetsApi();
    final api = MockApiService();
    when(() => api.serverInfoApi).thenReturn(server);
    when(() => api.assetsApi).thenReturn(assets);
    container = ProviderContainer(overrides: [apiServiceProvider.overrideWithValue(api)]);
    addTearDown(container.dispose);
  });

  test('offers it on a photo the server marks, when the feature is on', () async {
    serverSays(const Optional.present(true));
    assetSays('a', const Optional.present(true));
    expect(await offered('a'), isTrue);
  });

  test('does not offer it on a photo the server does not mark', () async {
    serverSays(const Optional.present(true));
    assetSays('a', const Optional.present(false));
    expect(await offered('a'), isFalse);
  });

  test('does not ask about the photo when the feature is off', () async {
    serverSays(const Optional.present(false));
    expect(await offered('a'), isFalse);
    verifyNever(() => assets.getAssetInfo(any()));
  });

  test('treats a server that predates the flag as off', () async {
    serverSays(const Optional.absent());
    expect(await offered('a'), isFalse);
    verifyNever(() => assets.getAssetInfo(any()));
  });

  test('treats a stock Immich server, whose features do not decode, as off', () async {
    when(() => server.getServerFeatures()).thenThrow(ApiException(500, 'missing required keys'));
    expect(await offered('a'), isFalse);
    verifyNever(() => assets.getAssetInfo(any()));
  });

  test('does not offer it when the photo cannot be read', () async {
    serverSays(const Optional.present(true));
    when(() => assets.getAssetInfo('a')).thenThrow(ApiException(404, 'not found'));
    expect(await offered('a'), isFalse);
  });
}
