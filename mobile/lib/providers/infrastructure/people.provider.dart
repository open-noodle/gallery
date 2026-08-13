import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/data/server/person.dart';
import 'package:immich_mobile/domain/models/person.model.dart';
import 'package:immich_mobile/domain/services/people.service.dart';
import 'package:immich_mobile/providers/infrastructure/db.provider.dart';
import 'package:immich_mobile/providers/infrastructure/user_metadata.provider.dart';
import 'package:immich_mobile/providers/user.provider.dart';
import 'package:immich_mobile/repositories/shared_space_api.repository.dart';

final peopleServiceProvider = Provider<PeopleService>(
  (ref) => PeopleService(
    ref.watch(driftProvider).peopleRepository,
    ref.watch(personApiRepositoryProvider),
    ref.watch(sharedSpaceApiRepositoryProvider),
  ),
);

/// Whether the viewer may edit Space-scoped people in [spaceId] (owner or editor role),
/// mirroring the web People page (isSpaceEditor). Cached per space for the container lifetime
/// and re-resolved on login change; defaults to editable until resolved and fails open, since
/// the server enforces the role on every write. Personal/owned people (null spaceId) never
/// consult this — they are always editable by their owner.
final driftSpaceEditableProvider = FutureProvider.family<bool, String>((ref, spaceId) async {
  final userId = ref.watch(currentUserProvider.select((user) => user?.id));
  if (userId == null) {
    return true;
  }
  final repository = ref.watch(sharedSpaceApiRepositoryProvider);
  return repository.isSpaceEditor(spaceId, userId);
});

final peopleAssetProvider = FutureProvider.family<List<Person>, ({String id, String ownerId})>((ref, key) async {
  final service = ref.watch(peopleServiceProvider);
  final currentUserId = ref.watch(currentUserProvider.select((user) => user?.id));
  return service.getAssetPeople(key.id, ownedByCurrentUser: key.ownerId == currentUserId);
});

final getAllPeopleProvider = StreamProvider.family<List<Person>, PeopleSortBy>((ref, sortBy) async* {
  final service = ref.watch(peopleServiceProvider);
  final prefs = await ref.watch(userMetadataPreferencesProvider.future);
  yield* service.watch(minFaces: prefs?.minimumFaces ?? 3, sortBy: sortBy);
});

/// People for the global People page AND the photos-filter People picker (see
/// `peoplePickerAllProvider`) — the viewer's own people plus people on Space-shared assets,
/// matching the web People page / picker. Kept distinct from [getAllPeopleProvider] so
/// the remaining owner-scoped, local-first surface (the library people card) stays local.
/// See issue #727.
final driftGetAllPeopleWithSharedSpacesProvider = FutureProvider.family<List<Person>, PeopleSortBy>((
  ref,
  sortBy,
) async {
  final service = ref.watch(driftPeopleServiceProvider);
  final prefs = await ref.watch(userMetadataPreferencesProvider.future);
  return service.getAllPeopleWithSharedSpaces(minFaces: prefs?.minimumFaces ?? 3, sortBy: sortBy);
});

/// People scoped to one shared space, for [SpacePeoplePage] — the mobile equivalent of the web
/// space People tab.
///
/// Goes straight to [SharedSpaceApiRepository] rather than through [DriftPeopleService]: the
/// service layer exists to host the local-Drift fallback, and there is none here. Space people
/// have no local rows at all (the person/asset_face sync streams are owner-scoped), and the
/// owner-scoped local list contains people who are *not* in this space, so degrading to it
/// would be wrong rather than stale. Failures therefore surface as AsyncError.
///
/// `autoDispose` is deliberate: the route to this page (Spaces tab → space detail → app-bar
/// face icon) invalidates nothing on entry, unlike the Library tab, which the global people
/// providers sit behind and which the invalidation sites in `tab_shell.page.dart` /
/// `gallery_bottom_nav.widget.dart` cover. Without `autoDispose`, this provider would keep the
/// list it fetched for the app's whole session, so leaving and re-entering the page would
/// re-render a stale cache with no gesture to refresh it short of changing the sort mode or
/// restarting the app. `autoDispose` tears the provider down when [SpacePeoplePage] is popped
/// (its only consumer), so re-opening the page always issues a fresh fetch.
final driftSpacePeopleProvider = FutureProvider.autoDispose
    .family<List<Person>, ({String spaceId, PeopleSortBy sortBy})>((ref, key) async {
      final repository = ref.watch(sharedSpaceApiRepositoryProvider);
      return repository.getSpacePeople(key.spaceId, sortBy: key.sortBy);
    });

/// Every server-backed people list. The local list is (post-reconciliation) a Drift
/// stream and needs no invalidation — but a Drift stream can never observe a
/// server-side edit (space-person edits write nothing locally), so any surface that
/// changes people on the server, and any deliberate refresh gesture, must invalidate
/// these. Register new server-backed people providers HERE, never at call sites —
/// this list existing is what keeps the paired-invalidation trap deleted (see the
/// 2026-08-13 person-model reconciliation spec).
final serverPeopleListProviders = <ProviderOrFamily>[
  driftGetAllPeopleWithSharedSpacesProvider,
  driftSpacePeopleProvider,
];

extension InvalidateServerPeopleLists on WidgetRef {
  void invalidateServerPeopleLists() => serverPeopleListProviders.forEach(invalidate);
}
