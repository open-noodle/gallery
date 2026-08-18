import 'package:drift/drift.dart' as drift;
import 'package:drift/native.dart';
import 'package:easy_localization/easy_localization.dart' hide TextDirection;
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/domain/models/person.model.dart';
import 'package:immich_mobile/domain/models/store.model.dart';
import 'package:immich_mobile/domain/services/store.service.dart';
import 'package:immich_mobile/entities/store.entity.dart';
import 'package:immich_mobile/generated/translations.g.dart';
import 'package:immich_mobile/infrastructure/repositories/db.repository.dart';
import 'package:immich_mobile/infrastructure/repositories/store.repository.dart';
import 'package:immich_mobile/models/photos_filter/filter_person.model.dart';
import 'package:immich_mobile/presentation/pages/photos_filter/person_picker.page.dart';
import 'package:immich_mobile/providers/infrastructure/people.provider.dart';
import 'package:immich_mobile/providers/photos_filter/people_picker.provider.dart';

import '../../../widget_tester_extensions.dart';

Person _d(String id, String name) => Person(id: id, updatedAt: DateTime(2024, 1, 1), name: name);

void main() {
  // Rendering a populated list needs a Store-backed server endpoint (via
  // `getFaceThumbnailUrl`). Set it up once for all tests in this file.
  late Drift db;
  setUpAll(() async {
    TestWidgetsFlutterBinding.ensureInitialized();
    db = Drift(drift.DatabaseConnection(NativeDatabase.memory(), closeStreamsSynchronously: true));
    await StoreService.init(storeRepository: StoreRepository(db));
    await Store.put(StoreKey.serverEndpoint, 'http://localhost:0');
  });
  tearDownAll(() async {
    await Store.clear();
    await db.close();
  });

  group('PersonPickerPage', () {
    testWidgets('renders AppBar with back icon, title key, and Done button', (tester) async {
      await tester.pumpConsumerWidget(const PersonPickerPage());
      expect(find.byIcon(Icons.arrow_back_rounded), findsOneWidget);
      expect(find.text(StaticTranslations.instance.filter_sheet_picker_people_title), findsOneWidget);
      expect(find.byKey(const Key('person-picker-done')), findsOneWidget);
    });

    testWidgets('Done button meets 48pt tap target', (tester) async {
      await tester.pumpConsumerWidget(const PersonPickerPage());
      expectTapTargetMin(tester, find.byKey(const Key('person-picker-done')));
    });

    testWidgets('Done button pops the navigator stack', (tester) async {
      // Tiny router harness — plain MaterialApp + Navigator, independent of auto_route.
      await tester.pumpConsumerWidget(
        Builder(
          builder: (context) => Scaffold(
            body: Center(
              child: TextButton(
                key: const Key('open-person-picker'),
                onPressed: () =>
                    Navigator.of(context).push(MaterialPageRoute(builder: (_) => const PersonPickerPage())),
                child: const Text('open'),
              ),
            ),
          ),
        ),
      );
      await tester.tap(find.byKey(const Key('open-person-picker')));
      await tester.pumpAndSettle();
      expect(find.byType(PersonPickerPage), findsOneWidget);

      await tester.tap(find.byKey(const Key('person-picker-done')));
      await tester.pumpAndSettle();
      expect(find.byType(PersonPickerPage), findsNothing);
    });

    testWidgets('renders correctly in dark theme', (tester) async {
      await tester.pumpConsumerWidgetDark(const PersonPickerPage());
      expect(find.byType(PersonPickerPage), findsOneWidget);
    });
  });

  group('PersonPickerPage search', () {
    testWidgets('typing updates peoplePickerQueryProvider', (tester) async {
      await tester.pumpConsumerWidget(
        const PersonPickerPage(),
        overrides: [
          driftGetAllPeopleWithSharedSpacesProvider.overrideWith(
            (ref, sortBy) async => [_d('a', 'Alice'), _d('b', 'Bob')],
          ),
        ],
      );
      await tester.pumpAndSettle();

      final container = ProviderScope.containerOf(tester.element(find.byType(PersonPickerPage)));
      await tester.enterText(find.byKey(const Key('person-picker-search-field')), 'Ali');
      await tester.pump();

      expect(container.read(peoplePickerQueryProvider), 'Ali');
    });

    testWidgets('count label reflects filtered list size', (tester) async {
      await tester.pumpConsumerWidget(
        const PersonPickerPage(),
        overrides: [
          peoplePickerFilteredProvider.overrideWith(
            (ref) async => const [
              FilterPerson(id: 'a', name: 'Alice'),
              FilterPerson(id: 'b', name: 'Bob'),
              FilterPerson(id: 'c', name: 'Carol'),
            ],
          ),
        ],
      );
      await tester.pumpAndSettle();

      expect(
        find.descendant(
          of: find.byKey(const Key('person-picker-count-label')),
          matching: find.text('filter_sheet_picker_people_count.other'.tr(namedArgs: {'count': '3'})),
        ),
        findsOneWidget,
        reason: 'Should render plural "other" variant for count=3',
      );
    });

    testWidgets('clearing the query resets provider state', (tester) async {
      await tester.pumpConsumerWidget(
        const PersonPickerPage(),
        overrides: [
          driftGetAllPeopleWithSharedSpacesProvider.overrideWith((ref, sortBy) async => [_d('a', 'Alice')]),
        ],
      );
      await tester.pumpAndSettle();

      final container = ProviderScope.containerOf(tester.element(find.byType(PersonPickerPage)));
      await tester.enterText(find.byKey(const Key('person-picker-search-field')), 'xyz');
      await tester.pump();
      expect(container.read(peoplePickerQueryProvider), 'xyz');

      await tester.enterText(find.byKey(const Key('person-picker-search-field')), '');
      await tester.pump();
      expect(container.read(peoplePickerQueryProvider), '');
    });

    testWidgets('non-matching query renders No results + Clear search, tapping clears', (tester) async {
      await tester.pumpConsumerWidget(
        const PersonPickerPage(),
        overrides: [
          driftGetAllPeopleWithSharedSpacesProvider.overrideWith((ref, sortBy) async => [_d('a', 'Alice')]),
        ],
      );
      await tester.pumpAndSettle();

      await tester.enterText(find.byKey(const Key('person-picker-search-field')), 'zzzzz');
      await tester.pumpAndSettle();

      expect(find.byKey(const Key('person-picker-clear-search')), findsOneWidget);

      final container = ProviderScope.containerOf(tester.element(find.byType(PersonPickerPage)));
      await tester.tap(find.byKey(const Key('person-picker-clear-search')));
      await tester.pumpAndSettle();

      expect(container.read(peoplePickerQueryProvider), '');
      expect(find.byKey(const Key('person-picker-clear-search')), findsNothing);
    });
  });

  group('PersonPickerPage error state', () {
    testWidgets('renders a tappable retry; tapping invalidates the provider and refetches', (tester) async {
      var calls = 0;
      await tester.pumpConsumerWidget(
        const PersonPickerPage(),
        overrides: [
          driftGetAllPeopleWithSharedSpacesProvider.overrideWith((ref, sortBy) async {
            calls++;
            if (calls == 1) {
              throw Exception('network down');
            }
            return [_d('a', 'Alice')];
          }),
        ],
      );
      await tester.pumpAndSettle();

      expect(find.byKey(const Key('person-picker-retry')), findsOneWidget);

      await tester.tap(find.byKey(const Key('person-picker-retry')));
      await tester.pumpAndSettle();

      expect(find.byKey(const Key('person-picker-retry')), findsNothing);
      expect(calls, 2);
      expect(find.text('Alice'), findsOneWidget);
    });
  });
}
