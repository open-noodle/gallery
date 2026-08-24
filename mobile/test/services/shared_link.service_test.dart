// #1018: a share link made from inside a Space has to name that space, or the server falls back to
// the owner-only permission and rejects every photo another member contributed.
import 'package:flutter_test/flutter_test.dart';
import 'package:immich_mobile/services/shared_link.service.dart';
import 'package:mocktail/mocktail.dart';
import 'package:openapi/api.dart';

import '../service.mocks.dart';

class _MockSharedLinksApi extends Mock implements SharedLinksApi {}

void main() {
  late MockApiService apiService;
  late _MockSharedLinksApi sharedLinksApi;
  late SharedLinkService sut;

  setUpAll(() {
    registerFallbackValue(SharedLinkCreateDto(type: SharedLinkType.INDIVIDUAL));
  });

  setUp(() {
    apiService = MockApiService();
    sharedLinksApi = _MockSharedLinksApi();
    when(() => apiService.sharedLinksApi).thenReturn(sharedLinksApi);
    when(() => sharedLinksApi.createSharedLink(any())).thenAnswer((_) async => null);
    sut = SharedLinkService(apiService);
  });

  SharedLinkCreateDto capturedDto() =>
      verify(() => sharedLinksApi.createSharedLink(captureAny())).captured.single as SharedLinkCreateDto;

  group('createSharedLink from a space', () {
    test('names the space on an individual link', () async {
      await sut.createSharedLink(
        showMeta: true,
        allowDownload: true,
        allowUpload: false,
        assetIds: const ['asset-1'],
        spaceId: 'space-1',
      );

      expect(capturedDto().spaceId.value, 'space-1');
    });

    test('names the space on an album link', () async {
      await sut.createSharedLink(
        showMeta: true,
        allowDownload: true,
        allowUpload: false,
        albumId: 'album-1',
        spaceId: 'space-1',
      );

      expect(capturedDto().spaceId.value, 'space-1');
    });
  });

  group('createSharedLink outside a space', () {
    test('leaves the space absent on an individual link', () async {
      await sut.createSharedLink(showMeta: true, allowDownload: true, allowUpload: false, assetIds: const ['asset-1']);

      expect(capturedDto().spaceId.isPresent, isFalse);
    });

    test('leaves the space absent on an album link', () async {
      await sut.createSharedLink(showMeta: true, allowDownload: true, allowUpload: false, albumId: 'album-1');

      expect(capturedDto().spaceId.isPresent, isFalse);
    });
  });
}
