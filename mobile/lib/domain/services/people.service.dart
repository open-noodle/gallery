import 'dart:async';

import 'package:immich_mobile/data/db/main/dao/person.dart';
import 'package:immich_mobile/data/server/person.dart';
import 'package:immich_mobile/domain/models/person.model.dart';
import 'package:logging/logging.dart';

/// Accesses People; entities mapped to assets for presence and face detection
class PeopleService {
  final PeopleRepository _repository;
  final PersonApiRepository _personApiRepository;
  final _log = Logger("DriftPeopleService");

  PeopleService(this._repository, this._personApiRepository);

  Future<Person?> get(String personId) {
    return _repository.get(personId);
  }

  Future<List<Person>> getAssetPeople(String assetId, {required bool ownedByCurrentUser}) async {
    // Faces are only synced into the local DB for assets the viewer owns. For an asset shared
    // with the viewer through a Space, fetch its (Space-resolved) people from the server so the
    // mobile app stays at parity with the web app, which resolves them on demand. See issue #727.
    if (!ownedByCurrentUser) {
      // The supplementary people strip is best-effort for non-owned assets: a transient
      // network/server failure should silently hide it (as the prior local-Drift lookup did)
      // rather than surface a visible error, so swallow the failure and return no people.
      try {
        return await _personApiRepository.getAssetPeople(assetId);
      } catch (error, stackTrace) {
        _log.warning("Failed to fetch people for non-owned asset $assetId", error, stackTrace);
        return const [];
      }
    }
    return _repository.getAssetPeople(assetId);
  }

  Stream<List<Person>> watch({int minFaces = 3, PeopleSortBy sortBy = PeopleSortBy.photoCount}) {
    return _repository.watch(minFaces: minFaces, sortBy: sortBy);
  }

  /// Kept alongside [watch] as the offline-fallback path of [getAllPeopleWithSharedSpaces].
  Future<List<Person>> getAllPeople({int minFaces = 3, PeopleSortBy sortBy = PeopleSortBy.photoCount}) {
    return _repository.getAllPeople(minFaces: minFaces, sortBy: sortBy);
  }

  Future<int> updateName(String personId, String name) async {
    await _personApiRepository.update(personId, name: name);
    return _repository.updateName(personId, name);
  }

  Future<int> updateBirthday(String personId, DateTime birthday) async {
    await _personApiRepository.update(personId, birthday: birthday);
    return _repository.updateBirthday(personId, birthday);
  }
}
