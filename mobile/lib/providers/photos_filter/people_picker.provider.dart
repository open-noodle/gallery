import 'package:diacritic/diacritic.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/domain/models/person.model.dart';
import 'package:immich_mobile/providers/infrastructure/people.provider.dart';

/// DriftPerson -> PersonDto. thumbnailPath is intentionally empty — thumbnails
/// are fetched lazily via getFaceThumbnailUrl(id) at the widget layer, matching
/// PeopleStrip._PersonTile.
PersonDto _toPersonDto(DriftPerson p) => PersonDto(
  id: p.id,
  name: p.name,
  isHidden: p.isHidden,
  thumbnailPath: '',
  birthDate: p.birthDate,
  updatedAt: p.updatedAt,
);

/// All non-hidden, non-blank people sourced from local Drift (see plan
/// §"Design deviation: local Drift, not server pagination").
final peoplePickerAllProvider = FutureProvider.autoDispose<List<PersonDto>>((ref) async {
  final all = await ref.watch(driftGetAllPeopleProvider.future);
  return all.where((p) => !p.isHidden && p.name.isNotEmpty).map(_toPersonDto).toList();
});

/// Live search text.
final peoplePickerQueryProvider = StateProvider<String>((ref) => '');

/// Non-context-aware filter (substring match, case-insensitive).
final peoplePickerFilteredProvider = FutureProvider.autoDispose<List<PersonDto>>((ref) async {
  final all = await ref.watch(peoplePickerAllProvider.future);
  final query = ref.watch(peoplePickerQueryProvider).trim().toLowerCase();
  if (query.isEmpty) return all;
  return all.where((p) => p.name.toLowerCase().contains(query)).toList();
});

/// ASCII-folded first-letter alpha bucket. Non-Latin / empty -> '#'. Preserves
/// input order within each bucket (stable for alpha-scrubber jumpTo).
Map<String, List<PersonDto>> peopleAlphaIndex(List<PersonDto> people) {
  final map = <String, List<PersonDto>>{};
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
final recentPeopleProvider = FutureProvider.autoDispose<List<PersonDto>>((ref) async {
  final all = await ref.watch(peoplePickerAllProvider.future);
  final cutoff = DateTime.now().subtract(const Duration(days: 7));
  final recent = all.where((p) => (p.updatedAt ?? DateTime(1970)).isAfter(cutoff)).toList()
    ..sort((a, b) => (b.updatedAt ?? DateTime(1970)).compareTo(a.updatedAt ?? DateTime(1970)));
  return recent.take(7).toList();
});
