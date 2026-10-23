import 'package:drift/drift.dart';
import 'package:immich_mobile/data/db/main/database.dart';

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
