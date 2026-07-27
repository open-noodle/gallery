import 'dart:async';
import 'dart:convert';

import 'package:drift/drift.dart';
import 'package:drift/native.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:immich_mobile/data/db/main/database.dart';
import 'package:immich_mobile/domain/models/sync_event.model.dart';
import 'package:immich_mobile/domain/services/store.service.dart';
import 'package:immich_mobile/infrastructure/repositories/store.repository.dart';
import 'package:immich_mobile/infrastructure/repositories/sync_api.repository.dart';
import 'package:immich_mobile/utils/semver.dart';
import 'package:mocktail/mocktail.dart';
import 'package:openapi/api.dart';

import '../../api.mocks.dart';
import '../../service.mocks.dart';

class MockHttpClient extends Mock implements http.Client {}

class MockApiClient extends Mock implements ApiClient {}

class MockStreamedResponse extends Mock implements http.StreamedResponse {}

class FakeBaseRequest extends Fake implements http.BaseRequest {}

String _createJsonLine(String type, Map<String, dynamic> data, String ack) {
  return '${jsonEncode({'type': type, 'data': data, 'ack': ack})}\n';
}

void main() {
  late SyncApiRepository sut;
  late MockApiService mockApiService;
  late MockApiClient mockApiClient;
  late MockSyncApi mockSyncApi;
  late MockHttpClient mockHttpClient;
  late MockStreamedResponse mockStreamedResponse;
  late StreamController<List<int>> responseStreamController;
  const int testBatchSize = 3;

  setUpAll(() async {
    final db = Drift(DatabaseConnection(NativeDatabase.memory(), closeStreamsSynchronously: true));
    await StoreService.init(storeRepository: StoreRepository(db));
  });

  setUp(() {
    mockApiService = MockApiService();
    mockApiClient = MockApiClient();
    mockSyncApi = MockSyncApi();
    mockHttpClient = MockHttpClient();
    mockStreamedResponse = MockStreamedResponse();
    responseStreamController = StreamController<List<int>>.broadcast(sync: true);

    registerFallbackValue(FakeBaseRequest());

    when(() => mockApiService.apiClient).thenReturn(mockApiClient);
    when(() => mockApiService.syncApi).thenReturn(mockSyncApi);
    when(() => mockApiClient.basePath).thenReturn('http://demo.immich.app/api');
    // Mock HTTP client behavior
    when(() => mockHttpClient.send(any())).thenAnswer((_) async => mockStreamedResponse);
    when(() => mockStreamedResponse.statusCode).thenReturn(200);
    when(() => mockStreamedResponse.stream).thenAnswer((_) => http.ByteStream(responseStreamController.stream));

    sut = SyncApiRepository(mockApiService);
  });

  tearDown(() async {
    if (!responseStreamController.isClosed) {
      await responseStreamController.close();
    }
  });

  Future<void> streamChanges(
    Future<void> Function(List<SyncEvent>, Function() abort, Function() reset) onDataCallback,
    SemVer serverVersion, {
    Set<String>? supportedSyncTypes,
  }) {
    return sut.streamChanges(
      onDataCallback,
      batchSize: testBatchSize,
      httpClient: mockHttpClient,
      serverVersion: serverVersion,
      supportedSyncTypes: supportedSyncTypes,
    );
  }

  // Drives one streamChanges call end-to-end (empty response stream), then
  // reads back the request body the SUT sent so we can assert on `types`.
  // The request is populated (body set) before client.send, and the mock
  // captures the object by reference, so reading .body afterwards is valid.
  Future<List<String>> capturedRequestTypes(SemVer serverVersion, {Set<String>? supportedSyncTypes}) async {
    final future = streamChanges((_, _, _) async {}, serverVersion, supportedSyncTypes: supportedSyncTypes);
    await Future.delayed(const Duration(milliseconds: 50));
    await responseStreamController.close();
    await future;

    final captured = verify(() => mockHttpClient.send(captureAny())).captured;
    final request = captured.single as http.Request; // AbortableRequest extends Request
    final body = jsonDecode(request.body) as Map<String, dynamic>;
    return (body['types'] as List).cast<String>();
  }

  group('mobile-1: SharedSpaceAlbum request-type version gate', () {
    const albumTypes = <String>[
      'SharedSpaceAlbumsV1',
      'SharedSpaceAlbumLinksV1',
      'SharedSpaceAlbumToAssetsV1',
      'SharedSpaceAlbumAssetsV1',
      'SharedSpaceAlbumAssetExifsV1',
    ];

    test('v5.0.0 (last pre-feature release): EXCLUDES all 5 album types', () async {
      final types = await capturedRequestTypes(const SemVer(major: 5, minor: 0, patch: 0));
      expect(albumTypes.any(types.contains), isFalse, reason: 'v5.0.0 has no SharedSpaceAlbum enum values');
      // Unconditional fork types are unaffected.
      expect(types, contains('SharedSpacesV1'));
      expect(types, contains('SharedSpaceLibrariesV1'));
    });

    test('old upstream-numbered fork server (3.0.1): EXCLUDES all 5 album types (fail-safe to old)', () async {
      final types = await capturedRequestTypes(const SemVer(major: 3, minor: 0, patch: 1));
      expect(albumTypes.any(types.contains), isFalse);
    });

    test('v5.0.1 (first possible post-release): INCLUDES all 5 album types', () async {
      final types = await capturedRequestTypes(const SemVer(major: 5, minor: 0, patch: 1));
      expect(albumTypes.every(types.contains), isTrue);
    });

    test('feature release v5.1.0 (at/above the feature boundary): INCLUDES all 5 album types', () async {
      final types = await capturedRequestTypes(const SemVer(major: 5, minor: 1, patch: 0));
      expect(albumTypes.every(types.contains), isTrue);
    });

    test('feature release-candidate v5.1.0-rc.0: INCLUDES all 5 album types (RC validation)', () async {
      final types = await capturedRequestTypes(const SemVer(major: 5, minor: 1, patch: 0, prerelease: 0));
      expect(albumTypes.every(types.contains), isTrue);
    });

    test('far-future v6.0.0: INCLUDES all 5 album types', () async {
      final types = await capturedRequestTypes(const SemVer(major: 6, minor: 0, patch: 0));
      expect(albumTypes.every(types.contains), isTrue);
    });

    test('M14: every SharedSpaceAlbum* SyncRequestType enum value is inside the version gate', () async {
      // Guards the invariant the tests above only spot-check with the hardcoded `albumTypes`
      // list: derives the "must be gated" set from the generated SyncRequestType.values enum
      // itself, so a future fork-only SharedSpaceAlbum* type landing in the enum without being
      // added to the `serverVersion > SemVer(5, 0, 0)` gate in sync_api.repository.dart fails
      // here even if `albumTypes` above is never updated to match — the exact regression class
      // the mobile-1 gate exists to prevent (a whole-stream 400 outage on an older server).
      final forkAlbumTypes = SyncRequestType.values
          .map((t) => t.toString())
          .where((v) => v.startsWith('SharedSpaceAlbum'))
          .toSet();

      final ungated = (await capturedRequestTypes(const SemVer(major: 5, minor: 0, patch: 0))).toSet();
      expect(
        ungated.intersection(forkAlbumTypes),
        isEmpty,
        reason: 'every SharedSpaceAlbum* SyncRequestType must be inside the version gate',
      );

      final gated = (await capturedRequestTypes(const SemVer(major: 6, minor: 0, patch: 0))).toSet();
      expect(
        forkAlbumTypes.difference(gated),
        isEmpty,
        reason: 'every SharedSpaceAlbum* SyncRequestType must be sent once the version gate is satisfied',
      );
    });
  });

  group('server-declared sync capabilities override the version gate', () {
    const albumTypes = <String>[
      'SharedSpaceAlbumsV1',
      'SharedSpaceAlbumLinksV1',
      'SharedSpaceAlbumToAssetsV1',
      'SharedSpaceAlbumAssetsV1',
      'SharedSpaceAlbumAssetExifsV1',
    ];

    test('a declaring server INCLUDES the album types even when its version reads at/below the gate', () async {
      // An RC image stamps the bare base version (5.0.0-rc.N reports 5.0.0) and an
      // unbranded dev server reports the upstream version — both lie below the
      // version gate while fully supporting the feature. The declaration must win.
      for (final version in [const SemVer(major: 5, minor: 0, patch: 0), const SemVer(major: 3, minor: 0, patch: 3)]) {
        final types = await capturedRequestTypes(version, supportedSyncTypes: {...albumTypes, 'AssetsV1'});
        expect(albumTypes.every(types.contains), isTrue, reason: 'declared capability must open the gate at $version');
        clearInteractions(mockHttpClient);
      }
    });

    test('a declaring server WITHOUT the album types EXCLUDES them even far above the version gate', () async {
      final types = await capturedRequestTypes(
        const SemVer(major: 6, minor: 0, patch: 0),
        supportedSyncTypes: {'AssetsV1'},
      );
      expect(albumTypes.any(types.contains), isFalse, reason: 'the declaration is authoritative in both directions');
    });

    test('a partial declaration sends exactly the declared album types', () async {
      final declared = {'SharedSpaceAlbumsV1', 'SharedSpaceAlbumLinksV1'};
      final types = await capturedRequestTypes(
        const SemVer(major: 5, minor: 0, patch: 0),
        supportedSyncTypes: declared,
      );
      expect(types.where(albumTypes.contains).toSet(), declared);
    });
  });

  test('streamChanges stops processing stream when abort is called', () async {
    int onDataCallCount = 0;
    bool abortWasCalledInCallback = false;
    List<SyncEvent> receivedEventsBatch1 = [];
    final Completer<void> firstBatchReceived = Completer<void>();

    Future<void> onDataCallback(List<SyncEvent> events, Function() abort, Function() _) async {
      onDataCallCount++;
      if (onDataCallCount == 1) {
        receivedEventsBatch1 = events;
        abort();
        abortWasCalledInCallback = true;
        firstBatchReceived.complete();
      } else {
        fail("onData called more than once after abort was invoked");
      }
    }

    final streamChangesFuture = streamChanges(onDataCallback, const SemVer(major: 2, minor: 5, patch: 0));

    // Give the stream subscription time to start (longer delay to account for mock delay)
    await Future.delayed(const Duration(milliseconds: 50));

    for (int i = 0; i < testBatchSize; i++) {
      responseStreamController.add(
        utf8.encode(
          _createJsonLine(SyncEntityType.userDeleteV1.toString(), SyncUserDeleteV1(userId: "user$i").toJson(), 'ack$i'),
        ),
      );
    }

    await firstBatchReceived.future.timeout(
      const Duration(seconds: 5),
      onTimeout: () => fail('First batch was not processed within timeout'),
    );

    for (int i = testBatchSize; i < testBatchSize * 2; i++) {
      responseStreamController.add(
        utf8.encode(
          _createJsonLine(SyncEntityType.userDeleteV1.toString(), SyncUserDeleteV1(userId: "user$i").toJson(), 'ack$i'),
        ),
      );
    }

    await responseStreamController.close();
    await expectLater(streamChangesFuture, completes);

    expect(onDataCallCount, 1);
    expect(abortWasCalledInCallback, isTrue);
    expect(receivedEventsBatch1.length, testBatchSize);
  });

  test('streamChanges does not process remaining lines in finally block if aborted', () async {
    int onDataCallCount = 0;
    bool abortWasCalledInCallback = false;
    final Completer<void> firstBatchReceived = Completer<void>();

    Future<void> onDataCallback(List<SyncEvent> _, Function() abort, Function() _) async {
      onDataCallCount++;
      if (onDataCallCount == 1) {
        abort();
        abortWasCalledInCallback = true;
        firstBatchReceived.complete();
      } else {
        fail("onData called more than once after abort was invoked");
      }
    }

    final streamChangesFuture = streamChanges(onDataCallback, const SemVer(major: 2, minor: 5, patch: 0));

    await Future.delayed(const Duration(milliseconds: 50));

    for (int i = 0; i < testBatchSize; i++) {
      responseStreamController.add(
        utf8.encode(
          _createJsonLine(SyncEntityType.userDeleteV1.toString(), SyncUserDeleteV1(userId: "user$i").toJson(), 'ack$i'),
        ),
      );
    }

    await firstBatchReceived.future.timeout(
      const Duration(seconds: 5),
      onTimeout: () => fail('First batch was not processed within timeout'),
    );

    // emit a single event to skip batching and trigger finally
    responseStreamController.add(
      utf8.encode(
        _createJsonLine(SyncEntityType.userDeleteV1.toString(), SyncUserDeleteV1(userId: "user100").toJson(), 'ack100'),
      ),
    );

    await responseStreamController.close();
    await expectLater(streamChangesFuture, completes);

    expect(onDataCallCount, 1);
    expect(abortWasCalledInCallback, isTrue);
  });

  test('streamChanges processes remaining lines in finally block if not aborted', () async {
    int onDataCallCount = 0;
    List<SyncEvent> receivedEventsBatch1 = [];
    List<SyncEvent> receivedEventsBatch2 = [];
    final Completer<void> firstBatchReceived = Completer<void>();
    final Completer<void> secondBatchReceived = Completer<void>();

    Future<void> onDataCallback(List<SyncEvent> events, Function() _, Function() _) async {
      onDataCallCount++;
      if (onDataCallCount == 1) {
        receivedEventsBatch1 = events;
        firstBatchReceived.complete();
      } else if (onDataCallCount == 2) {
        receivedEventsBatch2 = events;
        secondBatchReceived.complete();
      } else {
        fail("onData called more than expected");
      }
    }

    final streamChangesFuture = streamChanges(onDataCallback, const SemVer(major: 2, minor: 5, patch: 0));

    await Future.delayed(const Duration(milliseconds: 50));

    // Batch 1
    for (int i = 0; i < testBatchSize; i++) {
      responseStreamController.add(
        utf8.encode(
          _createJsonLine(SyncEntityType.userDeleteV1.toString(), SyncUserDeleteV1(userId: "user$i").toJson(), 'ack$i'),
        ),
      );
    }

    await firstBatchReceived.future.timeout(
      const Duration(seconds: 5),
      onTimeout: () => fail('First batch was not processed within timeout'),
    );

    responseStreamController.add(
      utf8.encode(
        _createJsonLine(SyncEntityType.userDeleteV1.toString(), SyncUserDeleteV1(userId: "user100").toJson(), 'ack100'),
      ),
    );

    await responseStreamController.close();

    await secondBatchReceived.future.timeout(
      const Duration(seconds: 5),
      onTimeout: () => fail('Second batch was not processed within timeout'),
    );

    await expectLater(streamChangesFuture, completes);

    expect(onDataCallCount, 2);
    expect(receivedEventsBatch1.length, testBatchSize);
    expect(receivedEventsBatch2.length, 1);
  });

  test('streamChanges handles stream error gracefully', () async {
    final streamError = Exception("Network Error");
    int onDataCallCount = 0;

    Future<void> onDataCallback(List<SyncEvent> _, Function() _, Function() _) async {
      onDataCallCount++;
    }

    final streamChangesFuture = streamChanges(onDataCallback, const SemVer(major: 2, minor: 5, patch: 0));

    await Future.delayed(const Duration(milliseconds: 50));

    responseStreamController.add(
      utf8.encode(
        _createJsonLine(SyncEntityType.userDeleteV1.toString(), SyncUserDeleteV1(userId: "user1").toJson(), 'ack1'),
      ),
    );

    responseStreamController.addError(streamError);
    await expectLater(streamChangesFuture, throwsA(streamError));

    expect(onDataCallCount, 0);
  });

  test('streamChanges throws ApiException on non-200 status code', () async {
    when(() => mockStreamedResponse.statusCode).thenReturn(401);
    final errorBodyController = StreamController<List<int>>(sync: true);
    when(() => mockStreamedResponse.stream).thenAnswer((_) => http.ByteStream(errorBodyController.stream));

    int onDataCallCount = 0;
    Future<void> onDataCallback(List<SyncEvent> _, Function() _, Function() _) async {
      onDataCallCount++;
    }

    final future = streamChanges(onDataCallback, const SemVer(major: 2, minor: 5, patch: 0));

    errorBodyController.add(utf8.encode('{"error":"Unauthorized"}'));
    await errorBodyController.close();

    await expectLater(
      future,
      throwsA(
        isA<ApiException>()
            .having((e) => e.code, 'code', 401)
            .having((e) => e.message, 'message', contains('Unauthorized')),
      ),
    );

    expect(onDataCallCount, 0);
  });
}
