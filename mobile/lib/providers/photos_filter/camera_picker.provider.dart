import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/providers/photos_filter/filter_debounce.provider.dart';
import 'package:immich_mobile/providers/photos_filter/filter_suggestions.provider.dart';

/// Live search text for [CameraPickerPage].
final cameraPickerQueryProvider = StateProvider.autoDispose<String>((ref) => '');

/// Camera makes from the filter suggestions, filtered by the picker query
/// (substring match, case-insensitive). Models are NOT fetched here — only
/// when a make is expanded in the picker (see cameraModelSuggestionsProvider).
final cameraPickerMakesProvider = Provider.autoDispose<AsyncValue<List<String>>>((ref) {
  final filter = ref.watch(photosFilterDebouncedProvider);
  final suggestions = ref.watch(photosFilterSuggestionsProvider(filter));
  final query = ref.watch(cameraPickerQueryProvider).trim().toLowerCase();
  return suggestions.whenData((s) {
    final makes = s.cameraMakes;
    if (query.isEmpty) {
      return makes;
    }
    return makes.where((m) => m.toLowerCase().contains(query)).toList();
  });
});
