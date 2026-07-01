import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/data/server/person.dart';
import 'package:immich_mobile/domain/models/person.model.dart';
import 'package:immich_mobile/domain/services/people.service.dart';
import 'package:immich_mobile/providers/infrastructure/db.provider.dart';
import 'package:immich_mobile/providers/infrastructure/user_metadata.provider.dart';
import 'package:immich_mobile/providers/user.provider.dart';
import 'package:immich_mobile/repositories/shared_space_api.repository.dart';

final peopleServiceProvider = Provider<PeopleService>(
  (ref) => PeopleService(
    ref.watch(driftProvider).peopleRepository,
    ref.watch(personApiRepositoryProvider),
    ref.watch(sharedSpaceApiRepositoryProvider),
  ),
);

/// Whether the viewer may edit Space-scoped people in [spaceId] (owner or editor role),
/// mirroring the web People page (isSpaceEditor). Cached per space for the container lifetime
/// and re-resolved on login change; defaults to editable until resolved and fails open, since
/// the server enforces the role on every write. Personal/owned people (null spaceId) never
/// consult this — they are always editable by their owner.
final driftSpaceEditableProvider = FutureProvider.family<bool, String>((ref, spaceId) async {
  final userId = ref.watch(currentUserProvider.select((user) => user?.id));
  if (userId == null) {
    return true;
  }
  final repository = ref.watch(sharedSpaceApiRepositoryProvider);
  return repository.isSpaceEditor(spaceId, userId);
});

final peopleAssetProvider = FutureProvider.family<List<Person>, ({String id, String ownerId})>((
  ref,
  key,
) async {
  final service = ref.watch(peopleServiceProvider);
  final currentUserId = ref.watch(currentUserProvider.select((user) => user?.id));
  return service.getAssetPeople(key.id, ownedByCurrentUser: key.ownerId == currentUserId);
});

final getAllPeopleProvider = StreamProvider.family<List<Person>, PeopleSortBy>((ref, sortBy) async* {
  final service = ref.watch(peopleServiceProvider);
  final prefs = await ref.watch(userMetadataPreferencesProvider.future);
  yield* service.watch(minFaces: prefs?.minimumFaces ?? 3, sortBy: sortBy);
});

/// People for the global People page — the viewer's own people plus people on Space-shared
/// assets, matching the web People page. Kept distinct from [driftGetAllPeopleProvider] so
/// the owner-scoped, local-first people picker and library card stay local. See issue #727.
final driftGetAllPeopleWithSharedSpacesProvider = FutureProvider.family<List<DriftPerson>, PeopleSortBy>((
  ref,
  sortBy,
) async {
  final service = ref.watch(driftPeopleServiceProvider);
  return service.getAllPeopleWithSharedSpaces(sortBy: sortBy);
});
