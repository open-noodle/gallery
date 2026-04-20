import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:immich_mobile/services/api.service.dart';
import 'package:immich_mobile/services/map.service.dart';
import 'package:mocktail/mocktail.dart';
import 'package:openapi/api.dart';
import 'package:package_info_plus/package_info_plus.dart';

class MockApiService extends Mock implements ApiService {}

class MockMapApi extends Mock implements MapApi {}

void main() {
  setUpAll(() {
    TestWidgetsFlutterBinding.ensureInitialized();
    PackageInfo.setMockInitialValues(
      appName: 'Gallery',
      packageName: 'de.opennoodle.gallery',
      version: '1.0.0',
      buildNumber: '1',
      buildSignature: '',
    );
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger.setMockMethodCallHandler(
      const MethodChannel('plugins.flutter.io/maplibre_gl'),
      (_) async => null,
    );
  });

  tearDownAll(() {
    // Clear the MethodChannel handler so state doesn't leak into other tests.
    // Note: package_info_plus doesn't expose a public reset for setMockInitialValues;
    // leaving the PackageInfo mock state is acceptable since tests rarely call
    // PackageInfo.fromPlatform() outside of widget contexts.
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger.setMockMethodCallHandler(
      const MethodChannel('plugins.flutter.io/maplibre_gl'),
      null,
    );
  });

  group('MapService.getMapMarkers', () {
    late MockApiService apiService;
    late MockMapApi mapApi;
    late MapService sut;

    setUp(() {
      apiService = MockApiService();
      mapApi = MockMapApi();
      when(() => apiService.mapApi).thenReturn(mapApi);
      sut = MapService(apiService);
    });

    test('passes withSharedSpaces through to the API client', () async {
      when(
        () => mapApi.getMapMarkers(
          isFavorite: any(named: 'isFavorite'),
          isArchived: any(named: 'isArchived'),
          withPartners: any(named: 'withPartners'),
          withSharedSpaces: any(named: 'withSharedSpaces'),
          fileCreatedAfter: any(named: 'fileCreatedAfter'),
          fileCreatedBefore: any(named: 'fileCreatedBefore'),
        ),
      ).thenAnswer((_) async => []);

      await sut.getMapMarkers(withSharedSpaces: true);

      verify(
        () => mapApi.getMapMarkers(
          isFavorite: null,
          isArchived: null,
          withPartners: null,
          withSharedSpaces: true,
          fileCreatedAfter: null,
          fileCreatedBefore: null,
        ),
      ).called(1);
    });
  });
}
