import 'package:drift/drift.dart';
import 'package:immich_mobile/data/db/main/database.dart';
import 'package:immich_mobile/domain/models/store.model.dart';
import 'package:immich_mobile/entities/store.entity.dart';

/// Store ids of fork settings the app no longer has. Their [StoreKey]s are gone, so nothing reads them; the rows are
/// deleted on startup ([deleteRetiredStoreValues]). An id stays here for good: a new key must never reuse one, or it
/// would read whatever an older build left behind.
///
/// - 143, 144: the old mobile filter sheet's collapsed and hidden sections, retired when search mode replaced the
///   sheet (specs/2026-10-23-mobile-search-redesign-design.md, "Removing the old filter sheet").
/// - 145: the "New search (preview)" switch that search mode had until it became the only search.
const retiredStoreKeyIds = <int>{143, 144, 145};

/// Deletes the stored values of [retiredStoreKeyIds]. Idempotent, so it runs on every start.
Future<void> deleteRetiredStoreValues(Drift db) =>
    db.storeEntity.deleteWhere((entity) => entity.id.isIn(retiredStoreKeyIds));

/// Fork keys that moved to the 90000 block (AGENTS.md, "Fork `StoreKey` ids"), by the id they were stored under before.
/// 142 was upstream's very next id.
final movedStoreKeys = <int, StoreKey<bool>>{142: StoreKey.autoEndpointLocationDisclosureAccepted};

/// Moves each value in [movedStoreKeys] to its key's new id, through [Store] so its cache follows, then frees the old
/// id. A value already at the new id wins. Once a current key uses an old id ([claimedIds], every [StoreKey] id by
/// default), that row is the current key's and is left alone. Idempotent, so it runs on every start.
Future<void> moveForkStoreValues(Drift db, {Set<int>? claimedIds}) async {
  final claimed = claimedIds ?? {for (final key in StoreKey.values) key.id};
  for (final MapEntry(key: oldId, value: key) in movedStoreKeys.entries) {
    if (claimed.contains(oldId)) {
      continue;
    }
    final row = await (db.storeEntity.select()..where((entity) => entity.id.equals(oldId))).getSingleOrNull();
    if (row == null) {
      continue;
    }
    if (Store.tryGet(key) == null && row.intValue != null) {
      await Store.put(key, row.intValue == 1);
    }
    await db.storeEntity.deleteWhere((entity) => entity.id.equals(oldId));
  }
}

/// The fork's store upkeep on startup: retired values deleted, moved ones moved.
Future<void> migrateForkStoreValues(Drift db) async {
  await deleteRetiredStoreValues(db);
  await moveForkStoreValues(db);
}
