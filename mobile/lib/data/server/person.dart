import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/data/server/api_repository.dart';
import 'package:immich_mobile/domain/models/person.model.dart';
import 'package:immich_mobile/providers/api.provider.dart';
import 'package:immich_mobile/services/api.service.dart';
import 'package:immich_mobile/utils/people_sort.dart';
import 'package:openapi/api.dart';

final personApiRepositoryProvider = Provider((ref) => PersonApiRepository(ref.watch(apiServiceProvider)));

class PersonApiRepository extends ApiRepository {
  final ApiService _apiService;

  const PersonApiRepository(this._apiService);

  PeopleApi get _api => _apiService.peopleApi;

  /// Fetches the People-page list from the server, including people the viewer can see on
  /// assets shared with them through a Space (`withSharedSpaces: true`), exactly like the
  /// web People page (`getAllPeople({ withSharedSpaces: true })`).
  ///
  /// The local sync DB is owner-scoped and never receives shared-space people, so the
  /// mobile People page must read this RBAC-projected list to stay at parity with web.
  /// This is the People-page sibling of issue #727.
  Future<List<Person>> getAllPeopleWithSharedSpaces({required PeopleSortBy sortBy}) async {
    final dtos = <PersonResponseDto>[];
    var page = 1;
    // The server pages people (default 500, max 1000 per page). Walk every page so a large
    // library isn't silently capped, matching the local query which returns all people. The
    // page ceiling guards against a server that never clears hasNextPage.
    const maxPages = 100;
    while (page <= maxPages) {
      final response = await checkNull(
        _api.getAllPeople(withSharedSpaces: true, withHidden: false, page: page, size: 1000),
      );
      dtos.addAll(response.people);
      if (response.hasNextPage.orElse(null) != true || response.people.isEmpty) {
        break;
      }
      page += 1;
    }
    // The server returns identity-projected people in name order; re-sort client-side to
    // honour the People page's sort setting, exactly like the web page (sortPeople). Mapping
    // first lets both repositories share one comparator over Person.
    final people = dtos.map(_toPerson).toList();
    people.sort((a, b) => comparePeople(a, b, sortBy));
    return people;
  }

  // The unified Person model carries no owner/created/face-asset/hidden/colour fields, and
  // updatedAt is nullable — so the epoch-0 sentinel the old two-class person mapping needed is gone.
  // v3 openapi wraps optional person fields in Optional<...?> → unwrap with orElse.
  //
  // Carry the Space scope so edits route to the editor-gated shared-space endpoint (not the
  // owner-only person endpoint) and so the page can gate the edit affordance, mirroring web
  // (person.service.ts getSpaceProfile / people/+page.svelte isSpacePrimary).
  static Person _toPerson(PersonResponseDto dto) {
    final profile = dto.primaryProfile.orElse(null);
    final spaceId = profile?.type == ScopedPrimaryProfileTypeEnum.spacePerson ? profile?.spaceId.orElse(null) : null;
    return Person(
      id: dto.id,
      name: dto.name,
      updatedAt: dto.updatedAt.orElse(null),
      birthDate: dto.birthDate,
      spaceId: spaceId,
      numberOfAssets: dto.numberOfAssets.orElse(null),
      // Sorting this list is client-side (comparePeople), so the favourite flag has to survive
      // the mapping or "favorites first" silently stops working — nothing else reads it here.
      isFavorite: dto.isFavorite.orElse(null) ?? false,
    );
  }

  /// Fetches the people visible on [assetId] from the server.
  ///
  /// The local sync DB only ever receives faces for assets the viewer owns, so for an
  /// asset shared with the viewer through a Space this must go to the server. The
  /// asset-info endpoint resolves those faces to the Space's people exactly like the web
  /// app (see `AssetService.get`), which keeps mobile at parity with web. See issue #727.
  Future<List<Person>> getAssetPeople(String assetId) async {
    final info = await checkNull(_apiService.assetsApi.getAssetInfo(assetId));
    final people = info.people.orElse(null) ?? const <PersonResponseDto>[];
    return people
        .where((person) => !person.isHidden)
        .map((person) => _toAssetPerson(person, info.resolvedSpaceId.orElse(null)))
        .toList();
  }

  // The unified Person model carries no owner/created/face-asset/hidden/colour fields, and
  // updatedAt is nullable — so the epoch-0 sentinel the old two-class person mapping needed is gone.
  // v3 openapi wraps optional person fields in Optional<...?> → unwrap with orElse.
  //
  // Face-tap → person detail: for a Space-shared person the asset-info endpoint carries the
  // space-person id (dto.spacePersonId) separately from the global identity id (dto.id), and
  // the space id lives on the asset (resolvedSpaceId). Map such a person shape-identical to
  // the People-page one — id = space-person id, spaceId set — so buildPersonTimelineRouteService
  // takes the space branch and the detail page loads photos (and the thumbnail routes to the
  // membership-gated space endpoint), mirroring web. Both ids must be present: the space assets
  // endpoint needs the (spaceId, space-person id) pair. Personal/owned people keep the global id
  // and null spaceId (owner-scoped local query + owner thumbnail). See issue #727.
  static Person _toAssetPerson(PersonResponseDto dto, String? resolvedSpaceId) {
    final spacePersonId = dto.spacePersonId.orElse(null);
    final isSpacePerson = spacePersonId != null && resolvedSpaceId != null;
    return Person(
      id: isSpacePerson ? spacePersonId : dto.id,
      name: dto.name,
      updatedAt: dto.updatedAt.orElse(null),
      birthDate: dto.birthDate,
      spaceId: isSpacePerson ? resolvedSpaceId : null,
    );
  }

  Future<void> update(String id, {String? name, DateTime? birthday}) async {
    final birthdayUtc = birthday == null ? null : DateTime.utc(birthday.year, birthday.month, birthday.day);
    final dto = PersonUpdateDto(
      name: name == null ? const Optional.absent() : Optional.present(name),
      birthDate: birthdayUtc == null ? const Optional.absent() : Optional.present(birthdayUtc),
    );
    await checkNull(_api.updatePerson(id, dto));
  }
}
