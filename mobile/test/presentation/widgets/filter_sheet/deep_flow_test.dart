import 'package:drift/drift.dart' as drift;
import 'package:drift/native.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/domain/models/store.model.dart';
import 'package:immich_mobile/domain/services/store.service.dart';
import 'package:immich_mobile/entities/store.entity.dart';
import 'package:immich_mobile/infrastructure/repositories/db.repository.dart';
import 'package:immich_mobile/infrastructure/repositories/store.repository.dart';
import 'package:immich_mobile/presentation/widgets/filter_sheet/deep_content.widget.dart';
import 'package:immich_mobile/providers/photos_filter/city_suggestions.provider.dart';
import 'package:immich_mobile/providers/photos_filter/filter_suggestions.provider.dart';
import 'package:immich_mobile/providers/photos_filter/photos_filter.provider.dart';
import 'package:immich_mobile/providers/photos_filter/temporal_utils.dart';
import 'package:immich_mobile/providers/photos_filter/time_buckets.provider.dart';
import 'package:openapi/api.dart';

import '../../../widget_tester_extensions.dart';

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

  group('Deep flow', () {
    testWidgets('tap person + country + tag + star + toggle → combined SearchFilter', (tester) async {
      final controller = ScrollController();
      addTearDown(controller.dispose);
      await tester.binding.setSurfaceSize(const Size(400, 2400));
      addTearDown(() => tester.binding.setSurfaceSize(null));

      await tester.pumpConsumerWidget(
        DeepContent(scrollController: controller),
        overrides: [
          photosFilterSuggestionsProvider.overrideWith(
            (ref, filter) => Future.value(
              FilterSuggestionsResponseDto(
                hasUnnamedPeople: false,
                people: [FilterSuggestionsPersonDto(id: 'p1', name: 'Emma')],
                tags: [FilterSuggestionsTagDto(id: 't1', value: 'Travel')],
                countries: ['France'],
              ),
            ),
          ),
          citySuggestionsProvider.overrideWith(
            (ref, country) => Future.value(country == 'France' ? ['Paris'] : const <String>[]),
          ),
          timeBucketsProvider.overrideWith(
            (ref, filter) => Future.value(const <BucketLite>[
              (timeBucket: '2024-06-01', count: 12),
              (timeBucket: '2023-12-01', count: 3),
            ]),
          ),
        ],
      );
      await tester.pumpAndSettle();

      final container = ProviderScope.containerOf(tester.element(find.byType(DeepContent)));

      await tester.tap(find.byKey(const Key('people-tile-p1')));
      await tester.pumpAndSettle();

      await tester.tap(find.byKey(const Key('places-country-France')));
      await tester.pumpAndSettle();

      await tester.tap(find.byKey(const Key('places-city-Paris')));
      await tester.pumpAndSettle();

      await tester.tap(find.byKey(const Key('tag-chip-t1')));
      await tester.pumpAndSettle();

      await tester.tap(find.byKey(const Key('rating-star-4')));
      await tester.pumpAndSettle();

      await tester.tap(find.byKey(const Key('toggle-favourites')));
      await tester.pumpAndSettle();

      final filter = container.read(photosFilterProvider);
      expect(filter.people.map((p) => p.id), ['p1']);
      expect(filter.location.country, 'France');
      expect(filter.location.city, 'Paris');
      expect(filter.tagIds, contains('t1'));
      expect(filter.rating.rating, 4);
      expect(filter.display.isFavorite, isTrue);
      expect(filter.isEmpty, isFalse);
    });

    testWidgets('Reset in header clears every dimension', (tester) async {
      final controller = ScrollController();
      addTearDown(controller.dispose);
      await tester.binding.setSurfaceSize(const Size(400, 2400));
      addTearDown(() => tester.binding.setSurfaceSize(null));

      await tester.pumpConsumerWidget(
        DeepContent(scrollController: controller),
        overrides: [
          photosFilterSuggestionsProvider.overrideWith(
            (ref, filter) => Future.value(
              FilterSuggestionsResponseDto(
                hasUnnamedPeople: false,
                people: [FilterSuggestionsPersonDto(id: 'p1', name: 'Emma')],
                tags: [FilterSuggestionsTagDto(id: 't1', value: 'Travel')],
              ),
            ),
          ),
          timeBucketsProvider.overrideWith((ref, filter) => Future.value(const <BucketLite>[])),
        ],
      );
      await tester.pumpAndSettle();

      final container = ProviderScope.containerOf(tester.element(find.byType(DeepContent)));
      await tester.tap(find.byKey(const Key('people-tile-p1')));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('tag-chip-t1')));
      await tester.pumpAndSettle();
      expect(container.read(photosFilterProvider).isEmpty, isFalse);

      await tester.tap(find.byKey(const Key('deep-header-reset')));
      await tester.pumpAndSettle();

      expect(container.read(photosFilterProvider).isEmpty, isTrue);
    });
  });
}
