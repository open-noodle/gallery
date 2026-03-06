import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/providers/api.provider.dart';
import 'package:immich_mobile/repositories/api.repository.dart';
import 'package:openapi/api.dart';

final sharedSpaceApiRepositoryProvider = Provider(
  (ref) => SharedSpaceApiRepository(ref.watch(apiServiceProvider).sharedSpacesApi),
);

class SharedSpaceApiRepository extends ApiRepository {
  final SharedSpacesApi _api;

  SharedSpaceApiRepository(this._api);

  Future<List<SharedSpaceResponseDto>> getAll() async {
    final response = await checkNull(_api.getAllSpaces());
    return response;
  }

  Future<SharedSpaceResponseDto> get(String id) async {
    return await checkNull(_api.getSpace(id));
  }

  Future<SharedSpaceResponseDto> create(String name, {String? description}) async {
    final dto = SharedSpaceCreateDto(name: name, description: description);
    return await checkNull(_api.createSpace(dto));
  }

  Future<void> delete(String id) => _api.removeSpace(id);

  Future<List<SharedSpaceMemberResponseDto>> getMembers(String id) async {
    final response = await checkNull(_api.getMembers(id));
    return response;
  }

  Future<SharedSpaceMemberResponseDto> addMember(
    String spaceId,
    String userId, {
    SharedSpaceRole role = SharedSpaceRole.viewer,
  }) async {
    final dto = SharedSpaceMemberCreateDto(userId: userId, role: role);
    return await checkNull(_api.addMember(spaceId, dto));
  }

  Future<void> removeMember(String spaceId, String userId) => _api.removeMember(spaceId, userId);
}
