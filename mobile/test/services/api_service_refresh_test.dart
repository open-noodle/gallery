import 'dart:ffi';

import 'package:drift/drift.dart';
import 'package:drift/native.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:immich_mobile/domain/models/store.model.dart';
import 'package:immich_mobile/domain/services/store.service.dart';
import 'package:immich_mobile/entities/store.entity.dart';
import 'package:immich_mobile/infrastructure/repositories/db.repository.dart';
import 'package:immich_mobile/infrastructure/repositories/network.repository.dart';
import 'package:immich_mobile/infrastructure/repositories/store.repository.dart';
import 'package:immich_mobile/services/api.service.dart';

class _FakeClient extends http.BaseClient {
  @override
  Future<http.StreamedResponse> send(http.BaseRequest request) async {
    return http.StreamedResponse(const Stream<List<int>>.empty(), 200);
  }
}

void main() {
  late Drift db;

  setUpAll(() async {
    db = Drift(DatabaseConnection(NativeDatabase.memory(), closeStreamsSynchronously: true));
    await StoreService.init(storeRepository: DriftStoreRepository(db));
  });

  setUp(() async {
    await Store.clear();
    await Store.put(StoreKey.serverEndpoint, 'https://demo.opennoodle.de/api');
    NetworkRepository.debugReset();
    NetworkRepository.debugClientPointer = () async => 1;
  });

  tearDown(() => NetworkRepository.debugReset());

  tearDownAll(() async => db.close());

  test('refreshConnection rebuilds the client and re-points the API client', () async {
    var built = 0;
    final clients = <_FakeClient>[];
    NetworkRepository.debugBaseClientFactory = (Pointer<Void> _) {
      built++;
      final client = _FakeClient();
      clients.add(client);
      return client;
    };
    await NetworkRepository.init();

    final api = ApiService();
    expect(api.usersApi.apiClient.client, same(clients.first));

    await api.refreshConnection();

    expect(built, 2);
    expect(NetworkRepository.client, same(clients.last));
    expect(api.usersApi.apiClient.client, same(clients.last));
  });
}
