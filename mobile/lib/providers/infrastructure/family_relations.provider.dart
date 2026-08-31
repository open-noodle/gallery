import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/providers/infrastructure/people.provider.dart';
import 'package:immich_mobile/repositories/family_api.repository.dart';

/// Relation labels ("your niece") for the faces on one asset's people strip — the mobile
/// mirror of the web asset-viewer treatment (`DetailPanelPeople.svelte`, slice 9).
///
/// `null` means the viewer has no usable family access at all (the feature is off, or their
/// effective access is `none`) — per `A12`, the strip must then render exactly as it does
/// today, with no relation line for anyone, not a locked or empty version. A non-null map is
/// keyed by person id; a person with no recorded relationship still belongs in the map, with a
/// `null` value, which the strip renders as a neutral dash rather than leaving the line blank.
///
/// Server-sourced only (`D5`) — never persisted to Drift, and re-fetched every time this
/// provider is watched.
final assetFamilyRelationLabelsProvider = FutureProvider.family<Map<String, String?>?, ({String id, String ownerId})>((
  ref,
  assetKey,
) async {
  final people = await ref.watch(driftPeopleAssetProvider(assetKey).future);
  if (people.isEmpty) {
    return {};
  }

  final repository = ref.watch(familyApiRepositoryProvider);
  return repository.getRelationLabels(people.map((person) => person.id));
});
