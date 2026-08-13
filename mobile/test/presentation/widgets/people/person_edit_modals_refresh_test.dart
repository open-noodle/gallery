import 'package:easy_localization/easy_localization.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/domain/models/person.model.dart';
import 'package:immich_mobile/domain/services/people.service.dart';
import 'package:immich_mobile/providers/infrastructure/people.provider.dart';
import 'package:immich_mobile/utils/people.utils.dart';
import 'package:mocktail/mocktail.dart';

import '../../../widget_tester_extensions.dart';

class MockDriftPeopleService extends Mock implements DriftPeopleService {}

// A mocktail Fake (not a real DriftPerson instance) for registerFallbackValue: DriftPerson
// overrides == by field equality, and mocktail's any() matcher — when a type with custom
// equality is the FIRST of two-or-more positional arguments in a stubbed call — fails to
// record the invocation ("No method stub was called from within `when()`"), regardless of
// which value is registered. This is a mocktail matcher limitation, not production
// behavior: updateName(DriftPerson, String) and updateBrithday(DriftPerson, DateTime) both
// take the DriftPerson first. A Fake fallback (mocktail's own recommended pattern for this
// exact case) sidesteps it; a real _person() instance reproduces the failure even though it
// satisfies the same interface.
class FakeDriftPerson extends Fake implements DriftPerson {}

DriftPerson _person({String id = 'p1', String? spaceId}) => DriftPerson(
  id: id,
  createdAt: DateTime(2024, 1, 1),
  updatedAt: DateTime(2024, 1, 1),
  ownerId: 'owner',
  name: 'Alice',
  isFavorite: false,
  isHidden: false,
  color: null,
  spaceId: spaceId,
);

void main() {
  late MockDriftPeopleService service;
  // Counts real fetch executions of the server-backed list — an invalidate on a
  // watched provider re-runs the override, incrementing this. Asserting counts (not
  // list contents) is deliberate: a deleted invalidation cannot pass this test.
  late int serverFetches;

  setUpAll(() {
    registerFallbackValue(FakeDriftPerson());
  });

  setUp(() {
    service = MockDriftPeopleService();
    serverFetches = 0;
  });

  List<Override> overrides() => [
    driftPeopleServiceProvider.overrideWithValue(service),
    driftGetAllPeopleWithSharedSpacesProvider.overrideWith((ref, sortBy) async {
      serverFetches++;
      return <DriftPerson>[];
    }),
    driftSpacePeopleProvider.overrideWith((ref, key) async => <DriftPerson>[]),
    driftGetAllPeopleProvider.overrideWith((ref, sortBy) async => <DriftPerson>[]),
  ];

  // Keeps the server-backed provider actively listened so invalidation triggers a
  // refetch, and exposes buttons that launch the real modal entry points.
  Widget harness(DriftPerson person) => Consumer(
    builder: (context, ref, _) {
      ref.watch(driftGetAllPeopleWithSharedSpacesProvider(PeopleSortBy.photoCount));
      return Column(
        children: [
          TextButton(
            key: const Key('open-name-modal'),
            onPressed: () => showNameEditModal(context, person),
            child: const Text('name'),
          ),
          TextButton(
            key: const Key('open-birthday-modal'),
            onPressed: () => showBirthdayEditModal(context, person),
            child: const Text('birthday'),
          ),
        ],
      );
    },
  );

  Future<void> saveName(WidgetTester tester, {String newName = 'Alicia'}) async {
    await tester.tap(find.byKey(const Key('open-name-modal')));
    await tester.pumpAndSettle();
    await tester.enterText(find.byType(TextFormField), newName);
    await tester.tap(find.text('save'.tr()));
    await tester.pumpAndSettle();
  }

  // ImmichToast schedules a 3s fluttertoast Timer outside the frame scheduler, so a plain
  // pumpAndSettle() leaves it pending and teardown fails with "A Timer is still pending"
  // (see the same pattern in space_edit_sheet_test.dart). Pump past its lifetime instead of
  // dropping the toast assertion from the widget.
  Future<void> settleToast(WidgetTester tester) async {
    await tester.pumpAndSettle();
    await tester.pump(const Duration(seconds: 4));
    await tester.pumpAndSettle();
  }

  group('rename refresh (spec 9.3-1/2)', () {
    testWidgets('a successful personal-person rename refetches the server people list and pops', (tester) async {
      when(() => service.updateName(any(), any())).thenAnswer((_) async => 1);
      await tester.pumpConsumerWidget(harness(_person()), overrides: overrides());
      expect(serverFetches, 1);

      await saveName(tester);

      verify(() => service.updateName(any(that: predicate<DriftPerson>((p) => p.id == 'p1')), 'Alicia')).called(1);
      expect(serverFetches, 2);
      expect(find.byType(AlertDialog), findsNothing);
    });

    testWidgets('a successful space-person rename refetches the server people list and pops', (tester) async {
      // Endpoint routing itself is pinned in people_service_test.dart; this pins that
      // the UI-level refresh happens for the space path too (no local write exists to
      // make any reactive list update).
      when(() => service.updateName(any(), any())).thenAnswer((_) async => 1);
      await tester.pumpConsumerWidget(
        harness(_person(id: 'sp1', spaceId: 'space-1')),
        overrides: overrides(),
      );

      await saveName(tester);

      verify(
        () => service.updateName(any(that: predicate<DriftPerson>((p) => p.spaceId == 'space-1')), 'Alicia'),
      ).called(1);
      expect(serverFetches, 2);
      expect(find.byType(AlertDialog), findsNothing);
    });
  });

  group('birthday refresh (spec 9.3-3)', () {
    Future<void> saveBirthday(WidgetTester tester) async {
      await tester.tap(find.byKey(const Key('open-birthday-modal')));
      await tester.pumpAndSettle();
      await tester.tap(find.text('save'.tr()));
      await tester.pumpAndSettle();
    }

    testWidgets('a successful birthday edit refetches the server people list and pops', (tester) async {
      when(() => service.updateBrithday(any(), any())).thenAnswer((_) async => 1);
      await tester.pumpConsumerWidget(harness(_person()), overrides: overrides());

      await saveBirthday(tester);

      verify(() => service.updateBrithday(any(), any())).called(1);
      expect(serverFetches, 2);
      expect(find.byType(AlertDialog), findsNothing);
    });

    testWidgets('a space-person birthday edit refetches the server people list', (tester) async {
      when(() => service.updateBrithday(any(), any())).thenAnswer((_) async => 1);
      await tester.pumpConsumerWidget(
        harness(_person(id: 'sp1', spaceId: 'space-1')),
        overrides: overrides(),
      );

      await saveBirthday(tester);

      expect(serverFetches, 2);
    });
  });

  group('failure paths (spec 9.3-4)', () {
    testWidgets('a zero result does not invalidate and does not pop', (tester) async {
      when(() => service.updateName(any(), any())).thenAnswer((_) async => 0);
      await tester.pumpConsumerWidget(harness(_person()), overrides: overrides());

      await saveName(tester);

      expect(serverFetches, 1);
      expect(find.byType(AlertDialog), findsOneWidget);
    });

    testWidgets('a service error does not invalidate and does not pop', (tester) async {
      when(() => service.updateName(any(), any())).thenThrow(Exception('boom'));
      await tester.pumpConsumerWidget(harness(_person()), overrides: overrides());

      await saveName(tester);
      await settleToast(tester);

      expect(serverFetches, 1);
      expect(find.byType(AlertDialog), findsOneWidget);
    });
  });
}
