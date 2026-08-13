import 'package:diacritic/diacritic.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/domain/models/person.model.dart';
import 'package:immich_mobile/models/photos_filter/filter_person.model.dart';
import 'package:immich_mobile/providers/infrastructure/people.provider.dart';

/// Person -> FilterPerson for the photos filter.
///
/// [FilterPerson.id] carries the **tokenized filter id** (`space-person:<id>` for a shared-space
/// person, else `person:<id>`) — the exact value the server emits as `PersonResponseDto.filterId`.
/// This is what the withSharedSpaces search expects in `personIds`: a shared-space person's raw
/// profile id is not in the owner-scoped `person` table, so a bare id resolves to nothing and the
/// person silently filters out. Tokenizing also matches the collapsed suggestions strip (which
/// always tokenizes), so the same person is never selected twice across surfaces.
///
/// [FilterPerson.spaceId] carries the Space scope so the avatar routes to the membership-gated
/// space thumbnail endpoint via getFilterPersonThumbnailUrl (the owner endpoint 404s a
/// space-person id). numberOfAssets carries straight through (no extra network call) so the
/// picker row can render a photo count.
FilterPerson _toFilterPerson(Person p) => FilterPerson(
  id: p.spaceId == null ? 'person:${p.id}' : 'space-person:${p.id}',
  name: p.name,
  birthDate: p.birthDate,
  updatedAt: p.updatedAt,
  numberOfAssets: p.numberOfAssets,
  spaceId: p.spaceId,
);

/// All non-blank people, including shared-space people (matches the web
/// People picker; see driftGetAllPeopleWithSharedSpacesProvider). Offline / server
/// failure falls back to the owner-scoped local Drift list, which leaves
/// numberOfAssets null — the picker row hides the count gracefully in that case.
/// Pinned to photoCount ordering: peopleAlphaIndex preserves input order within
/// letter buckets, so the People-view sort preference must not leak in here.
final peoplePickerAllProvider = FutureProvider.autoDispose<List<FilterPerson>>((ref) async {
  final all = await ref.watch(driftGetAllPeopleWithSharedSpacesProvider(PeopleSortBy.photoCount).future);
  // Hidden people never appear here: the server list is withHidden:false and the
  // local fallback filters isHidden in SQL.
  return all.where((p) => p.name.isNotEmpty).map(_toFilterPerson).toList();
});

/// Live search text.
final peoplePickerQueryProvider = StateProvider<String>((ref) => '');

/// Non-context-aware filter (substring match, case-insensitive).
final peoplePickerFilteredProvider = FutureProvider.autoDispose<List<FilterPerson>>((ref) async {
  final all = await ref.watch(peoplePickerAllProvider.future);
  final query = ref.watch(peoplePickerQueryProvider).trim().toLowerCase();
  if (query.isEmpty) return all;
  return all.where((p) => p.name.toLowerCase().contains(query)).toList();
});

/// ASCII-folded first-letter alpha bucket. Non-Latin / empty -> '#'. Preserves
/// input order within each bucket (stable for alpha-scrubber jumpTo).
Map<String, List<FilterPerson>> peopleAlphaIndex(List<FilterPerson> people) {
  final map = <String, List<FilterPerson>>{};
  for (final p in people) {
    final folded = p.name.isEmpty ? '' : removeDiacritics(p.name);
    final firstChar = folded.isEmpty ? '' : folded.substring(0, 1).toUpperCase();
    final key = RegExp(r'^[A-Z]$').hasMatch(firstChar) ? firstChar : '#';
    map.putIfAbsent(key, () => []).add(p);
  }
  return map;
}

/// Last-7-days-updated people, max 7 items, newest-updated first. Used by the
/// picker's "Recent" strip. Reads `updatedAt` from Drift (non-null).
final recentPeopleProvider = FutureProvider.autoDispose<List<FilterPerson>>((ref) async {
  final all = await ref.watch(peoplePickerAllProvider.future);
  final cutoff = DateTime.now().subtract(const Duration(days: 7));
  final recent = all.where((p) => (p.updatedAt ?? DateTime(1970)).isAfter(cutoff)).toList()
    ..sort((a, b) => (b.updatedAt ?? DateTime(1970)).compareTo(a.updatedAt ?? DateTime(1970)));
  return recent.take(7).toList();
});
