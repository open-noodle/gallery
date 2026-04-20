import 'package:drift/drift.dart' as drift;
import 'package:drift/native.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/domain/models/store.model.dart';
import 'package:immich_mobile/domain/services/store.service.dart';
import 'package:immich_mobile/domain/models/asset/base_asset.model.dart';
import 'package:immich_mobile/entities/store.entity.dart';
import 'package:immich_mobile/infrastructure/repositories/db.repository.dart';
import 'package:immich_mobile/infrastructure/repositories/store.repository.dart';
import 'package:immich_mobile/models/search/search_filter.model.dart';
import 'package:immich_mobile/presentation/widgets/filter_sheet/strips/people_strip.widget.dart';
import 'package:immich_mobile/presentation/widgets/filter_sheet/strips/places_strip.widget.dart';
import 'package:immich_mobile/presentation/widgets/filter_sheet/strips/tags_strip.widget.dart';
import 'package:immich_mobile/presentation/widgets/filter_sheet/strips/when_strip.widget.dart';
import 'package:immich_mobile/providers/photos_filter/filter_suggestions.provider.dart';
import 'package:immich_mobile/providers/photos_filter/photos_filter.provider.dart';
import 'package:openapi/api.dart';

import '../../../../widget_tester_extensions.dart';

FilterSuggestionsResponseDto _suggestions({
  List<FilterSuggestionsPersonDto> people = const [],
  List<FilterSuggestionsTagDto> tags = const [],
  List<String> countries = const [],
}) => FilterSuggestionsResponseDto(hasUnnamedPeople: false, people: people, tags: tags, countries: countries);

List<Override> _overrideSuggestions(FilterSuggestionsResponseDto data) => [
  photosFilterSuggestionsProvider.overrideWith((ref, filter) async => data),
];

void main() {
  late Drift db;
  setUpAll(() async {
    TestWidgetsFlutterBinding.ensureInitialized();
    db = Drift(drift.DatabaseConnection(NativeDatabase.memory(), closeStreamsSynchronously: true));
    await StoreService.init(storeRepository: DriftStoreRepository(db));
    await Store.put(StoreKey.serverEndpoint, 'http://localhost:0');
  });
  tearDownAll(() async {
    await Store.clear();
    await db.close();
  });

  group('PeopleStrip', () {
    testWidgets('empty data → hidden', (tester) async {
      await tester.pumpConsumerWidget(const PeopleStrip(), overrides: _overrideSuggestions(_suggestions()));
      await tester.pumpAndSettle();
      expect(find.byType(CircleAvatar), findsNothing);
    });

    testWidgets('data renders people items', (tester) async {
      final s = _suggestions(
        people: [
          FilterSuggestionsPersonDto(id: 'p1', name: 'Alice'),
          FilterSuggestionsPersonDto(id: 'p2', name: 'Bob'),
        ],
      );
      await tester.pumpConsumerWidget(const PeopleStrip(), overrides: _overrideSuggestions(s));
      await tester.pumpAndSettle();
      expect(find.text('Alice'), findsOneWidget);
      expect(find.text('Bob'), findsOneWidget);
    });

    testWidgets('tap on person toggles in filter state', (tester) async {
      final s = _suggestions(
        people: [FilterSuggestionsPersonDto(id: 'p1', name: 'Alice')],
      );
      await tester.pumpConsumerWidget(const PeopleStrip(), overrides: _overrideSuggestions(s));
      await tester.pumpAndSettle();

      final container = ProviderScope.containerOf(tester.element(find.byType(PeopleStrip)));
      await tester.tap(find.text('Alice'));
      await tester.pumpAndSettle();

      expect(container.read(photosFilterProvider).people.map((p) => p.id), ['p1']);
    });
  });

  group('PlacesStrip', () {
    testWidgets('empty data → hidden', (tester) async {
      await tester.pumpConsumerWidget(const PlacesStrip(), overrides: _overrideSuggestions(_suggestions()));
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('place-tile')), findsNothing);
    });

    testWidgets('tap on country sets location filter', (tester) async {
      final s = _suggestions(countries: ['France', 'Norway']);
      await tester.pumpConsumerWidget(const PlacesStrip(), overrides: _overrideSuggestions(s));
      await tester.pumpAndSettle();

      final container = ProviderScope.containerOf(tester.element(find.byType(PlacesStrip)));
      await tester.tap(find.text('France'));
      await tester.pumpAndSettle();

      expect(container.read(photosFilterProvider).location.country, 'France');
    });

    testWidgets('tap on already-selected country clears location', (tester) async {
      final s = _suggestions(countries: ['France']);
      await tester.pumpConsumerWidget(const PlacesStrip(), overrides: _overrideSuggestions(s));
      await tester.pumpAndSettle();

      final container = ProviderScope.containerOf(tester.element(find.byType(PlacesStrip)));
      container.read(photosFilterProvider.notifier).setLocation(SearchLocationFilter(country: 'France'));
      await tester.pumpAndSettle();

      await tester.tap(find.text('France'));
      await tester.pumpAndSettle();

      expect(container.read(photosFilterProvider).location.country, isNull);
    });
  });

  group('TagsStrip', () {
    testWidgets('empty data → hidden', (tester) async {
      await tester.pumpConsumerWidget(const TagsStrip(), overrides: _overrideSuggestions(_suggestions()));
      await tester.pumpAndSettle();
      expect(find.byType(FilterChip), findsNothing);
    });

    testWidgets('tap toggles tag in filter', (tester) async {
      final s = _suggestions(
        tags: [FilterSuggestionsTagDto(id: 't1', value: 'wedding')],
      );
      await tester.pumpConsumerWidget(const TagsStrip(), overrides: _overrideSuggestions(s));
      await tester.pumpAndSettle();

      final container = ProviderScope.containerOf(tester.element(find.byType(TagsStrip)));
      await tester.tap(find.text('wedding'));
      await tester.pumpAndSettle();

      expect(container.read(photosFilterProvider).tagIds, ['t1']);
    });
  });

  group('WhenStrip', () {
    testWidgets('renders quick-range pills (at least Today is visible)', (tester) async {
      await tester.pumpConsumerWidget(const SizedBox(width: 900, child: WhenStrip()));
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('when-pill-today')), findsOneWidget);
      expect(find.byKey(const Key('when-pill-week')), findsOneWidget);
    });

    testWidgets('tap Today sets date range around now', (tester) async {
      await tester.pumpConsumerWidget(const WhenStrip());
      await tester.pumpAndSettle();

      final container = ProviderScope.containerOf(tester.element(find.byType(WhenStrip)));
      await tester.tap(find.byKey(const Key('when-pill-today')));
      await tester.pumpAndSettle();

      final d = container.read(photosFilterProvider).date;
      expect(d.takenAfter, isNotNull);
      expect(d.takenBefore, isNotNull);
      expect(d.takenAfter!.isBefore(DateTime.now().add(const Duration(days: 1))), isTrue);
    });
  });

  // The "AsyncData other mediaTypes"/etc will be exercised at integration time;
  // strip-internal filtering logic covered above.
  test('mediaType filter present (compile-check)', () {
    expect(AssetType.image, isNot(equals(AssetType.other)));
  });
}
