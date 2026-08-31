// Gallery-fork: family relationships, mobile slice 13 — the relations "provider" (Task 1).
//
// Contract: `GET /family/people/{personId}/relations` → `{ relations: [ { person:
// PersonResponseDto | null, anonymousSlot: number | null, relation: string } ] }`. `relation` is
// derived server-side relative to `{personId}` (never the viewer's root) — see
// `family_focus.model.dart` for why this replaced an earlier design that fetched
// `GET /family/unions` and joined participants on a raw `identityId` client-side (a correlation
// risk for redacted participants, and a bypass of the person/thumbnail endpoints' own
// authorization model).
//
// This endpoint has no generated `FamilyApi` method yet (dispatched to the server slice, not
// landed on this branch at the time of writing — see the report), so `FamilyApiRepository` goes
// through `ApiClient.invokeAPI` directly, exactly like every generated method does internally.
//
// A real `ApiService` cannot be constructed in a plain unit test: `setEndpoint()` assigns
// `NetworkRepository.client`, whose getter is a bare `_client!` that is only ever populated by
// `NetworkRepository.init()` (a native platform-channel call). So this stubs `ApiService` and
// hands it a real, hand-built `ApiClient` with a `MockClient` swapped in for its transport —
// real URL-building and header logic from the openapi package, no native dependency.
import 'dart:async';
import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:immich_mobile/repositories/family_api.repository.dart';
import 'package:immich_mobile/services/api.service.dart';
import 'package:mocktail/mocktail.dart';
import 'package:openapi/api.dart';

class MockApiService extends Mock implements ApiService {}

void main() {
  late MockApiService apiService;
  late ApiClient apiClient;
  late FamilyApiRepository repository;
  Uri? capturedUri;

  void stubClient(FutureOr<http.Response> Function(http.Request request) handler) {
    apiClient.client = MockClient((request) async {
      capturedUri = request.url;
      return handler(request);
    });
  }

  setUp(() {
    apiService = MockApiService();
    apiClient = ApiClient(basePath: 'http://localhost:0/api');
    when(() => apiService.apiClient).thenReturn(apiClient);
    capturedUri = null;
    repository = FamilyApiRepository(apiService);
  });

  http.Response jsonResponse(Map<String, dynamic> body, {int statusCode = 200}) =>
      http.Response(jsonEncode(body), statusCode, headers: {'content-type': 'application/json'});

  Map<String, dynamic> personJson(String id, {required String name}) => {
    'id': id,
    'name': name,
    'thumbnailPath': '',
    'isHidden': false,
  };

  Map<String, dynamic> knownRelation(String relation, {required String id, required String name}) => {
    'relation': relation,
    'person': personJson(id, name: name),
    'anonymousSlot': null,
  };

  Map<String, dynamic> anonymousRelation(String relation, {int? slot}) => {
    'relation': relation,
    'person': null,
    'anonymousSlot': slot,
  };

  group('getFocus', () {
    test('returns the relations the server reports for a person', () async {
      stubClient(
        (_) async => jsonResponse({
          'relations': [
            knownRelation('parent', id: 'ruth', name: 'Ruth'),
            knownRelation('parent', id: 'anton', name: 'Anton'),
            knownRelation('partner', id: 'oskar', name: 'Oskar'),
            knownRelation('child', id: 'juno', name: 'Juno'),
          ],
        }),
      );

      final result = await repository.getFocus('lena');

      expect(result, isA<FamilyFocusAvailable>());
      final focus = (result as FamilyFocusAvailable).focus;
      expect(focus.parents.map((p) => p.name).toSet(), {'Ruth', 'Anton'});
      expect(focus.partners.single.name, 'Oskar');
      expect(focus.children.single.name, 'Juno');
      expect(capturedUri?.path, '/api/family/people/lena/relations');
    });

    // The relation shown is relative to the page's subject, never the viewer — e.g. Lena's
    // mother reads "parent" on Lena's page even if she is "your grandmother" to whoever is
    // looking. This asserts the raw server string survives untouched onto the entry.
    test('shows each relation with its derived label', () async {
      stubClient(
        (_) async => jsonResponse({
          'relations': [knownRelation('parent', id: 'ruth', name: 'Ruth')],
        }),
      );

      final result = await repository.getFocus('lena');

      final focus = (result as FamilyFocusAvailable).focus;
      expect(focus.parents.single.relation, 'parent');
    });

    // A5: an unresolvable participant has `person: null` and an opaque `anonymousSlot` — never
    // an identity id. Proves the repository turns that into a "Someone" entry instead of
    // crashing or dropping the row (dropping would understate the family size, which the
    // visibility rule explicitly says is worse than showing "Someone").
    test('renders an anonymous participant with no identity id', () async {
      stubClient(
        (_) async => jsonResponse({
          'relations': [anonymousRelation('parent', slot: 0), knownRelation('parent', id: 'anton', name: 'Anton')],
        }),
      );

      final result = await repository.getFocus('nico');

      final focus = (result as FamilyFocusAvailable).focus;
      expect(focus.parents.length, 2);
      final anon = focus.parents.firstWhere((p) => p.isAnonymous);
      expect(anon.personId, isNull);
      expect(anon.name, isNull);
    });

    // A12, paired with the next test: `none` access must come back as a distinct, non-error
    // result type — never an empty [FamilyFocus] and never an [AsyncError].
    test('returns nothing when the viewer has no family access', () async {
      stubClient((_) async => jsonResponse({'message': 'Forbidden'}, statusCode: 403));

      final result = await repository.getFocus('lena');

      expect(result, isA<FamilyFocusUnavailable>());
    });

    test('returns relations when the viewer has view access', () async {
      stubClient(
        (_) async => jsonResponse({
          'relations': [knownRelation('parent', id: 'ruth', name: 'Ruth')],
        }),
      );

      final result = await repository.getFocus('lena');

      expect(result, isA<FamilyFocusAvailable>());
    });

    // E54: the distinction that matters. A transport failure (offline) must surface as a
    // failure the caller can tell apart from "the server said there is nothing here" — never
    // silently collapse to an empty/available result.
    test('surfaces an offline failure rather than an empty list', () async {
      apiClient.client = MockClient((_) async {
        throw http.ClientException('Failed host lookup');
      });

      // `ApiClient.invokeAPI` wraps a transport failure as `ApiException(400, ...)` (see
      // `openapi/api_client.dart`) rather than letting the raw `ClientException` through — the
      // assertion that matters is that SOME failure propagates, with a code the 403-only
      // catch in `getFocus` does not intercept, so it is never silently turned into
      // `FamilyFocusUnavailable` or an empty, "available" focus.
      await expectLater(
        repository.getFocus('lena'),
        throwsA(isA<ApiException>().having((error) => error.code, 'code', isNot(403))),
      );
    });

    test('does not crash and does not fetch the union graph', () async {
      stubClient(
        (_) async => jsonResponse({
          'relations': [anonymousRelation('parent', slot: 1)],
        }),
      );

      await repository.getFocus('lena');

      // The corrected design must go through the per-person relations endpoint, never
      // `/family/unions` (the raw-identityId-join design this replaced).
      expect(capturedUri?.path, isNot(contains('unions')));
      expect(capturedUri?.path, '/api/family/people/lena/relations');
    });
  });
}
