import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/domain/models/person.model.dart';
import 'package:immich_mobile/providers/api.provider.dart';
import 'package:immich_mobile/repositories/api.repository.dart';
import 'package:immich_mobile/services/api.service.dart';
import 'package:immich_mobile/utils/people_sort.dart';
import 'package:openapi/api.dart';

final personApiRepositoryProvider = Provider((ref) => PersonApiRepository(ref.watch(apiServiceProvider)));

class PersonApiRepository extends ApiRepository {
  final ApiService _apiService;

  PersonApiRepository(this._apiService);

  PeopleApi get _api => _apiService.peopleApi;

  Future<List<PersonDto>> getAll() async {
    final dto = await checkNull(_api.getAllPeople());
    return dto.people.map(_toPerson).toList();
  }

  /// Fetches the People-page list from the server, including people the viewer can see on
  /// assets shared with them through a Space (`withSharedSpaces: true`), exactly like the
  /// web People page (`getAllPeople({ withSharedSpaces: true })`).
  ///
  /// The local sync DB is owner-scoped and never receives shared-space people, so the
  /// mobile People page must read this RBAC-projected list to stay at parity with web.
  /// This is the People-page sibling of issue #727.
  Future<List<DriftPerson>> getAllPeopleWithSharedSpaces({required PeopleSortBy sortBy}) async {
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
    // first lets both repositories share one comparator over DriftPerson.
    final people = dtos.map(_personToDriftPerson).toList();
    people.sort((a, b) => comparePeople(a, b, sortBy));
    return people;
  }

  static DriftPerson _personToDriftPerson(PersonResponseDto dto) {
    // The people endpoint does not carry created/faceAsset/ownerId; the People grid only
    // needs id/name/thumbnail (edits are sent to the server by id), so mirror updatedAt and
    // leave ownerId unset for these server-resolved (possibly non-owned) people.
    // v3 openapi wraps optional person fields in Optional<...?> → unwrap with orElse.
    final updatedAt = dto.updatedAt.orElse(null) ?? DateTime.fromMillisecondsSinceEpoch(0);
    // Carry the Space scope so edits route to the editor-gated shared-space endpoint (not the
    // owner-only person endpoint) and so the page can gate the edit affordance, mirroring web
    // (person.service.ts getSpaceProfile / people/+page.svelte isSpacePrimary).
    final profile = dto.primaryProfile.orElse(null);
    final spaceId = profile?.type == ScopedPrimaryProfileTypeEnum.spacePerson ? profile?.spaceId.orElse(null) : null;
    return DriftPerson(
      id: dto.id,
      createdAt: updatedAt,
      updatedAt: updatedAt,
      ownerId: '',
      name: dto.name,
      isFavorite: dto.isFavorite.orElse(null) ?? false,
      isHidden: dto.isHidden,
      color: dto.color.orElse(null),
      birthDate: dto.birthDate,
      spaceId: spaceId,
      numberOfAssets: dto.numberOfAssets.orElse(null),
    );
  }

  /// Fetches the people visible on [assetId] from the server.
  ///
  /// The local sync DB only ever receives faces for assets the viewer owns, so for an
  /// asset shared with the viewer through a Space this must go to the server. The
  /// asset-info endpoint resolves those faces to the Space's people exactly like the web
  /// app (see `AssetService.get`), which keeps mobile at parity with web. See issue #727.
  Future<List<DriftPerson>> getAssetPeople(String assetId) async {
    final info = await checkNull(_apiService.assetsApi.getAssetInfo(assetId));
    final people = info.people.orElse(null) ?? const <PersonResponseDto>[];
    return people
        .where((person) => !person.isHidden)
        .map((person) => _toDriftPerson(person, info.ownerId, info.resolvedSpaceId.orElse(null)))
        .toList();
  }

  static DriftPerson _toDriftPerson(PersonResponseDto dto, String ownerId, String? resolvedSpaceId) {
    // The asset-info DTO does not carry created/faceAsset fields; the people strip does
    // not render them, so mirror updatedAt and leave the face-asset unset.
    // v3 openapi wraps optional person fields in Optional<...?> → unwrap with orElse.
    final updatedAt = dto.updatedAt.orElse(null) ?? DateTime.fromMillisecondsSinceEpoch(0);
    // Face-tap → person detail: for a Space-shared person the asset-info endpoint carries the
    // space-person id (dto.spacePersonId) separately from the global identity id (dto.id), and
    // the space id lives on the asset (resolvedSpaceId). Map such a person shape-identical to
    // the People-page one — id = space-person id, spaceId set — so buildPersonTimelineRouteService
    // takes the space branch and the detail page loads photos (and the thumbnail routes to the
    // membership-gated space endpoint), mirroring web. Both ids must be present: the space assets
    // endpoint needs the (spaceId, space-person id) pair. Personal/owned people keep the global id
    // and null spaceId (owner-scoped local query + owner thumbnail). See issue #727.
    final spacePersonId = dto.spacePersonId.orElse(null);
    final isSpacePerson = spacePersonId != null && resolvedSpaceId != null;
    // TODO(family-relationships): `PersonResponseDto.familyRelationLabel` is landing on the
    // server (an `Optional<String?>`, absent when the viewer has no family access, present
    // with `null` when access is granted but no relationship is recorded, present with a
    // string otherwise — never computed client-side). The generated SDK on this branch does
    // not have the field yet; once `make open-api-dart` picks it up, replace the two lines
    // below with:
    //   hasFamilyAccess: dto.familyRelationLabel.isPresent,
    //   familyRelationLabel: dto.familyRelationLabel.orElse(null),
    // Do not derive this by fetching `/family/unions` and joining client-side — the person id
    // is deliberately not correlatable to a family identity for privacy reasons.
    const hasFamilyAccess = false;
    const familyRelationLabel = null;
    return DriftPerson(
      id: isSpacePerson ? spacePersonId : dto.id,
      createdAt: updatedAt,
      updatedAt: updatedAt,
      ownerId: ownerId,
      name: dto.name,
      isFavorite: dto.isFavorite.orElse(null) ?? false,
      isHidden: dto.isHidden,
      color: dto.color.orElse(null),
      birthDate: dto.birthDate,
      spaceId: isSpacePerson ? resolvedSpaceId : null,
      hasFamilyAccess: hasFamilyAccess,
      familyRelationLabel: familyRelationLabel,
    );
  }

  Future<PersonDto> update(String id, {String? name, DateTime? birthday}) async {
    final birthdayUtc = birthday == null ? null : DateTime.utc(birthday.year, birthday.month, birthday.day);
    final dto = PersonUpdateDto(
      name: name == null ? const Optional.absent() : Optional.present(name),
      birthDate: birthdayUtc == null ? const Optional.absent() : Optional.present(birthdayUtc),
    );
    final response = await checkNull(_api.updatePerson(id, dto));
    return _toPerson(response);
  }

  static PersonDto _toPerson(PersonResponseDto dto) => PersonDto(
    birthDate: dto.birthDate,
    id: dto.id,
    isHidden: dto.isHidden,
    name: dto.name,
    thumbnailPath: dto.thumbnailPath,
  );
}
