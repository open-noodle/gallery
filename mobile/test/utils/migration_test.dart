import 'package:drift/drift.dart' hide isNull;
import 'package:drift/native.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:immich_mobile/domain/models/person.model.dart';
import 'package:immich_mobile/domain/models/settings_key.dart';
import 'package:immich_mobile/domain/models/store.model.dart';
import 'package:immich_mobile/domain/services/store.service.dart';
import 'package:immich_mobile/entities/store.entity.dart';
import 'package:immich_mobile/infrastructure/entities/store.entity.drift.dart';
import 'package:immich_mobile/infrastructure/repositories/db.repository.dart';
import 'package:immich_mobile/infrastructure/repositories/settings.repository.dart';
import 'package:immich_mobile/infrastructure/repositories/store.repository.dart';
import 'package:immich_mobile/utils/migration.dart';

// The old Isar/Store-era id for `StoreKey.peopleSortBy` (fork PR #683). It was
// removed from `store.model.dart` when this branch adopted the v3
// `SettingsKey`/Drift-settings architecture, with no migration wired up to
// carry an existing value across -- see LOW #11/#13.
const _legacyPeopleSortById = 1015;

void main() {
  // `Store` (immich_mobile/entities/store.entity.dart) is a top-level `final`
  // that resolves `StoreService.I` exactly once per isolate on first access
  // and keeps that reference for the lifetime of the isolate -- so the
  // db/StoreService pair must be created ONCE for this whole file (setUpAll),
  // not per-test, or later tests would keep writing through a StoreService
  // bound to an earlier test's already-closed database. Per-test isolation is
  // achieved instead by resetting the relevant rows/keys in `setUp`.
  late Drift db;
  late StoreService storeService;

  setUpAll(() async {
    db = Drift(DatabaseConnection(NativeDatabase.memory(), closeStreamsSynchronously: true));
    storeService = await StoreService.init(storeRepository: DriftStoreRepository(db), listenUpdates: false);
    // Upstream #30072 ("do not show the whats new page on fresh login") made the
    // fresh-install branch of migrateDatabaseIfNeeded call
    // FeatureMessageService(SettingsRepository.instance), so the singleton must
    // be bound to this test's in-memory Drift before any migration runs.
    await SettingsRepository.ensureInitialized(db);
  });

  tearDownAll(() async {
    await storeService.dispose();
    await db.close();
  });

  Future<void> seedLegacyStoreInt(int id, int value) async {
    await db.storeEntity.insertOnConflictUpdate(StoreEntityCompanion(id: Value(id), intValue: Value(value)));
  }

  /// Resets the pieces `migrateDatabaseIfNeeded` touches for this key back to
  /// a known state before each test: no leftover `SettingsKey.peopleSortBy`
  /// row, no leftover legacy `Store` row, and a chosen pre-migration
  /// `StoreKey.version` (or none at all, for the fresh-install case).
  Future<void> resetMigrationState({required int? version}) async {
    await db.settingsEntity.deleteWhere((t) => t.key.equals(SettingsKey.peopleSortBy.name));
    await db.storeEntity.deleteWhere((t) => t.id.equals(_legacyPeopleSortById));
    if (version == null) {
      await Store.delete(StoreKey.version);
    } else {
      await Store.put(StoreKey.version, version);
    }
  }

  Future<PeopleSortBy?> readMigratedPeopleSortBy() async {
    final row = await (db.settingsEntity.select()
          ..where((t) => t.key.equals(SettingsKey.peopleSortBy.name)))
        .getSingleOrNull();
    if (row?.value == null) {
      return null;
    }
    return SettingsKey.peopleSortBy.decode(row!.value!);
  }

  Future<bool> legacyRowExists(int id) async {
    final row = await (db.storeEntity.select()..where((t) => t.id.equals(id))).getSingleOrNull();
    return row != null;
  }

  group('migrateDatabaseIfNeeded — peopleSortBy StoreKey -> SettingsKey (LOW #11/#13)', () {
    setUp(() => resetMigrationState(version: 25));

    test('migrates a legacy PeopleSortBy.name ordinal into SettingsKey.peopleSortBy', () async {
      await seedLegacyStoreInt(_legacyPeopleSortById, PeopleSortBy.name.index);

      await migrateDatabaseIfNeeded(db);

      expect(await readMigratedPeopleSortBy(), PeopleSortBy.name);
      expect(await legacyRowExists(_legacyPeopleSortById), isFalse, reason: 'migrated legacy row should be deleted');
    });

    test('no legacy value leaves SettingsKey.peopleSortBy unset (default preserved)', () async {
      // No row seeded for _legacyPeopleSortById.
      await migrateDatabaseIfNeeded(db);

      expect(await readMigratedPeopleSortBy(), isNull);
    });

    test('legacy ordinal out of PeopleSortBy.values range does not throw, default preserved', () async {
      await seedLegacyStoreInt(_legacyPeopleSortById, 99);

      await expectLater(migrateDatabaseIfNeeded(db), completes);

      expect(await readMigratedPeopleSortBy(), isNull);
      // Out-of-range legacy data is left behind un-migrated -- matches the
      // existing generic behavior of every other migrateEnumIndex legacy key.
      expect(await legacyRowExists(_legacyPeopleSortById), isTrue);
    });

    test('running the migration twice is idempotent', () async {
      await seedLegacyStoreInt(_legacyPeopleSortById, PeopleSortBy.name.index);

      await migrateDatabaseIfNeeded(db);
      await expectLater(migrateDatabaseIfNeeded(db), completes);

      expect(await readMigratedPeopleSortBy(), PeopleSortBy.name);
    });

    test('fresh install (no legacy Store rows, no version row) is untouched', () async {
      await resetMigrationState(version: null);

      await migrateDatabaseIfNeeded(db);

      expect(await readMigratedPeopleSortBy(), isNull);
    });
  });
}
