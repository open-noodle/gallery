import 'dart:convert';

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
import 'package:immich_mobile/models/photos_filter/filter_person.model.dart';
import 'package:immich_mobile/presentation/widgets/filter_sheet/deep/manage_sections_sheet.widget.dart';
import 'package:immich_mobile/presentation/widgets/filter_sheet/deep_content.widget.dart';
import 'package:immich_mobile/presentation/widgets/filter_sheet/filter_section_id.dart';
import 'package:immich_mobile/providers/photos_filter/filter_sheet.provider.dart';
import 'package:immich_mobile/providers/photos_filter/filter_suggestions.provider.dart';
import 'package:immich_mobile/providers/photos_filter/photos_filter.provider.dart';
import 'package:immich_mobile/providers/photos_filter/section_availability.provider.dart';
import 'package:immich_mobile/providers/photos_filter/time_buckets.provider.dart';
import 'package:openapi/api.dart';

import '../../../widget_tester_extensions.dart';

FilterSuggestionsResponseDto emptySuggestions() => FilterSuggestionsResponseDto(
  hasUnnamedPeople: false,
  hasFavorites: false,
  hasAssetsInAlbum: false,
  hasAssetsNotInAlbum: false,
);

extension _CopyWithRatings on FilterSuggestionsResponseDto {
  /// Test-only helper: returns a copy with [ratings] substituted. #910's rating-star guard needs a
  /// populated ratings facet without hand-rolling every other field.
  FilterSuggestionsResponseDto copyWithRatings(List<num> ratings) => FilterSuggestionsResponseDto(
    cameraMakes: cameraMakes,
    countries: countries,
    hasAssetsInAlbum: hasAssetsInAlbum,
    hasAssetsNotInAlbum: hasAssetsNotInAlbum,
    hasFavorites: hasFavorites,
    hasUnnamedPeople: hasUnnamedPeople,
    mediaTypes: mediaTypes,
    people: people,
    ratings: ratings,
    tags: tags,
  );
}

void main() {
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
  setUp(() async => Store.put(StoreKey.filterSheetHiddenSections, '[]'));

  Future<void> pumpDeep(WidgetTester tester, ScrollController controller, {List<Override> overrides = const []}) async {
    await tester.binding.setSurfaceSize(const Size(400, 2400));
    addTearDown(() => tester.binding.setSurfaceSize(null));
    await tester.pumpConsumerWidget(
      DeepContent(scrollController: controller),
      overrides: [
        photosFilterSheetProvider.overrideWith((ref) => FilterSheetSnap.deep),
        timeBucketsProvider.overrideWith((ref, filter) => Future.value(const [])),
        ...overrides,
      ],
    );
    await tester.pumpAndSettle();
  }

  /// Shorthand: [pumpDeep] plus an optional `sectionAvailabilityProvider` override
  /// ([availability]) and/or a `photosFilterSuggestionsProvider` override ([facets]) (#910).
  Future<void> pumpDeepSheet(
    WidgetTester tester, {
    Set<FilterSectionId>? availability,
    FilterSuggestionsResponseDto? facets,
  }) async {
    final controller = ScrollController();
    addTearDown(controller.dispose);
    await pumpDeep(
      tester,
      controller,
      overrides: [
        if (availability != null) sectionAvailabilityProvider.overrideWithValue(availability),
        if (facets != null) photosFilterSuggestionsProvider.overrideWith((ref, filter) => Future.value(facets)),
      ],
    );
  }

  /// Shorthand: pumps [ManageSectionsSheet] with an optional `sectionAvailabilityProvider`
  /// override (#910).
  Future<void> pumpManageSections(WidgetTester tester, {Set<FilterSectionId>? availability}) async {
    await tester.pumpConsumerWidget(
      const ManageSectionsSheet(),
      overrides: [if (availability != null) sectionAvailabilityProvider.overrideWithValue(availability)],
    );
  }

  testWidgets('hidden sections are not rendered; visible ones are', (tester) async {
    await Store.put(StoreKey.filterSheetHiddenSections, jsonEncode(['tags']));
    final controller = ScrollController();
    addTearDown(controller.dispose);
    await pumpDeep(tester, controller);

    expect(find.byKey(const Key('deep-section-tags')), findsNothing);
    expect(find.byKey(const Key('deep-section-people')), findsOneWidget);
    expect(find.byKey(const Key('deep-section-media')), findsOneWidget);
  });

  testWidgets('default: all sections visible', (tester) async {
    await Store.put(StoreKey.filterSheetHiddenSections, '[]');
    final controller = ScrollController();
    addTearDown(controller.dispose);
    await pumpDeep(tester, controller);

    expect(find.byKey(const Key('deep-section-people')), findsOneWidget);
    expect(find.byKey(const Key('deep-section-toggles')), findsOneWidget);
  });

  testWidgets('does not render a section with no facet (#910)', (tester) async {
    await pumpDeepSheet(tester, availability: {FilterSectionId.when, FilterSectionId.media});

    // Positive first, so a sheet that failed to render cannot pass the negatives.
    expect(find.byKey(const Key('deep-section-media')), findsOneWidget);
    expect(find.byKey(const Key('deep-section-rating')), findsNothing);
  });

  testWidgets('does not offer an unavailable section in manage sections (#910)', (tester) async {
    await pumpManageSections(tester, availability: {FilterSectionId.when, FilterSectionId.media});

    expect(find.byKey(const Key('manage-section-media')), findsOneWidget);
    expect(find.byKey(const Key('manage-section-rating')), findsNothing);
  });

  testWidgets('hides the favourites and not-in-album switches when their facets are empty (#910)', (tester) async {
    await pumpDeepSheet(tester, facets: emptySuggestions());

    expect(find.byKey(const Key('toggle-favourites')), findsNothing);
    expect(find.byKey(const Key('toggle-not-in-album')), findsNothing);
    // These two have no facet and must always render — the section itself never disappears.
    expect(find.byKey(const Key('toggle-archived')), findsOneWidget);
    expect(find.byKey(const Key('toggle-untagged')), findsOneWidget);
  });

  // #910 fix-wave finding 2: the gated toggles need the SAME baseline treatment as the sections —
  // a facet emptied only by a CROSS-SECTION filter (here: selecting a person with no favourited
  // photos) must not pop the switch out mid-session, because the whole-scope baseline still has it.
  // Mirrors the provider-level `keeps a section whose facet a CROSS-SECTION filter emptied` test.
  testWidgets('keeps the favourites switch when a CROSS-SECTION filter emptied its facet, because the '
      'baseline still has it (#910)', (tester) async {
    const aPerson = FilterPerson(id: 'p1', name: 'Alice');
    final controller = ScrollController();
    addTearDown(controller.dispose);

    await pumpDeep(
      tester,
      controller,
      overrides: [
        photosFilterSuggestionsProvider.overrideWith((ref, filter) {
          // Current facets (person filter applied): no favourites in that person's photos.
          // Baseline facets (SearchFilter.empty()): the library does have favourites.
          return Future.value(
            FilterSuggestionsResponseDto(
              hasUnnamedPeople: false,
              hasFavorites: filter.isEmpty,
              hasAssetsInAlbum: false,
              hasAssetsNotInAlbum: true,
            ),
          );
        }),
      ],
    );

    final container = ProviderScope.containerOf(tester.element(find.byType(DeepContent)));
    container.read(photosFilterProvider.notifier).togglePerson(aPerson);
    // Past the 250 ms debounce so the person filter's facets settle in.
    await tester.pump(const Duration(milliseconds: 260));
    await tester.pumpAndSettle();

    expect(find.byKey(const Key('toggle-favourites')), findsOneWidget);
  });

  testWidgets('never dims or drops a rating star (#910, feedback_no_dynamic_rating_media_hiding)', (tester) async {
    await pumpDeepSheet(tester, facets: emptySuggestions().copyWithRatings([2]));

    for (var i = 1; i <= 5; i++) {
      expect(find.byKey(Key('rating-star-$i')), findsOneWidget);
    }
  });
}
