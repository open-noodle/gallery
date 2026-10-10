import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/providers/server_info.provider.dart';
import 'package:immich_mobile/providers/user.provider.dart';
import 'package:immich_mobile/repositories/shared_space_api.repository.dart';
import 'package:immich_mobile/utils/semver.dart';
import 'package:openapi/api.dart';

/// Whether the connected server serves Spaces, by the same rule as the sync request list
/// (`SyncApiRepository._forkSyncTypes`): its declared sync types, else a fork version above 5.0.0.
/// True while the server version is still unknown (0.0.0), so loading and offline starts keep the
/// Spaces entry points; false once a stock Immich server is identified.
bool serverSupportsSpaces(SemVer version, Set<String>? declaredSyncTypes) {
  if (declaredSyncTypes != null) {
    return declaredSyncTypes.contains(SyncRequestType.sharedSpacesV1.toJson());
  }
  return version == const SemVer(major: 0, minor: 0, patch: 0) || version > const SemVer(major: 5, minor: 0, patch: 0);
}

final serverSupportsSpacesProvider = Provider<bool>(
  (ref) => ref.watch(
    serverInfoProvider.select((info) => serverSupportsSpaces(info.serverVersion, info.serverFeatures.syncRequestTypes)),
  ),
);

final sharedSpacesProvider = FutureProvider<List<SharedSpaceResponseDto>>((ref) async {
  // Watch current user so the provider refreshes on login/logout
  ref.watch(currentUserProvider);
  final repository = ref.watch(sharedSpaceApiRepositoryProvider);
  return repository.getAll();
});

// ignore: unused-code
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

// ignore: unused-code
final currentSpaceMemberProvider = FutureProvider.family<SharedSpaceMemberResponseDto?, String>((ref, spaceId) async {
  final members = await ref.watch(sharedSpaceMembersProvider(spaceId).future);
  final currentUser = ref.watch(currentUserProvider);
  if (currentUser == null) {
    return null;
  }
  return members.where((m) => m.userId == currentUser.id).firstOrNull;
});
