import 'dart:io';

import 'package:drift/drift.dart' as drift;
import 'package:drift/native.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:immich_mobile/domain/models/store.model.dart';
import 'package:immich_mobile/domain/services/store.service.dart';
import 'package:immich_mobile/entities/store.entity.dart';
import 'package:immich_mobile/infrastructure/repositories/db.repository.dart';
import 'package:immich_mobile/infrastructure/repositories/store.repository.dart';
import 'package:immich_mobile/utils/image_url_builder.dart';

void main() {
  late Drift db;

  setUpAll(() async {
    TestWidgetsFlutterBinding.ensureInitialized();
    db = Drift(drift.DatabaseConnection(NativeDatabase.memory(), closeStreamsSynchronously: true));
    await StoreService.init(storeRepository: DriftStoreRepository(db), listenUpdates: false);
  });

  setUp(() async {
    await Store.clear();
    await Store.put(StoreKey.serverEndpoint, 'https://example.test/api');
  });

  tearDownAll(() async {
    await Store.clear();
    await db.close();
  });

  group('getGameRoundImageUrl', () {
    test('is keyed by challenge and round index only', () {
      expect(getGameRoundImageUrl('challenge-1', 0), 'https://example.test/api/games/challenge-1/rounds/0/image');
    });

    test('carries no asset id — the round must not be resolvable back to an asset', () {
      final url = getGameRoundImageUrl('challenge-1', 3);
      expect(url, contains('/games/challenge-1/rounds/3/image'));
      expect(url, isNot(contains('assets')));
    });
  });

  // The single-helper rule IS the answer-leak boundary (spec, answer-leak rules #1). A second call
  // site building this path by hand is how a future change quietly reaches for /assets/:id instead.
  test('no source file outside image_url_builder.dart constructs a game round image path', () {
    final offenders = <String>[];
    for (final entity in Directory('lib').listSync(recursive: true)) {
      if (entity is! File || !entity.path.endsWith('.dart')) continue;
      if (entity.path.endsWith('utils/image_url_builder.dart')) continue;
      if (entity.readAsStringSync().contains('/rounds/')) {
        offenders.add(entity.path);
      }
    }
    expect(offenders, isEmpty, reason: 'Use getGameRoundImageUrl instead of building the path');
  });
}
