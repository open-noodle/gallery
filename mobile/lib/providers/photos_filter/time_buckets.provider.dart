import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/models/search/search_filter.model.dart';
import 'package:immich_mobile/providers/api.provider.dart';
import 'package:immich_mobile/providers/photos_filter/asset_type_mapper.dart';
import 'package:immich_mobile/providers/photos_filter/temporal_utils.dart';

/// Wraps `TimelineApi.getTimeBuckets`, parametrised on the current filter.
/// Returns a list of `(timeBucket, count)` tuples that the WhenAccordionSection
/// aggregates into years/months via `temporal_utils.dart`.
///
/// NOTE: `getTimeBuckets` does not accept a text / smart-search parameter.
/// When a user has `SearchFilter.context` set, year counts reflect the rest of
/// the filter dimensions only (may overstate photos matching the text query).
/// Acceptable Phase 1 limitation — documented in the PR description.
final timeBucketsProvider = FutureProvider.autoDispose.family<List<BucketLite>, SearchFilter>((ref, filter) async {
  final api = ref.watch(apiServiceProvider).timelineApi;
  final buckets = await api.getTimeBuckets(
    country: filter.location.country,
    city: filter.location.city,
    isFavorite: filter.display.isFavorite ? true : null,
    personIds: filter.people.isEmpty ? null : filter.people.map((p) => p.id).toList(),
    rating: filter.rating.rating,
    tagIds: filter.tagIds,
    type: mapAssetType(filter.mediaType),
  );
  if (buckets == null) return const [];
  return [for (final b in buckets) (timeBucket: b.timeBucket, count: b.count)];
});
