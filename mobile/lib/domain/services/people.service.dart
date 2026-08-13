import 'dart:async';

import 'package:immich_mobile/data/db/main/dao/person.dart';
import 'package:immich_mobile/data/server/person.dart';
import 'package:immich_mobile/domain/models/person.model.dart';
import 'package:immich_mobile/repositories/shared_space_api.repository.dart';
import 'package:logging/logging.dart';

/// Accesses People; entities mapped to assets for presence and face detection
class PeopleService {
  final PeopleRepository _repository;
  final PersonApiRepository _personApiRepository;
  final SharedSpaceApiRepository _sharedSpaceApiRepository;
  final _log = Logger("DriftPeopleService");

  PeopleService(this._repository, this._personApiRepository, this._sharedSpaceApiRepository);

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

  /// Asset ids of the photos of a Space-shared [personId] in [spaceId], as resolved by the
  /// server. The person detail timeline needs this because the local sync DB is owner-scoped:
  /// a non-owned Space person's face→person links never sync, so the local person query is
  /// empty ("0 items"). The Space assets themselves DO sync locally, so the timeline renders
  /// them once the server says which ones contain the person — matching the web person detail
  /// page. This is the person-detail sibling of issue #727.
  ///
  /// Best-effort like [getAssetPeople]: a network/server failure returns an empty list so the
  /// detail page degrades to "no photos" rather than surfacing a visible error.
  Future<List<String>> getSharedSpacePersonAssetIds(String spaceId, String personId) async {
    try {
      return await _sharedSpaceApiRepository.getSpacePersonAssets(spaceId, personId);
    } catch (error, stackTrace) {
      _log.warning("Failed to fetch assets for Space person $personId in space $spaceId", error, stackTrace);
      return const [];
    }
  }

  /// People for the global People page AND the photos-filter People picker: the viewer's own
  /// people AND people on assets shared with them through a Space, matching the web People
  /// page (which calls the server with withSharedSpaces:true). The local sync DB is
  /// owner-scoped and never receives shared-space people, so this reads the server's unified,
  /// RBAC-projected list. This is the People-page sibling of issue #727.
  ///
  /// Kept separate from [getAllPeople] so the remaining owner-scoped, local-first surface (the
  /// library people card) is unaffected.
  Future<List<Person>> getAllPeopleWithSharedSpaces({
    int minFaces = 3,
    PeopleSortBy sortBy = PeopleSortBy.photoCount,
  }) async {
    try {
      return await _personApiRepository.getAllPeopleWithSharedSpaces(sortBy: sortBy);
    } catch (error, stackTrace) {
      // Offline / server failure: fall back to the owner-scoped local list so the viewer's
      // own people still render (their shared-space people are unavailable offline). The server
      // already resolves the caller's minimumFaces preference for the online path (see M2); the
      // local fallback must honor it too, so thread it through like the plain getAllPeople.
      _log.warning("Failed to fetch people from the server; using the local sync DB", error, stackTrace);
      return _repository.getAllPeople(minFaces: minFaces, sortBy: sortBy);
    }
  }

  /// Renames [person], routing on its profile exactly like the web People page:
  /// a Space-scoped person (spaceId != null) goes to the editor-gated shared-space endpoint
  /// with no local write (no local row exists for it); a personal/owned person goes to the
  /// owner-only person endpoint and its local Drift row is updated. Returns a non-zero value
  /// on success so callers can treat both paths uniformly.
  Future<int> updateName(Person person, String name) async {
    final spaceId = person.spaceId;
    if (spaceId != null) {
      await _sharedSpaceApiRepository.updateSpacePerson(spaceId, person.id, name: name);
      return 1;
    }
    await _personApiRepository.update(person.id, name: name);
    return _repository.updateName(person.id, name);
  }

  // Upstream's fix for the long-standing typo in this method's name is taken; the fork keeps
  // its signature, which needs the model rather than an id so it can route on spaceId.
  Future<int> updateBirthday(Person person, DateTime birthday) async {
    final spaceId = person.spaceId;
    if (spaceId != null) {
      await _sharedSpaceApiRepository.updateSpacePerson(spaceId, person.id, birthday: birthday);
      return 1;
    }
    await _personApiRepository.update(person.id, birthday: birthday);
    return _repository.updateBirthday(person.id, birthday);
  }
}
