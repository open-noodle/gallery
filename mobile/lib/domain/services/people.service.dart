import 'dart:async';

import 'package:immich_mobile/domain/models/person.model.dart';
import 'package:immich_mobile/infrastructure/repositories/people.repository.dart';
import 'package:immich_mobile/repositories/person_api.repository.dart';
import 'package:immich_mobile/repositories/shared_space_api.repository.dart';
import 'package:logging/logging.dart';

class DriftPeopleService {
  final DriftPeopleRepository _repository;
  final PersonApiRepository _personApiRepository;
  final SharedSpaceApiRepository _sharedSpaceApiRepository;
  final _log = Logger("DriftPeopleService");

  DriftPeopleService(this._repository, this._personApiRepository, this._sharedSpaceApiRepository);

  Future<DriftPerson?> get(String personId) {
    return _repository.get(personId);
  }

  Future<List<DriftPerson>> getAssetPeople(String assetId, {required bool ownedByCurrentUser}) async {
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

  Future<List<DriftPerson>> getAllPeople({int minFaces = 3, PeopleSortBy sortBy = PeopleSortBy.photoCount}) {
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
  Future<List<DriftPerson>> getAllPeopleWithSharedSpaces({
    int minFaces = 3,
    PeopleSortBy sortBy = PeopleSortBy.photoCount,
    PeopleFilterBy filterBy = PeopleFilterBy.all,
  }) async {
    try {
      return await _personApiRepository.getAllPeopleWithSharedSpaces(sortBy: sortBy, filterBy: filterBy);
    } catch (error, stackTrace) {
      // Offline / server failure: the local sync DB is owner-scoped AND has no `type` column, so
      // the fallback cannot honour filterBy at all. Returning the unfiltered local list is
      // deliberate — an empty grid under a Pets filter reads as data loss, while a
      // degraded-but-real list does not. The server already resolves the caller's minimumFaces
      // preference for the online path (see M2); the local fallback must honor it too, so thread
      // it through like the plain getAllPeople.
      _log.warning("Failed to fetch people from the server; using the local sync DB", error, stackTrace);
      return _repository.getAllPeople(minFaces: minFaces, sortBy: sortBy);
    }
  }

  /// Renames [person], routing on its profile exactly like the web People page:
  /// a Space-scoped person (spaceId != null) goes to the editor-gated shared-space endpoint
  /// with no local write (no local row exists for it); a personal/owned person goes to the
  /// owner-only person endpoint and its local Drift row is updated. Returns a non-zero value
  /// on success so callers can treat both paths uniformly.
  Future<int> updateName(DriftPerson person, String name) async {
    final spaceId = person.spaceId;
    if (spaceId != null) {
      await _sharedSpaceApiRepository.updateSpacePerson(spaceId, person.id, name: name);
      return 1;
    }
    await _personApiRepository.update(person.id, name: name);
    return _repository.updateName(person.id, name);
  }

  Future<int> updateBrithday(DriftPerson person, DateTime birthday) async {
    final spaceId = person.spaceId;
    if (spaceId != null) {
      await _sharedSpaceApiRepository.updateSpacePerson(spaceId, person.id, birthday: birthday);
      return 1;
    }
    await _personApiRepository.update(person.id, birthday: birthday);
    return _repository.updateBirthday(person.id, birthday);
  }
}
