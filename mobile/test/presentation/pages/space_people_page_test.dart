import 'package:drift/drift.dart' as drift;
import 'package:drift/native.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/domain/models/person.model.dart';
import 'package:immich_mobile/domain/models/settings_key.dart';
import 'package:immich_mobile/domain/models/store.model.dart';
import 'package:immich_mobile/domain/services/store.service.dart';
import 'package:immich_mobile/entities/store.entity.dart';
import 'package:immich_mobile/infrastructure/repositories/db.repository.dart';
import 'package:immich_mobile/infrastructure/repositories/settings.repository.dart';
import 'package:immich_mobile/infrastructure/repositories/store.repository.dart';
import 'package:immich_mobile/pages/library/spaces/space_people.page.dart';
import 'package:immich_mobile/providers/infrastructure/people.provider.dart';

import '../../test_utils.dart';
import '../../widget_tester_extensions.dart';

DriftPerson _p(String id, String name, {int numberOfAssets = 0}) => DriftPerson(
  id: id,
  createdAt: DateTime(2024, 1, 1),
  updatedAt: DateTime(2024, 1, 1),
  ownerId: '',
  name: name,
  isFavorite: false,
  isHidden: false,
  color: null,
  spaceId: 'space-1',
  numberOfAssets: numberOfAssets,
);

void main() {
  // The page renders avatars (Store.get(StoreKey.serverEndpoint)) and reads the persisted
  // people sort (SettingsRepository), so both need initializing — TestUtils.init() alone is
  // not enough. Mirrors drift_people_collection_test.dart.
  late Drift db;

  setUpAll(() async {
    TestWidgetsFlutterBinding.ensureInitialized();
    TestUtils.init();
    db = Drift(drift.DatabaseConnection(NativeDatabase.memory(), closeStreamsSynchronously: true));
    await StoreService.init(storeRepository: DriftStoreRepository(db), listenUpdates: false);
    await SettingsRepository.ensureInitialized(db);
  });

  setUp(() async {
    await Store.clear();
    await SettingsRepository.instance.clear(SettingsKey.values);
    await Store.put(StoreKey.serverEndpoint, 'http://localhost:0');
  });

  tearDownAll(() async {
    await Store.clear();
    await db.close();
  });

  // NOT const: canEdit is a runtime variable here.
  Future<void> pumpPage(
    WidgetTester tester, {
    required Future<List<DriftPerson>> Function() people,
    bool canEdit = true,
  }) => tester.pumpConsumerWidget(
    SpacePeoplePage(spaceId: 'space-1', canEdit: canEdit),
    overrides: [driftSpacePeopleProvider.overrideWith((ref, key) => people())],
  );

  testWidgets('renders the space empty state when the space has no people', (tester) async {
    await pumpPage(tester, people: () async => []);

    expect(find.text('No people found'), findsOneWidget);
    expect(
      find.text('People will appear here once photos with faces are added to the space'),
      findsOneWidget,
    );
  });

  testWidgets('renders an error state with a retry action when the fetch fails', (tester) async {
    await pumpPage(tester, people: () async => throw Exception('offline'));

    expect(find.text('Error loading people'), findsOneWidget);
    expect(find.byKey(const Key('space-people-retry')), findsOneWidget);
  });

  testWidgets('retry re-runs the fetch', (tester) async {
    var calls = 0;
    await tester.pumpConsumerWidget(
      const SpacePeoplePage(spaceId: 'space-1', canEdit: true),
      overrides: [
        driftSpacePeopleProvider.overrideWith((ref, key) async {
          calls++;
          if (calls == 1) {
            throw Exception('offline');
          }
          return [_p('sp1', 'Mia')];
        }),
      ],
    );

    expect(calls, 1);
    await tester.tap(find.byKey(const Key('space-people-retry')));
    await tester.pumpAndSettle();

    expect(calls, 2);
    expect(find.text('Mia'), findsOneWidget);
  });

  testWidgets('filters client-side, ignoring diacritics', (tester) async {
    await pumpPage(tester, people: () async => [_p('sp1', 'Zoé'), _p('sp2', 'Tom')]);

    await tester.tap(find.byKey(const Key('space-people-search-toggle')));
    await tester.pumpAndSettle();
    await tester.enterText(find.byType(TextField), 'zoe');
    await tester.pumpAndSettle();

    expect(find.text('Zoé'), findsOneWidget);
    expect(find.text('Tom'), findsNothing);
  });

  testWidgets('shows the no-match state when a query matches nobody', (tester) async {
    await pumpPage(tester, people: () async => [_p('sp1', 'Mia')]);

    await tester.tap(find.byKey(const Key('space-people-search-toggle')));
    await tester.pumpAndSettle();
    await tester.enterText(find.byType(TextField), 'nobody');
    await tester.pumpAndSettle();

    // Deliberate divergence from the global People page, which shows a bare empty grid.
    expect(find.byKey(const Key('space-people-no-match')), findsOneWidget);
    // Asserts the query is actually interpolated into the message — dropping `args: {'name':
    // query}` in space_people.page.dart would leave the key assertion above green.
    expect(find.text('No people named "nobody"'), findsOneWidget);
    expect(find.text('No people found'), findsNothing);
  });

  testWidgets('re-queries and re-orders when the sort setting changes', (tester) async {
    // The sort mode is part of the provider's family key, so changing it must issue a new
    // fetch and render the new order. Mirrors the equivalent assertion on the global People
    // page (drift_people_collection_test.dart:70).
    await tester.pumpConsumerWidget(
      const SpacePeoplePage(spaceId: 'space-1', canEdit: true),
      overrides: [
        driftSpacePeopleProvider.overrideWith(
          (ref, key) async => key.sortBy == PeopleSortBy.photoCount
              ? [_p('zoe', 'Zoe'), _p('alice', 'Alice')]
              : [_p('alice', 'Alice'), _p('zoe', 'Zoe')],
        ),
      ],
    );

    double topOf(String name) => tester.getTopLeft(find.text(name)).dy;
    double leftOf(String name) => tester.getTopLeft(find.text(name)).dx;
    bool isBefore(String a, String b) =>
        topOf(a) != topOf(b) ? topOf(a) < topOf(b) : leftOf(a) < leftOf(b);

    // Default sort is photoCount → Zoe first.
    expect(isBefore('Zoe', 'Alice'), isTrue);

    await tester.tap(find.byKey(const Key('people-sort-button')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('people-sort-name')));
    await tester.pumpAndSettle();

    expect(isBefore('Alice', 'Zoe'), isTrue);
  });

  testWidgets('keeps the filter applied when the sort mode changes', (tester) async {
    await pumpPage(tester, people: () async => [_p('sp1', 'Mia', numberOfAssets: 1), _p('sp2', 'Tom')]);

    await tester.tap(find.byKey(const Key('space-people-search-toggle')));
    await tester.pumpAndSettle();
    await tester.enterText(find.byType(TextField), 'mia');
    await tester.pumpAndSettle();

    await tester.tap(find.byKey(const Key('people-sort-button')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('people-sort-name')));
    await tester.pumpAndSettle();

    // Re-sorting must not resurrect people the query filtered out.
    expect(find.text('Mia'), findsOneWidget);
    expect(find.text('Tom'), findsNothing);
  });

  testWidgets('renders tiles even when the thumbnail request fails', (tester) async {
    // TestUtils points the server endpoint at a dead port, so every RemoteImageProvider
    // fetch fails. The tile and its name must still render.
    await pumpPage(tester, people: () async => [_p('sp1', 'Mia')]);

    expect(find.text('Mia'), findsOneWidget);
  });

  group('invalidation', () {
    testWidgets('re-fetches after the space list provider is invalidated', (tester) async {
      var calls = 0;
      await tester.pumpConsumerWidget(
        const SpacePeoplePage(spaceId: 'space-1', canEdit: true),
        overrides: [
          driftSpacePeopleProvider.overrideWith((ref, key) async {
            calls++;
            return [_p('sp1', calls == 1 ? 'Mia' : 'Renamed')];
          }),
        ],
      );

      expect(find.text('Mia'), findsOneWidget);

      // Both edit modals invalidate the whole family after a successful write; renaming from
      // the GLOBAL People page must refresh this page too, which is why the shared modals —
      // not this page — own the invalidation.
      final container = ProviderScope.containerOf(tester.element(find.byType(SpacePeoplePage)));
      container.invalidate(driftSpacePeopleProvider);
      await tester.pumpAndSettle();

      expect(calls, 2);
      expect(find.text('Renamed'), findsOneWidget);
    });
  });
}
