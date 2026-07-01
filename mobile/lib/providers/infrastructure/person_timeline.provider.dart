import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/domain/models/person.model.dart';
import 'package:immich_mobile/domain/models/timeline.model.dart';
import 'package:immich_mobile/domain/models/timeline_temporal_scope.model.dart';
import 'package:immich_mobile/domain/services/timeline.service.dart';
import 'package:immich_mobile/providers/infrastructure/people.provider.dart';
import 'package:immich_mobile/providers/infrastructure/timeline.provider.dart';
import 'package:immich_mobile/providers/user.provider.dart';

/// Asset ids of the photos of a Space-shared person, resolved by the server. The person
/// detail timeline needs this because the local sync DB is owner-scoped: a non-owned Space
/// person's face→person links never sync, so the local person query is empty. See issue #727.
final driftSharedSpacePersonAssetIdsProvider = FutureProvider.family<List<String>, ({String spaceId, String personId})>(
  (ref, key) async {
    final service = ref.watch(driftPeopleServiceProvider);
    return service.getSharedSpacePersonAssetIds(key.spaceId, key.personId);
  },
);

/// Builds the person detail timeline, routing on the person's profile exactly like the web
/// person detail page:
///
///  - A personal/owned person (null spaceId) reads the owner-scoped local Drift timeline
///    ([TimelineFactory.person]).
///  - A Space-shared person (non-null spaceId) has photos owned by another user whose
///    face→person links never sync to the viewer, so the owner-scoped query would be empty
///    ("0 items"). Instead we ask the server which Space assets contain the person and render
///    those locally-synced assets ([TimelineFactory.sharedSpacePerson]). While the fetch is in
///    flight — or if it fails — the id list is empty (an empty timeline), then the timeline
///    re-emits when the ids resolve. A Space person never falls through to the owner-scoped
///    query, so it never dead-ends on the empty local join.
TimelineService buildPersonTimelineRouteService(
  Ref ref,
  DriftPerson person,
  TimelineTemporalScope temporalScope,
  GroupAssetsBy groupBy,
) {
  final user = ref.watch(currentUserProvider);
  if (user == null) {
    throw Exception('User must be logged in to view person timeline');
  }

  final factory = ref.watch(timelineFactoryProvider);
  final spaceId = person.spaceId;
  if (spaceId != null) {
    final assetIds =
        ref.watch(driftSharedSpacePersonAssetIdsProvider((spaceId: spaceId, personId: person.id))).valueOrNull ??
        const <String>[];
    return factory.sharedSpacePerson(assetIds, groupBy: groupBy, temporalScope: temporalScope);
  }

  return factory.person(user.id, person.id, groupBy: groupBy, temporalScope: temporalScope);
}
