import 'dart:convert';

import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/providers/api.provider.dart';
import 'package:openapi/api.dart';

/// Returns camera model suggestions for a given make, or an empty list when
/// make is null/empty. Not debounced — a single user tap (make-expand) drives
/// re-fetch. Mirrors citySuggestionsProvider.
final cameraModelSuggestionsProvider = FutureProvider.autoDispose.family<List<String>, String?>((ref, make) async {
  if (make == null || make.isEmpty) return const <String>[];
  final api = ref.watch(apiServiceProvider).searchApi;
  final response = await api.getSearchSuggestionsWithHttpInfo(
    SearchSuggestionType.cameraModel,
    make: make,
    // Include models from shared-space assets so a non-owner viewer sees them, mirroring the
    // web filter page (map-filter-config.ts `withSharedSpaces: true`). RBAC-projected server-side.
    withSharedSpaces: true,
  );

  if (response.body.isEmpty) {
    return const <String>[];
  }

  return List<String>.from(jsonDecode(utf8.decode(response.bodyBytes)) as List);
});
