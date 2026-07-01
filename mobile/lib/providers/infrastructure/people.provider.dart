import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/data/server/person.dart';
import 'package:immich_mobile/domain/models/person.model.dart';
import 'package:immich_mobile/domain/services/people.service.dart';
import 'package:immich_mobile/providers/infrastructure/db.provider.dart';
import 'package:immich_mobile/providers/infrastructure/user_metadata.provider.dart';
import 'package:immich_mobile/providers/user.provider.dart';

final peopleServiceProvider = Provider<PeopleService>(
  (ref) => PeopleService(ref.watch(driftProvider).peopleRepository, ref.watch(personApiRepositoryProvider)),
);

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
