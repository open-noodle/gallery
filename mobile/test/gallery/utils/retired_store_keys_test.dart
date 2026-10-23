import 'package:drift/drift.dart' hide isNull;
import 'package:drift/native.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:immich_mobile/data/db/main/database.dart';
import 'package:immich_mobile/data/db/main/table/app/store.drift.dart';
import 'package:immich_mobile/domain/models/store.model.dart';
import 'package:immich_mobile/domain/services/store.service.dart';
import 'package:immich_mobile/entities/store.entity.dart';
import 'package:immich_mobile/gallery/utils/retired_store_keys.dart';
import 'package:immich_mobile/infrastructure/repositories/settings.repository.dart';
import 'package:immich_mobile/infrastructure/repositories/store.repository.dart';
import 'package:immich_mobile/platform/native_sync_api.g.dart';
import 'package:immich_mobile/platform/permission_api.g.dart';
import 'package:immich_mobile/utils/migration.dart';

// Slice 5, "Old settings" (specs/2026-10-23-mobile-search-redesign-design.md): after upgrading, the old filter sheet's
// hidden-sections and collapsed-sections settings (and the search preview switch) are removed, and nothing reads them.

const _collapsedSections = 143;
const _hiddenSections = 144;
const _searchPreview = 145;

void main() {
  late Drift db;
  late StoreService storeService;

  setUpAll(() async {
    db = Drift(DatabaseConnection(NativeDatabase.memory(), closeStreamsSynchronously: true));
    storeService = await StoreService.init(storeRepository: StoreRepository(db), listenUpdates: false);
    await SettingsRepository.ensureInitialized(db);
  });

  tearDownAll(() async {
    await storeService.dispose();
    await db.close();
  });

  Future<void> seed(int id, {int? intValue, String? stringValue}) => db.storeEntity.insertOnConflictUpdate(
    StoreEntityCompanion(id: Value(id), intValue: Value(intValue), stringValue: Value(stringValue)),
  );

  Future<Set<int>> storedIds() async => {for (final row in await db.storeEntity.select().get()) row.id};

  test('an upgraded install loses the old sheet settings and the preview switch, and keeps the rest', () async {
    await Store.put(StoreKey.version, targetVersion);
    await Store.put(StoreKey.serverEndpoint, 'https://gallery.example');
    await seed(_collapsedSections, stringValue: '["people"]');
    await seed(_hiddenSections, stringValue: '["tags"]');
    await seed(_searchPreview, intValue: 1);

    await migrateDatabaseIfNeeded(db, NativeSyncApi(), PermissionApi());

    final ids = await storedIds();
    expect(ids, isNot(contains(_collapsedSections)));
    expect(ids, isNot(contains(_hiddenSections)));
    expect(ids, isNot(contains(_searchPreview)));
    expect(ids, containsAll([StoreKey.version.id, StoreKey.serverEndpoint.id]));
    expect(Store.tryGet(StoreKey.serverEndpoint), 'https://gallery.example');
  });

  test('nothing reads them: no StoreKey has a retired id, so none can be reused', () {
    expect(retiredStoreKeyIds, {_collapsedSections, _hiddenSections, _searchPreview});
    expect(StoreKey.values.map((key) => key.id).toSet().intersection(retiredStoreKeyIds), isEmpty);
  });
}
