// Gallery-fork: family relationships, mobile slice 13 (the relations "provider"). Read-only.
//
// Mirrors the shape of `SharedSpaceApiRepository.getSpacePeople` / `driftSpacePeopleProvider`:
// this repository goes straight to the API, with no Drift table and no local fallback, because
// there is none to fall back to — relations are server-sourced and deliberately not synced (see
// `family_focus.model.dart`). A failure here must surface as a failure, never as an empty focus
// (E54): the caller (`familyFocusProvider` in `providers/infrastructure/family.provider.dart`)
// relies on that distinction to tell "offline" apart from "nothing recorded".
//
// Contract: `GET /family/people/{personId}/relations` →
// `{ relations: [ { person: PersonResponseDto | null, anonymousSlot: number | null,
// relation: string } ] }`. `person` is null, with an opaque `anonymousSlot`, for a participant
// the viewer cannot resolve (A5) — never an identity id. `relation` is derived server-side
// relative to `{personId}`, not the viewer's own root.
//
// This endpoint has no generated `FamilyApi` method at the time of writing (dispatched to the
// server slice; see the report for status), so this goes through `ApiClient.invokeAPI` directly
// — exactly what every generated method does internally — rather than waiting on codegen.
// Deliberately NOT built on `GET /family/unions`: an earlier version of this file fetched the
// whole union graph and joined participants on their raw `identityId`, which both let a client
// correlate a redacted ("anonymous") participant across requests, and skipped the
// person/thumbnail endpoints' own authorization model by treating a family-graph id as
// equivalent to a person id without the server ever checking that. Do not reintroduce that path.
import 'dart:convert';

import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:http/http.dart' show Response;
import 'package:immich_mobile/domain/models/family_focus.model.dart';
import 'package:immich_mobile/providers/api.provider.dart';
import 'package:immich_mobile/services/api.service.dart';
import 'package:openapi/api.dart';

final familyApiRepositoryProvider = Provider<FamilyApiRepository>(
  (ref) => FamilyApiRepository(ref.watch(apiServiceProvider)),
);

/// `GET /family/people/{personId}/relations` responds 403 when the caller's effective family
/// access is below `view` (mirrors `FamilyService.requireFamilyRead`'s `ForbiddenException` on
/// the sibling `/family/unions` endpoint). `FamilyApiRepository.getFocus` catches exactly this
/// status and returns [FamilyFocusUnavailable] instead of letting it propagate as an
/// [ApiException] — a `none`-access viewer is an expected, successful outcome (A12), never a
/// failure.
const _forbiddenStatusCode = 403;

/// The outcome of loading one person's family focus. Deliberately NOT `FamilyFocus?` — a null
/// would conflate "the viewer can't see this feature" (A12) with "focus not loaded yet", and an
/// empty [FamilyFocus] already means "nothing recorded", so neither spare value is free to reuse
/// for "not allowed".
sealed class FamilyFocusResult {
  const FamilyFocusResult();
}

/// The viewer can see the family feature. [focus]'s lists may still be empty — that is the
/// legitimate "nothing recorded yet" state, distinct from [FamilyFocusUnavailable].
final class FamilyFocusAvailable extends FamilyFocusResult {
  const FamilyFocusAvailable(this.focus);
  final FamilyFocus focus;
}

/// The viewer's effective family access is `none`. The focus card must render no section at
/// all for this (A12) — this is a normal, successful result, never an error state.
final class FamilyFocusUnavailable extends FamilyFocusResult {
  const FamilyFocusUnavailable();
}

class FamilyApiRepository {
  final ApiService _apiService;

  FamilyApiRepository(this._apiService);

  // Resolved lazily on each call, exactly like `SharedSpaceApiRepository._api`: `ApiService`
  // reassigns the underlying `ApiClient` on `setEndpoint()`, so capturing it once would pin the
  // repository to a stale client if it's read before login.
  ApiClient get _apiClient => _apiService.apiClient;

  /// Fetches [personId]'s parents, partners and children from the server.
  Future<FamilyFocusResult> getFocus(String personId) async {
    try {
      final response = await _apiClient.invokeAPI('/family/people/$personId/relations', 'GET', [], null, {}, {}, null);
      if (response.statusCode >= 400) {
        throw ApiException(response.statusCode, await _decodeBody(response));
      }

      final body = jsonDecode(await _decodeBody(response)) as Map<String, dynamic>;
      final rawRelations = body['relations'] as List<dynamic>;
      final relations = rawRelations.map((raw) => _parseRelation(raw as Map<String, dynamic>)).toList();

      return FamilyFocusAvailable(buildFamilyFocus(relations));
    } on ApiException catch (e) {
      if (e.code == _forbiddenStatusCode) {
        return const FamilyFocusUnavailable();
      }
      rethrow;
    }
  }

  static FamilyRelationEntry _parseRelation(Map<String, dynamic> json) {
    final relation = json['relation'] as String;
    final personJson = json['person'] as Map<String, dynamic>?;
    if (personJson == null) {
      return FamilyRelationEntry.anonymous(relation: relation, anonymousSlot: json['anonymousSlot'] as int?);
    }

    final person = PersonResponseDto.fromJson(personJson)!;
    return FamilyRelationEntry.known(
      personId: person.id,
      name: person.name,
      thumbnailPath: person.thumbnailPath,
      relation: relation,
    );
  }

  /// Mirrors the generated client's own private `_decodeBodyBytes` (`api_helper.dart`): decode
  /// as UTF-8 for a JSON body so accented names round-trip correctly, otherwise fall back to
  /// `http`'s own charset-aware `.body`. Duplicated rather than imported because the generated
  /// helper is private to the `openapi.api` library.
  static Future<String> _decodeBody(Response response) async {
    final contentType = response.headers['content-type'];
    final isJson = contentType != null && contentType.toLowerCase().startsWith('application/json');
    if (!isJson) {
      return response.body;
    }
    return response.bodyBytes.isEmpty ? '' : utf8.decode(response.bodyBytes);
  }
}
