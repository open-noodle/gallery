import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/providers/api.provider.dart';
import 'package:immich_mobile/repositories/api.repository.dart';
import 'package:immich_mobile/services/api.service.dart';
import 'package:openapi/api.dart';

final familyApiRepositoryProvider = Provider((ref) => FamilyApiRepository(ref.watch(apiServiceProvider)));

/// Thin wrapper over [FamilyApi] for the read paths the mobile UI needs. Mobile is read-only
/// for family relationships in this release (`D5`) — there is no authoring surface here, so the
/// write endpoints (unions, participants, gender, access) have no mobile caller yet.
class FamilyApiRepository extends ApiRepository {
  final ApiService _apiService;

  FamilyApiRepository(this._apiService);

  FamilyApi get _api => _apiService.familyApi;

  /// A page ceiling, mirroring [PersonApiRepository.getAllPeopleWithSharedSpaces] — guards
  /// against a server that never clears `hasNextPage` rather than expecting any real family
  /// graph to be this large.
  static const _maxPages = 100;

  /// Relation labels ("your niece") for the given ids, or `null` if the viewer has no usable
  /// family access — the feature is off instance-wide, or their effective access is `none`
  /// (`A12`). A non-null map holds an entry for every id with a recorded relationship; an id
  /// missing from the map, or present with a `null` value, has no recorded relationship.
  ///
  /// KNOWN GAP — see the slice 14 report: `GET /family/unions` keys `identities` by the
  /// server's internal family-identity id, and `PersonResponseDto` does not yet expose the
  /// identity id a person resolves to (needed by the person-page slice too, not just this
  /// one). Until that plumbing lands, this looks entries up by the id passed in directly, which
  /// only matches when a person's id happens to equal its family identity id. Today that means
  /// every resolvable face safely falls back to "no recorded relationship" (the neutral dash)
  /// rather than a wrong or fabricated label — never a crash.
  Future<Map<String, String?>?> getRelationLabels(Iterable<String> ids) async {
    final wanted = ids.toSet();
    if (wanted.isEmpty) {
      return {};
    }

    try {
      final labels = <String, String?>{};
      var page = 1;
      while (page <= _maxPages) {
        final graph = await checkNull(_api.getUnions(page: page, size: 200));
        for (final entry in graph.identities.entries) {
          if (wanted.contains(entry.key)) {
            labels[entry.key] = entry.value.label;
          }
        }
        if (!graph.hasNextPage || labels.length == wanted.length) {
          break;
        }
        page++;
      }
      return labels;
    } catch (_) {
      // No family access (403 — the feature is off, or this viewer's grant is `none`), no
      // connectivity, or any other failure: the strip must render exactly as it does today,
      // with no relation line for anyone (`A12`) — never surface an error for a feature the
      // viewer may not even know exists.
      return null;
    }
  }
}
