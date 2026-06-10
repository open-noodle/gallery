import 'package:drift/drift.dart';
import 'package:immich_mobile/data/db/main/dao/person.drift.dart';
import 'package:immich_mobile/data/db/main/database.dart';
import 'package:immich_mobile/data/db/main/table/people/person.drift.dart';
import 'package:immich_mobile/domain/models/asset/base_asset.model.dart';
import 'package:immich_mobile/domain/models/person.model.dart';

@DriftAccessor()
class PeopleRepository extends DatabaseAccessor<Drift> with $PeopleRepositoryMixin {
  PeopleRepository(super.attachedDatabase);

  Drift get _db => attachedDatabase;

  Future<Person?> get(String personId) async {
    final query = _db.select(_db.personEntity)..where((row) => row.id.equals(personId));

    final result = await query.getSingleOrNull();
    return result?.toDto();
  }

  Future<List<Person>> getAssetPeople(String assetId) async {
    // An asset can have multiple face records for the same person (e.g., metadata
    // imports alongside ML detections). Use a subquery instead of a join so each
    // person is returned once, regardless of how many of their faces are on the asset
    final faceQuery = _db.assetFaceEntity.selectOnly()
      ..addColumns([_db.assetFaceEntity.personId])
      ..where(
        _db.assetFaceEntity.assetId.equals(assetId) &
            _db.assetFaceEntity.isVisible.equals(true) &
            _db.assetFaceEntity.deletedAt.isNull(),
      );

    final query = _db.select(_db.personEntity)
      ..where((row) => row.id.isInQuery(faceQuery) & row.isHidden.equals(false));

    return query.map((row) => row.toDto()).get();
  }

  JoinedSelectStatement _allPeopleQuery({required int minFaces, required PeopleSortBy sortBy}) {
    final people = _db.personEntity;
    final faces = _db.assetFaceEntity;
    final assets = _db.remoteAssetEntity;

    final favoritesFirst = OrderingTerm(expression: people.isFavorite, mode: OrderingMode.desc);
    // BTRIM semantics: whitespace-only names belong to the unnamed tier.
    final namedFirst = OrderingTerm(expression: people.name.trim().equals('').not(), mode: OrderingMode.desc);
    final byFaceCount = OrderingTerm(expression: faces.id.count(), mode: OrderingMode.desc);
    final byName = OrderingTerm(expression: people.name.trim().lower());
    final byId = OrderingTerm(expression: people.id);

    return _db.select(people).join([
            innerJoin(faces, faces.personId.equalsExp(people.id)),
            innerJoin(assets, assets.id.equalsExp(faces.assetId)),
          ])
          ..where(
            people.isHidden.equals(false) &
                assets.deletedAt.isNull() &
                assets.visibility.equalsValue(AssetVisibility.timeline) &
                faces.isVisible.equals(true) &
                faces.deletedAt.isNull(),
          )
          ..groupBy([people.id], having: faces.id.count().isBiggerOrEqualValue(minFaces) | people.name.equals('').not())
          ..orderBy(switch (sortBy) {
            PeopleSortBy.photoCount => [favoritesFirst, namedFirst, byFaceCount, byName, byId],
            PeopleSortBy.name => [favoritesFirst, namedFirst, byName, byFaceCount, byId],
          });
  }

  Stream<List<Person>> watch({int minFaces = 3, PeopleSortBy sortBy = PeopleSortBy.photoCount}) {
    final people = _db.personEntity;
    return _allPeopleQuery(minFaces: minFaces, sortBy: sortBy).map((row) => row.readTable(people).toDto()).watch();
  }

  /// Kept alongside [watch] as the offline-fallback path of
  /// `getAllPeopleWithSharedSpaces` — a one-shot read has no business being a stream.
  Future<List<Person>> getAllPeople({int minFaces = 3, PeopleSortBy sortBy = PeopleSortBy.photoCount}) {
    final people = _db.personEntity;
    return _allPeopleQuery(minFaces: minFaces, sortBy: sortBy).map((row) => row.readTable(people).toDto()).get();
  }

  Future<int> updateName(String personId, String name) {
    final query = _db.update(_db.personEntity)..where((row) => row.id.equals(personId));

    return query.write(PersonEntityCompanion(name: Value(name), updatedAt: Value(DateTime.now())));
  }

  Future<int> updateBirthday(String personId, DateTime birthday) {
    final query = _db.update(_db.personEntity)..where((row) => row.id.equals(personId));

    return query.write(PersonEntityCompanion(birthDate: Value(birthday), updatedAt: Value(DateTime.now())));
  }
}

extension on PersonEntityData {
  Person toDto() => Person(id: id, updatedAt: updatedAt, name: name, birthDate: birthDate);
}
