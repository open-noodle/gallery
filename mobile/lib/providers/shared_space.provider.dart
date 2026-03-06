import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/repositories/shared_space_api.repository.dart';
import 'package:openapi/api.dart';

final sharedSpacesProvider = FutureProvider<List<SharedSpaceResponseDto>>((ref) async {
  final repository = ref.watch(sharedSpaceApiRepositoryProvider);
  return repository.getAll();
});

final sharedSpaceProvider = FutureProvider.family<SharedSpaceResponseDto, String>((ref, id) async {
  final repository = ref.watch(sharedSpaceApiRepositoryProvider);
  return repository.get(id);
});

final sharedSpaceMembersProvider = FutureProvider.family<List<SharedSpaceMemberResponseDto>, String>((
  ref,
  spaceId,
) async {
  final repository = ref.watch(sharedSpaceApiRepositoryProvider);
  return repository.getMembers(spaceId);
});
