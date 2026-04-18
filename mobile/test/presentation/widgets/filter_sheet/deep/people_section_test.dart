import 'package:drift/drift.dart' as drift;
import 'package:drift/native.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/domain/models/person.model.dart';
import 'package:immich_mobile/domain/models/store.model.dart';
import 'package:immich_mobile/domain/services/store.service.dart';
import 'package:immich_mobile/entities/store.entity.dart';
import 'package:immich_mobile/infrastructure/repositories/db.repository.dart';
import 'package:immich_mobile/infrastructure/repositories/store.repository.dart';
import 'package:immich_mobile/presentation/widgets/filter_sheet/deep/people_section.widget.dart';
import 'package:immich_mobile/providers/photos_filter/filter_suggestions.provider.dart';
import 'package:immich_mobile/providers/photos_filter/photos_filter.provider.dart';
import 'package:openapi/api.dart';

import '../../../../widget_tester_extensions.dart';

FilterSuggestionsResponseDto _sugg({List<FilterSuggestionsPersonDto>? people}) =>
    FilterSuggestionsResponseDto(hasUnnamedPeople: false, people: people ?? const []);

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

  group('PeopleSectionDeep', () {
    testWidgets('renders section title + "Search N people →" header when suggestions > 0', (tester) async {
      await tester.pumpConsumerWidget(
        const Material(child: PeopleSectionDeep(onOpenPicker: null)),
        overrides: [
          photosFilterSuggestionsProvider.overrideWith(
            (ref, filter) => Future.value(
              _sugg(
                people: [
                  FilterSuggestionsPersonDto(id: 'p1', name: 'Emma'),
                  FilterSuggestionsPersonDto(id: 'p2', name: 'Lars'),
                ],
              ),
            ),
          ),
        ],
      );
      await tester.pumpAndSettle();

      // Title uses 'filter_sheet_deep_people_section'.tr() — in a test without
      // localization init this returns the raw key. Assert on the i18n-key
      // fallback (matches sibling-test patterns).
      expect(find.text('FILTER_SHEET_DEEP_PEOPLE_SECTION'), findsOneWidget);
      expect(find.text('Emma'), findsOneWidget);
      expect(find.text('Lars'), findsOneWidget);
      expect(find.byKey(const Key('people-section-search-more')), findsOneWidget);
    });

    testWidgets('tap avatar toggles togglePerson in photosFilterProvider', (tester) async {
      await tester.pumpConsumerWidget(
        const Material(child: PeopleSectionDeep(onOpenPicker: null)),
        overrides: [
          photosFilterSuggestionsProvider.overrideWith(
            (ref, filter) => Future.value(
              _sugg(
                people: [FilterSuggestionsPersonDto(id: 'p1', name: 'Emma')],
              ),
            ),
          ),
        ],
      );
      await tester.pumpAndSettle();

      final container = ProviderScope.containerOf(tester.element(find.byType(PeopleSectionDeep)));
      await tester.tap(find.byKey(const Key('people-tile-p1')));
      await tester.pumpAndSettle();

      expect(container.read(photosFilterProvider).people.any((p) => p.id == 'p1'), isTrue);
    });

    testWidgets('empty list → empty state string and no "Search N" affordance', (tester) async {
      await tester.pumpConsumerWidget(
        const Material(child: PeopleSectionDeep(onOpenPicker: null)),
        overrides: [photosFilterSuggestionsProvider.overrideWith((ref, filter) => Future.value(_sugg(people: [])))],
      );
      await tester.pumpAndSettle();

      expect(find.byKey(const Key('deep-section-empty')), findsOneWidget);
      expect(find.byKey(const Key('people-section-search-more')), findsNothing);
    });

    testWidgets('onOpenPicker callback fires when "Search N →" tapped', (tester) async {
      var opened = false;
      await tester.pumpConsumerWidget(
        Material(child: PeopleSectionDeep(onOpenPicker: () => opened = true)),
        overrides: [
          photosFilterSuggestionsProvider.overrideWith(
            (ref, filter) => Future.value(
              _sugg(
                people: [FilterSuggestionsPersonDto(id: 'p1', name: 'Emma')],
              ),
            ),
          ),
        ],
      );
      await tester.pumpAndSettle();

      await tester.tap(find.byKey(const Key('people-section-search-more')));
      expect(opened, isTrue);
    });

    testWidgets('null onOpenPicker does NOT show a SnackBar when "Search N →" tapped', (tester) async {
      await tester.pumpConsumerWidget(
        const Material(child: PeopleSectionDeep(onOpenPicker: null)),
        overrides: [
          photosFilterSuggestionsProvider.overrideWith(
            (ref, filter) => Future.value(
              _sugg(
                people: [FilterSuggestionsPersonDto(id: 'p1', name: 'Emma')],
              ),
            ),
          ),
        ],
      );
      await tester.pumpAndSettle();

      await tester.tap(find.byKey(const Key('people-section-search-more')));
      await tester.pumpAndSettle();
      expect(find.byType(SnackBar), findsNothing);
    });

    testWidgets('selected avatar renders primary-colored ring in dark theme', (tester) async {
      await tester.pumpConsumerWidgetDark(
        const Material(child: PeopleSectionDeep(onOpenPicker: null)),
        overrides: [
          photosFilterSuggestionsProvider.overrideWith(
            (ref, filter) => Future.value(
              _sugg(
                people: [FilterSuggestionsPersonDto(id: 'p1', name: 'Emma')],
              ),
            ),
          ),
        ],
      );
      await tester.pumpAndSettle();
      final container = ProviderScope.containerOf(tester.element(find.byType(PeopleSectionDeep)));
      container
          .read(photosFilterProvider.notifier)
          .togglePerson(const PersonDto(id: 'p1', name: 'Emma', isHidden: false, thumbnailPath: ''));
      await tester.pumpAndSettle();

      final ring = tester.widget<AnimatedContainer>(find.byKey(const Key('people-tile-ring-p1')));
      final decoration = ring.decoration as BoxDecoration;
      expect(decoration.border, isNotNull);
    });

    testWidgets('avatar tile hit area ≥ 44×44 pt', (tester) async {
      await tester.pumpConsumerWidget(
        const Material(child: PeopleSectionDeep(onOpenPicker: null)),
        overrides: [
          photosFilterSuggestionsProvider.overrideWith(
            (ref, filter) => Future.value(
              _sugg(
                people: [FilterSuggestionsPersonDto(id: 'p1', name: 'Emma')],
              ),
            ),
          ),
        ],
      );
      await tester.pumpAndSettle();
      final size = tester.getSize(find.byKey(const Key('people-tile-p1')));
      expect(size.width, greaterThanOrEqualTo(44));
      expect(size.height, greaterThanOrEqualTo(44));
    });
  });
}
