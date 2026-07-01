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
    await Store.put(StoreKey.serverEndpoint, 'http://localhost:0');
  });

  tearDownAll(() async {
    await Store.clear();
    await db.close();
  });

  group('getFaceThumbnailUrl', () {
    test('builds the owner-only person thumbnail endpoint', () {
      expect(getFaceThumbnailUrl('person-1'), 'http://localhost:0/people/person-1/thumbnail');
    });
  });

  group('getSpacePersonThumbnailUrl', () {
    test('builds the membership-gated space person thumbnail endpoint', () {
      expect(
        getSpacePersonThumbnailUrl('space-1', 'space-person-1'),
        'http://localhost:0/shared-spaces/space-1/people/space-person-1/thumbnail',
      );
    });
  });

  group('getPersonThumbnailUrl', () {
    test('routes a personal person (null spaceId) to the owner endpoint', () {
      expect(getPersonThumbnailUrl('person-1'), 'http://localhost:0/people/person-1/thumbnail');
    });

    test('routes a space person (non-null spaceId) to the space endpoint', () {
      expect(
        getPersonThumbnailUrl('space-person-1', spaceId: 'space-1'),
        'http://localhost:0/shared-spaces/space-1/people/space-person-1/thumbnail',
      );
    });
  });
}
