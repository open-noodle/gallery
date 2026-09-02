import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/domain/models/person.model.dart';
import 'package:immich_mobile/providers/api.provider.dart';
import 'package:immich_mobile/repositories/api.repository.dart';
import 'package:immich_mobile/services/api.service.dart';
import 'package:immich_mobile/utils/people_sort.dart';
import 'package:immich_mobile/utils/space_permissions.dart';
import 'package:openapi/api.dart';

final sharedSpaceApiRepositoryProvider = Provider((ref) => SharedSpaceApiRepository(ref.watch(apiServiceProvider)));

class SharedSpaceApiRepository extends ApiRepository {
  final ApiService _apiService;

  SharedSpaceApiRepository(this._apiService);

  // Resolved lazily on each call. `ApiService.setEndpoint()` reassigns the
  // `*Api` fields to new instances tied to a fresh ApiClient (and basePath);
  // capturing `sharedSpacesApi` once would pin this repo to a stale client if
  // the provider is first read before login (e.g. from the deep-link graph at
  // cold start).
  SharedSpacesApi get _api => _apiService.sharedSpacesApi;

  Future<List<SharedSpaceResponseDto>> getAll() async {
    final response = await checkNull(_api.getAllSpaces());
    return response;
  }

  Future<SharedSpaceResponseDto> get(String id) async {
    return await checkNull(_api.getSpace(id));
  }

  Future<SharedSpaceResponseDto> create(String name, {String? description}) async {
    final dto = SharedSpaceCreateDto(
      name: name,
      description: description == null ? const Optional.absent() : Optional.present(description),
    );
    return await checkNull(_api.createSpace(dto));
  }

  /// Update a space's name, description and/or colour (PATCH /shared-spaces/{id}).
  ///
  /// A `null` argument means **absent** — the field is left untouched. A non-null
  /// argument is sent verbatim, so `description: ''` clears the description while
  /// `description: null` leaves the existing text alone. That distinction is how a
  /// pure rename avoids clobbering a description it never showed the user.
  ///
  /// Never sends `Optional.present(null)`: `name`, `description` and `color` are
  /// `.optional()` but not `.nullable()` server-side, so an explicit null is a 400
  /// rather than a field-clear. The four fields this feature does not own
  /// (faceRecognitionEnabled, petsEnabled, thumbnailAssetId, thumbnailCropY) are
  /// left at their `Optional.absent()` defaults.
  ///
  /// Naming and appearance are editor-level server-side; the role is enforced there.
  Future<SharedSpaceResponseDto> update(String id, {String? name, String? description, UserAvatarColor? color}) async {
    final dto = SharedSpaceUpdateDto(
      name: name == null ? const Optional.absent() : Optional.present(name.trim()),
      description: description == null ? const Optional.absent() : Optional.present(description),
      color: color == null ? const Optional.absent() : Optional.present(color),
    );
    return await checkNull(_api.updateSpace(id, dto));
  }

  Future<void> delete(String id) async {
    await _api.removeSpace(id);
  }

  Future<List<SharedSpaceMemberResponseDto>> getMembers(String id) async {
    final response = await checkNull(_api.getMembers(id));
    return response;
  }

  /// Asset ids of the photos of a Space-scoped [personId] in [spaceId], from the
  /// membership-gated `GET /shared-spaces/{id}/people/{personId}/assets` endpoint (the same
  /// data the web person detail page reads for a Space person). Used by the person detail
  /// timeline because the owner-scoped local sync DB never receives a non-owned person's
  /// face→person links. Sibling of issue #727.
  Future<List<String>> getSpacePersonAssets(String spaceId, String personId) async {
    return await checkNull(_api.getSpacePersonAssets(spaceId, personId));
  }

  /// Every non-hidden person in [spaceId], from the membership-gated
  /// `GET /shared-spaces/{id}/people` endpoint — the same list the web space People tab reads.
  ///
  /// This must NOT be served by filtering [PersonApiRepository.getAllPeopleWithSharedSpaces]:
  /// `PersonResponseDto.primaryProfile` is singular, so a person who belongs to two spaces has
  /// one primary profile and would silently vanish from their non-primary space.
  ///
  /// The server applies `minimumFaceCount` from the global ML config and excludes pets unless
  /// the space enables them, so there is deliberately no client-side filtering here.
  ///
  /// [pageSize] and [maxPages] exist as test seams and are not meant to be passed in
  /// production — the runaway guard is otherwise only reachable by allocating 100 000 DTOs in
  /// a unit test. They are deliberately NOT annotated `@visibleForTesting`: that annotation
  /// targets declarations, not parameters, and an `invalid_annotation_target` info would fail
  /// `dart analyze --fatal-infos`.
  /// [pageSize] must not exceed 100: `SharedSpacePeopleQuerySchema.limit` is `.max(100)`
  /// (`server/src/dtos/shared-space.dto.ts`), and an over-cap value fails server-side validation
  /// with a 400 rather than being clamped, so the page shows its error state and never loads.
  /// Note this differs from `GET /people`, whose `size` caps at 1000 — the 1000 used by
  /// [PersonApiRepository.getAllPeopleWithSharedSpaces] is NOT a precedent for this endpoint.
  Future<List<Person>> getSpacePeople(
    String spaceId, {
    required PeopleSortBy sortBy,
    int pageSize = 100,
    int maxPages = 100,
  }) async {
    // The endpoint returns a bare array with no hasNextPage envelope, so a short page is the
    // only end-of-list signal. maxPages is a runaway guard against a server that never returns
    // one; hitting it returns what we have rather than throwing.
    final dtos = <SharedSpacePersonResponseDto>[];
    for (var page = 0; page < maxPages; page++) {
      final batch = await checkNull(
        _api.getSpacePeople(spaceId, limit: pageSize, offset: page * pageSize, withHidden: false),
      );
      dtos.addAll(batch);
      if (batch.length < pageSize) {
        break;
      }
    }

    final people = dtos.map(_toPerson).toList();
    people.sort((a, b) => comparePeople(a, b, sortBy));
    return people;
  }

  /// Maps a Space-scoped person profile onto [Person], following the precedent in
  /// `PersonApiRepository._toPerson`.
  ///
  /// A space-person profile has no favorite flag, so [Person.isFavorite] keeps its `false`
  /// default and the "favorites first" half of [comparePeople] is inert for this list.
  /// `isHidden` is not mapped because the unified model dropped it — the query above already
  /// passes `withHidden: false`, so hidden profiles never reach here.
  /// v3 openapi wraps the optional fields in `Optional<...?>` whose `.value` THROWS when
  /// absent — every read here goes through `orElse(null)`.
  static Person _toPerson(SharedSpacePersonResponseDto dto) {
    return Person(
      id: dto.id,
      updatedAt: DateTime.parse(dto.updatedAt),
      name: dto.name,
      birthDate: dto.birthDate.orElse(null),
      spaceId: dto.spaceId,
      numberOfAssets: dto.assetCount,
    );
  }

  /// Whether [userId] may edit Space-scoped people in [spaceId] (owner or editor role).
  /// Mirrors the web resolveSpaceEditable (person.service.ts): the server enforces the role
  /// on every write, so a membership-lookup failure fails open (returns true) rather than
  /// hiding a working action. `getMembers` only requires membership, so viewers can call it.
  Future<bool> isSpaceEditor(String spaceId, String userId) async {
    try {
      final members = await getMembers(spaceId);
      for (final member in members) {
        if (member.userId == userId) {
          return roleIsWritable(member.role);
        }
      }
      return false;
    } catch (_) {
      return true;
    }
  }

  /// Edits a Space-scoped person via the editor-gated shared-space endpoint. Personal/owned
  /// people must NOT use this — they go through the owner-only [PersonApiRepository.update].
  Future<SharedSpacePersonResponseDto> updateSpacePerson(
    String spaceId,
    String personId, {
    String? name,
    DateTime? birthday,
  }) async {
    final birthdayUtc = birthday == null ? null : DateTime.utc(birthday.year, birthday.month, birthday.day);
    // v3 openapi wraps the optional update fields in Optional<...?>; absent = leave unchanged.
    final dto = SharedSpacePersonUpdateDto(
      name: name == null ? const Optional.absent() : Optional.present(name),
      birthDate: birthdayUtc == null ? const Optional.absent() : Optional.present(birthdayUtc),
    );
    return await checkNull(_api.updateSpacePerson(spaceId, personId, dto));
  }

  Future<SharedSpaceMemberResponseDto> addMember(
    String spaceId,
    String userId, {
    SharedSpaceRole role = SharedSpaceRole.viewer,
  }) async {
    final dto = SharedSpaceMemberCreateDto(userId: userId, role: Optional.present(role));
    return await checkNull(_api.addMember(spaceId, dto));
  }

  Future<void> removeMember(String spaceId, String userId) async {
    await _api.removeMember(spaceId, userId);
  }

  Future<SharedSpaceMemberResponseDto> updateMember(String spaceId, String userId, SharedSpaceRole role) async {
    final dto = SharedSpaceMemberUpdateDto(role: role);
    return await checkNull(_api.updateMember(spaceId, userId, dto));
  }

  Future<SharedSpaceMemberResponseDto> updateMemberTimeline(String spaceId, {required bool showInTimeline}) async {
    final dto = SharedSpaceMemberTimelineDto(showInTimeline: showInTimeline);
    return await checkNull(_api.updateMemberTimeline(spaceId, dto));
  }

  Future<void> addAssets(String spaceId, List<String> assetIds) async {
    final dto = SharedSpaceAssetAddDto(assetIds: assetIds);
    await _api.addAssets(spaceId, dto);
  }

  Future<void> removeAssets(String spaceId, List<String> assetIds) async {
    final dto = SharedSpaceAssetRemoveDto(assetIds: assetIds);
    await _api.removeAssets(spaceId, dto);
  }

  /// Link an album to a shared space (PUT /shared-spaces/{id}/albums/{albumId}).
  /// SDK arg order is (albumId, id) where id = spaceId.
  Future<void> linkAlbum(String spaceId, String albumId) async {
    await _api.linkAlbum(albumId, spaceId);
  }

  /// Unlink an album from a shared space (DELETE /shared-spaces/{id}/albums/{albumId}).
  /// SDK arg order is (albumId, id) where id = spaceId.
  Future<void> unlinkAlbum(String spaceId, String albumId) async {
    await _api.unlinkAlbum(albumId, spaceId);
  }

  /// Update the showInTimeline flag for a space-album link
  /// (PATCH /shared-spaces/{id}/albums/{albumId}).
  Future<void> updateAlbumLink(String spaceId, String albumId, {required bool showInTimeline}) async {
    await _api.updateSharedSpaceAlbum(albumId, spaceId, SharedSpaceAlbumLinkUpdateDto(showInTimeline: showInTimeline));
  }
}
