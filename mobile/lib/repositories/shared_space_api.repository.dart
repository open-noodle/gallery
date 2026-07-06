import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/providers/api.provider.dart';
import 'package:immich_mobile/repositories/api.repository.dart';
import 'package:immich_mobile/services/api.service.dart';
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

  /// Whether [userId] may edit Space-scoped people in [spaceId] (owner or editor role).
  /// Mirrors the web resolveSpaceEditable (person.service.ts): the server enforces the role
  /// on every write, so a membership-lookup failure fails open (returns true) rather than
  /// hiding a working action. `getMembers` only requires membership, so viewers can call it.
  Future<bool> isSpaceEditor(String spaceId, String userId) async {
    try {
      final members = await getMembers(spaceId);
      for (final member in members) {
        if (member.userId == userId) {
          return member.role == SharedSpaceRole.owner || member.role == SharedSpaceRole.editor;
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
}
