// Gallery-fork: family relationships, mobile slice 13 — the relations provider (Task 1).
//
// Mocks `FamilyApiRepository` directly (mirrors `shared_space_provider_test.dart`'s
// `sharedSpacesProvider` tests) rather than the openapi layer: the repository already has its
// own focused coverage (`family_api_repository_test.dart`) for the JSON-parsing/graph-derivation
// mechanics. This file only proves the provider forwards what the repository reports, without
// collapsing the offline/no-access/available distinctions along the way.
import 'package:flutter_test/flutter_test.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/domain/models/family_focus.model.dart';
import 'package:immich_mobile/providers/infrastructure/family.provider.dart';
import 'package:immich_mobile/repositories/family_api.repository.dart';
import 'package:mocktail/mocktail.dart';

class MockFamilyApiRepository extends Mock implements FamilyApiRepository {}

ProviderContainer _container({required List<Override> overrides}) {
  final container = ProviderContainer(overrides: overrides);
  addTearDown(container.dispose);
  return container;
}

void main() {
  late MockFamilyApiRepository mockRepo;

  setUp(() {
    mockRepo = MockFamilyApiRepository();
  });

  group('familyFocusProvider', () {
    test('returns the relations the server reports for a person', () async {
      const focus = FamilyFocus(
        parents: [FamilyRelationEntry.known(personId: 'ruth', name: 'Ruth', relation: 'parent')],
        partners: [FamilyRelationEntry.known(personId: 'oskar', name: 'Oskar', relation: 'partner')],
        children: [FamilyRelationEntry.known(personId: 'juno', name: 'Juno', relation: 'child')],
      );
      when(() => mockRepo.getFocus('lena')).thenAnswer((_) async => const FamilyFocusAvailable(focus));

      final container = _container(overrides: [familyApiRepositoryProvider.overrideWithValue(mockRepo)]);

      final result = await container.read(familyFocusProvider('lena').future);

      expect(result, isA<FamilyFocusAvailable>());
      final available = result as FamilyFocusAvailable;
      expect(available.focus.parents.single.name, 'Ruth');
      expect(available.focus.partners.single.name, 'Oskar');
      expect(available.focus.children.single.name, 'Juno');
    });

    // E54: the distinction that matters. A repository failure (offline, or any other transport
    // error) must surface as an AsyncError, never quietly become an empty/available result —
    // otherwise a viewer who is merely offline reads their family as nonexistent.
    test('surfaces an offline failure rather than an empty list', () async {
      when(() => mockRepo.getFocus('lena')).thenThrow(Exception('Failed host lookup'));

      final container = _container(overrides: [familyApiRepositoryProvider.overrideWithValue(mockRepo)]);

      await expectLater(container.read(familyFocusProvider('lena').future), throwsA(isA<Exception>()));
    });

    // A12, paired with the next test: `none` access must come back as a distinct, non-error
    // result type — never an empty [FamilyFocus] and never an [AsyncError].
    test('returns nothing when the viewer has no family access', () async {
      when(() => mockRepo.getFocus('nico')).thenAnswer((_) async => const FamilyFocusUnavailable());

      final container = _container(overrides: [familyApiRepositoryProvider.overrideWithValue(mockRepo)]);

      final result = await container.read(familyFocusProvider('nico').future);

      expect(result, isA<FamilyFocusUnavailable>());
    });

    test('returns relations when the viewer has view access', () async {
      const focus = FamilyFocus(
        parents: [FamilyRelationEntry.known(personId: 'anton', name: 'Anton', relation: 'parent')],
        partners: [],
        children: [],
      );
      when(() => mockRepo.getFocus('nico')).thenAnswer((_) async => const FamilyFocusAvailable(focus));

      final container = _container(overrides: [familyApiRepositoryProvider.overrideWithValue(mockRepo)]);

      final result = await container.read(familyFocusProvider('nico').future);

      expect(result, isA<FamilyFocusAvailable>());
      expect((result as FamilyFocusAvailable).focus.parents.single.name, 'Anton');
    });

    test('requests focus for the given personId, keyed independently per person', () async {
      const focusA = FamilyFocus(parents: [], partners: [], children: []);
      const focusB = FamilyFocus(
        parents: [FamilyRelationEntry.known(personId: 'anton', name: 'Anton', relation: 'parent')],
        partners: [],
        children: [],
      );
      when(() => mockRepo.getFocus('person-a')).thenAnswer((_) async => const FamilyFocusAvailable(focusA));
      when(() => mockRepo.getFocus('person-b')).thenAnswer((_) async => const FamilyFocusAvailable(focusB));

      final container = _container(overrides: [familyApiRepositoryProvider.overrideWithValue(mockRepo)]);

      final resultA = await container.read(familyFocusProvider('person-a').future);
      final resultB = await container.read(familyFocusProvider('person-b').future);

      expect((resultA as FamilyFocusAvailable).focus.parents, isEmpty);
      expect((resultB as FamilyFocusAvailable).focus.parents.single.name, 'Anton');
      verify(() => mockRepo.getFocus('person-a')).called(1);
      verify(() => mockRepo.getFocus('person-b')).called(1);
    });
  });
}
