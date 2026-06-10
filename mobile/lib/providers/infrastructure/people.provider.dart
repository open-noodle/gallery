import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/domain/models/person.model.dart';
import 'package:immich_mobile/providers/infrastructure/db.provider.dart';
import 'package:immich_mobile/providers/infrastructure/user_metadata.provider.dart';

/// Fork-only: sort-keyed people stream, kept separate from `Store.people.all()` so the
/// user-controlled People view sort doesn't disturb call sites (photos-filter picker,
/// asset-details strip) that just want the unsorted local list.
final getAllPeopleProvider = StreamProvider.family<List<Person>, PeopleSortBy>((ref, sortBy) async* {
  final prefs = await ref.watch(userMetadataPreferencesProvider.future);
  yield* ref.watch(driftProvider).peopleDatabaseRepository.watch(minFaces: prefs?.minimumFaces ?? 3, sortBy: sortBy);
});
