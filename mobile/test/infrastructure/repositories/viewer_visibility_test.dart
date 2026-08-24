import 'package:drift/drift.dart';
import 'package:drift/native.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:immich_mobile/data/db/main/database.dart';
import 'package:immich_mobile/infrastructure/repositories/viewer_visibility.dart';

void main() {
  late Drift db;

  setUp(() {
    db = Drift(DatabaseConnection(NativeDatabase.memory(), closeStreamsSynchronously: true));
  });

  tearDown(() async {
    await db.close();
  });

  test('buildViewerVisibilityJoins returns 7 joins and all three aliased members', () {
    final spec = buildViewerVisibilityJoins(db, db.remoteAssetEntity, 'viewer-1');
    expect(spec.joins, hasLength(7));
    expect(spec.assetMember, isNot(equals(null)));
    expect(spec.libraryMember, isNot(equals(null)));
    expect(spec.albumMember, isNot(equals(null)));
    // The three aliases must be distinct instances so their column refs don't collide.
    expect(identical(spec.assetMember, spec.libraryMember), isFalse);
    expect(identical(spec.assetMember, spec.albumMember), isFalse);
    expect(identical(spec.libraryMember, spec.albumMember), isFalse);
  });

  test('viewerVisibilityPredicate returns a non-null Expression', () {
    final pred = viewerVisibilityPredicate(db, db.remoteAssetEntity, const ['user-1'], 'viewer-1');
    expect(pred, isNot(equals(null)));
  });
}
