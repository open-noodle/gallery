import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/domain/models/tag.model.dart';
import 'package:immich_mobile/providers/infrastructure/tag.provider.dart';

/// Live search text for the Tags picker.
final tagsPickerQueryProvider = StateProvider.autoDispose<String>((ref) => '');

/// The full tag list (sourced from [tagProvider], NOT the context-narrowed
/// suggestions provider), sorted by full-path value (case-insensitive) and
/// filtered by [tagsPickerQueryProvider] via a substring match over the
/// full-path value.
final tagsPickerFilteredProvider = FutureProvider.autoDispose<List<Tag>>((ref) async {
  final all = (await ref.watch(tagProvider.future)).toList()
    ..sort((a, b) => a.value.toLowerCase().compareTo(b.value.toLowerCase()));
  final query = ref.watch(tagsPickerQueryProvider).trim().toLowerCase();
  if (query.isEmpty) return all;
  return all.where((t) => t.value.toLowerCase().contains(query)).toList();
});
