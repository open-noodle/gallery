import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:immich_mobile/repositories/auth_api.repository.dart';
import 'package:mocktail/mocktail.dart';
import 'package:openapi/api.dart';

import '../service.mocks.dart';

class MockApiClient extends Mock implements ApiClient {}

class MockHttpClient extends Mock implements http.Client {}

void main() {
  late AuthApiRepository sut;
  late MockApiService apiService;
  late MockApiClient apiClient;
  late MockHttpClient httpClient;

  setUpAll(() {
    registerFallbackValue(<QueryParam>[]);
    registerFallbackValue(<String, String>{});
    registerFallbackValue(Uri.parse('https://demo.opennoodle.de/api/auth/demo-login'));
    registerFallbackValue(http.Request('POST', Uri.parse('https://demo.opennoodle.de/api/auth/demo-login')));
  });

  setUp(() {
    apiService = MockApiService();
    apiClient = MockApiClient();
    httpClient = MockHttpClient();

    when(() => apiService.apiClient).thenReturn(apiClient);

    sut = AuthApiRepository(apiService);
  });

  test('demoLogin posts to demo-login endpoint and maps login response', () async {
    when(() => apiClient.invokeAPI(any(), any(), any(), any(), any(), any(), any())).thenAnswer(
      (_) async => http.Response(
        jsonEncode({
          'accessToken': 'demo-token',
          'userId': 'demo-user-id',
          'userEmail': 'demo@gallery.app',
          'name': 'Demo User',
          'isAdmin': false,
          'profileImagePath': '',
          'shouldChangePassword': false,
          'isOnboarded': true,
        }),
        200,
      ),
    );

    final response = await sut.demoLogin();

    expect(response.accessToken, 'demo-token');
    expect(response.userId, 'demo-user-id');
    expect(response.userEmail, 'demo@gallery.app');
    expect(response.name, 'Demo User');
    expect(response.isAdmin, isFalse);
    expect(response.shouldChangePassword, isFalse);

    final captured = verify(
      () => apiClient.invokeAPI(
        captureAny(),
        captureAny(),
        captureAny(),
        captureAny(),
        captureAny(),
        captureAny(),
        captureAny(),
      ),
    ).captured;

    expect(captured[0], '/auth/demo-login');
    expect(captured[1], 'POST');
    expect(captured[2], isEmpty);
    expect(captured[3], isNull);
    expect(captured[4], isEmpty);
    expect(captured[5], isEmpty);
    expect(captured[6], isNull);
  });

  test('demoLogin works with the generated ApiClient request path', () async {
    final realApiClient = ApiClient(basePath: 'https://demo.opennoodle.de/api')..client = httpClient;
    when(() => apiService.apiClient).thenReturn(realApiClient);
    when(() => httpClient.send(any())).thenAnswer(
      (_) async => http.StreamedResponse(
        Stream.value(
          utf8.encode(
            jsonEncode({
              'accessToken': 'demo-token',
              'userId': 'demo-user-id',
              'userEmail': 'demo@gallery.app',
              'name': 'Demo User',
              'isAdmin': false,
              'profileImagePath': '',
              'shouldChangePassword': false,
              'isOnboarded': true,
            }),
          ),
        ),
        200,
      ),
    );

    final response = await sut.demoLogin();

    expect(response.accessToken, 'demo-token');

    final request = verify(() => httpClient.send(captureAny())).captured.single as http.Request;
    expect(request, isA<http.AbortableRequest>());
    expect(request.method, 'POST');
    expect(request.url, Uri.parse('https://demo.opennoodle.de/api/auth/demo-login'));
    // demoLogin sends no body and no explicit content type, so the generated client
    // sets no headers at all. Asserting emptiness still catches an accidental
    // authorization-header leak on this unauthenticated route, without pinning the
    // incidental `text/plain` header older http versions auto-added for an empty body.
    expect(request.headers, isEmpty);
    expect(request.body, '');
  });

  test('demoLogin throws ApiException on server error', () async {
    when(
      () => apiClient.invokeAPI(any(), any(), any(), any(), any(), any(), any()),
    ).thenAnswer((_) async => http.Response('Demo mode is not enabled', 403));

    await expectLater(sut.demoLogin(), throwsA(isA<ApiException>().having((error) => error.code, 'code', 403)));
  });
}
