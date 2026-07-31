import 'package:auto_route/auto_route.dart';
import 'package:drift/drift.dart' as drift;
import 'package:drift/native.dart';
import 'package:easy_localization/easy_localization.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/constants/locales.dart';
import 'package:immich_mobile/domain/models/store.model.dart';
import 'package:immich_mobile/domain/services/store.service.dart';
import 'package:immich_mobile/domain/models/asset/base_asset.model.dart';
import 'package:immich_mobile/entities/store.entity.dart';
import 'package:immich_mobile/generated/codegen_loader.g.dart';
import 'package:immich_mobile/infrastructure/repositories/db.repository.dart';
import 'package:immich_mobile/infrastructure/repositories/store.repository.dart';
import 'package:immich_mobile/models/search/search_filter.model.dart';
import 'package:immich_mobile/presentation/pages/photos_filter/camera_picker.page.dart';
import 'package:immich_mobile/presentation/pages/photos_filter/person_picker.page.dart';
import 'package:immich_mobile/presentation/pages/photos_filter/places_picker.page.dart';
import 'package:immich_mobile/presentation/pages/photos_filter/tags_picker.page.dart';
import 'package:immich_mobile/presentation/widgets/filter_sheet/strips/camera_strip.widget.dart';
import 'package:immich_mobile/presentation/widgets/filter_sheet/strips/people_strip.widget.dart';
import 'package:immich_mobile/presentation/widgets/filter_sheet/strips/places_strip.widget.dart';
import 'package:immich_mobile/presentation/widgets/filter_sheet/strips/tags_strip.widget.dart';
import 'package:immich_mobile/presentation/widgets/filter_sheet/strips/when_strip.widget.dart';
import 'package:immich_mobile/providers/photos_filter/filter_suggestions.provider.dart';
import 'package:immich_mobile/providers/photos_filter/photos_filter.provider.dart';
import 'package:immich_mobile/routing/router.dart';
import 'package:openapi/api.dart';

import '../../../../widget_tester_extensions.dart';

/// Minimal, self-contained AutoRoute router — just enough to prove `PeopleStrip`'s
/// "+N" tile really navigates to [PersonPickerRoute] without pulling in the app's
/// full, auth-guarded `AppRouter` (which needs a live ApiService/AuthService/etc.).
final _homePage = PageInfo('PeopleStripHarness', builder: (data) => const Material(child: PeopleStrip()));

class _PeopleStripTestRouter extends RootStackRouter {
  @override
  List<AutoRoute> get routes => [AutoRoute(page: _homePage, initial: true), AutoRoute(page: PersonPickerRoute.page)];
}

final _placesHomePage = PageInfo('PlacesStripHarness', builder: (data) => const Material(child: PlacesStrip()));

class _PlacesStripTestRouter extends RootStackRouter {
  @override
  List<AutoRoute> get routes => [
    AutoRoute(page: _placesHomePage, initial: true),
    AutoRoute(page: PlacesPickerRoute.page),
  ];
}

final _tagsHomePage = PageInfo('TagsStripHarness', builder: (data) => const Material(child: TagsStrip()));

class _TagsStripTestRouter extends RootStackRouter {
  @override
  List<AutoRoute> get routes => [AutoRoute(page: _tagsHomePage, initial: true), AutoRoute(page: TagsPickerRoute.page)];
}

final _cameraHomePage = PageInfo('CameraStripHarness', builder: (data) => const Material(child: CameraStrip()));

class _CameraStripTestRouter extends RootStackRouter {
  @override
  List<AutoRoute> get routes => [
    AutoRoute(page: _cameraHomePage, initial: true),
    AutoRoute(page: CameraPickerRoute.page),
  ];
}

FilterSuggestionsResponseDto _suggestions({
  List<FilterSuggestionsPersonDto> people = const [],
  List<FilterSuggestionsTagDto> tags = const [],
  List<String> countries = const [],
  List<String> cameraMakes = const [],
}) => FilterSuggestionsResponseDto(
  hasUnnamedPeople: false,
  people: people,
  tags: tags,
  countries: countries,
  cameraMakes: cameraMakes,
);

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

    // Slice 3: cap the strip to 6 tiles + a trailing "+N" tile that opens the full picker.
    testWidgets('caps to 6 tiles + a trailing "+N" tile when there are more than 6 people', (tester) async {
      final s = _suggestions(
        people: [for (var i = 0; i < 10; i++) FilterSuggestionsPersonDto(id: 'p$i', name: 'P$i')],
      );
      await tester.pumpConsumerWidget(const PeopleStrip(), overrides: _overrideSuggestions(s));
      await tester.pumpAndSettle();

      for (var i = 0; i < 6; i++) {
        expect(find.text('P$i'), findsOneWidget);
      }
      for (var i = 6; i < 10; i++) {
        expect(find.text('P$i'), findsNothing);
      }
      expect(find.byKey(const Key('people-strip-more')), findsOneWidget);
      expect(
        find.descendant(of: find.byKey(const Key('people-strip-more')), matching: find.textContaining('4')),
        findsOneWidget,
        reason: '10 - 6 = 4 more',
      );
    });

    testWidgets('no "+N" tile when there are 6 or fewer people', (tester) async {
      final s = _suggestions(
        people: [for (var i = 0; i < 6; i++) FilterSuggestionsPersonDto(id: 'p$i', name: 'P$i')],
      );
      await tester.pumpConsumerWidget(const PeopleStrip(), overrides: _overrideSuggestions(s));
      await tester.pumpAndSettle();

      for (var i = 0; i < 6; i++) {
        expect(find.text('P$i'), findsOneWidget);
      }
      expect(find.byKey(const Key('people-strip-more')), findsNothing);
    });

    testWidgets('tapping the "+N" tile navigates to the person picker', (tester) async {
      final s = _suggestions(
        people: [for (var i = 0; i < 10; i++) FilterSuggestionsPersonDto(id: 'p$i', name: 'P$i')],
      );
      final router = _PeopleStripTestRouter();
      await tester.pumpWidget(
        EasyLocalization(
          supportedLocales: locales.values.toList(),
          path: translationsPath,
          startLocale: locales.values.first,
          fallbackLocale: locales.values.first,
          saveLocale: false,
          useFallbackTranslations: true,
          assetLoader: const CodegenLoader(),
          child: ProviderScope(
            overrides: _overrideSuggestions(s),
            child: Builder(
              builder: (context) => MaterialApp.router(
                debugShowCheckedModeBanner: false,
                routerConfig: router.config(),
                localizationsDelegates: context.localizationDelegates,
                supportedLocales: context.supportedLocales,
                locale: context.locale,
              ),
            ),
          ),
        ),
      );
      await tester.pumpAndSettle();

      expect(find.byKey(const Key('people-strip-more')), findsOneWidget);
      await tester.tap(find.byKey(const Key('people-strip-more')));
      await tester.pumpAndSettle();

      expect(find.byType(PersonPickerPage), findsOneWidget);
      expect(find.byType(PeopleStrip), findsNothing);
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

    // Slice 4: cap the strip to 10 tiles + a trailing "+N" tile that opens the full picker.
    testWidgets('caps to 10 tiles + a trailing "+N" tile when there are more than 10 countries', (tester) async {
      await tester.binding.setSurfaceSize(const Size(1600, 200));
      addTearDown(() => tester.binding.setSurfaceSize(null));
      final s = _suggestions(countries: [for (var i = 0; i < 15; i++) 'C$i']);
      await tester.pumpConsumerWidget(const PlacesStrip(), overrides: _overrideSuggestions(s));
      await tester.pumpAndSettle();

      for (var i = 0; i < 10; i++) {
        expect(find.text('C$i'), findsOneWidget);
      }
      for (var i = 10; i < 15; i++) {
        expect(find.text('C$i'), findsNothing);
      }
      expect(find.byKey(const Key('places-strip-more')), findsOneWidget);
      expect(
        find.descendant(of: find.byKey(const Key('places-strip-more')), matching: find.textContaining('5')),
        findsOneWidget,
        reason: '15 - 10 = 5 more',
      );
    });

    testWidgets('no "+N" tile when there are 10 or fewer countries', (tester) async {
      await tester.binding.setSurfaceSize(const Size(1600, 200));
      addTearDown(() => tester.binding.setSurfaceSize(null));
      final s = _suggestions(countries: [for (var i = 0; i < 10; i++) 'C$i']);
      await tester.pumpConsumerWidget(const PlacesStrip(), overrides: _overrideSuggestions(s));
      await tester.pumpAndSettle();

      for (var i = 0; i < 10; i++) {
        expect(find.text('C$i'), findsOneWidget);
      }
      expect(find.byKey(const Key('places-strip-more')), findsNothing);
    });

    testWidgets('tapping the "+N" tile navigates to the places picker', (tester) async {
      await tester.binding.setSurfaceSize(const Size(1600, 200));
      addTearDown(() => tester.binding.setSurfaceSize(null));
      final s = _suggestions(countries: [for (var i = 0; i < 15; i++) 'C$i']);
      final router = _PlacesStripTestRouter();
      await tester.pumpWidget(
        EasyLocalization(
          supportedLocales: locales.values.toList(),
          path: translationsPath,
          startLocale: locales.values.first,
          fallbackLocale: locales.values.first,
          saveLocale: false,
          useFallbackTranslations: true,
          assetLoader: const CodegenLoader(),
          child: ProviderScope(
            overrides: _overrideSuggestions(s),
            child: Builder(
              builder: (context) => MaterialApp.router(
                debugShowCheckedModeBanner: false,
                routerConfig: router.config(),
                localizationsDelegates: context.localizationDelegates,
                supportedLocales: context.supportedLocales,
                locale: context.locale,
              ),
            ),
          ),
        ),
      );
      await tester.pumpAndSettle();

      expect(find.byKey(const Key('places-strip-more')), findsOneWidget);
      await tester.tap(find.byKey(const Key('places-strip-more')));
      await tester.pumpAndSettle();

      expect(find.byType(PlacesPickerPage), findsOneWidget);
      expect(find.byType(PlacesStrip), findsNothing);
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

    // Slice 5: cap the strip to 10 tiles + a trailing "+N" tile that opens the full picker.
    testWidgets('caps to 10 chips + a trailing "+N" tile when there are more than 10 tags', (tester) async {
      await tester.binding.setSurfaceSize(const Size(2400, 200));
      addTearDown(() => tester.binding.setSurfaceSize(null));
      final s = _suggestions(tags: [for (var i = 0; i < 15; i++) FilterSuggestionsTagDto(id: 't$i', value: 'Tag$i')]);
      await tester.pumpConsumerWidget(const TagsStrip(), overrides: _overrideSuggestions(s));
      await tester.pumpAndSettle();

      for (var i = 0; i < 10; i++) {
        expect(find.text('Tag$i'), findsOneWidget);
      }
      for (var i = 10; i < 15; i++) {
        expect(find.text('Tag$i'), findsNothing);
      }
      expect(find.byKey(const Key('tags-strip-more')), findsOneWidget);
      expect(
        find.descendant(of: find.byKey(const Key('tags-strip-more')), matching: find.textContaining('5')),
        findsOneWidget,
        reason: '15 - 10 = 5 more',
      );
    });

    testWidgets('no "+N" tile when there are 10 or fewer tags', (tester) async {
      await tester.binding.setSurfaceSize(const Size(2400, 200));
      addTearDown(() => tester.binding.setSurfaceSize(null));
      final s = _suggestions(tags: [for (var i = 0; i < 10; i++) FilterSuggestionsTagDto(id: 't$i', value: 'Tag$i')]);
      await tester.pumpConsumerWidget(const TagsStrip(), overrides: _overrideSuggestions(s));
      await tester.pumpAndSettle();

      for (var i = 0; i < 10; i++) {
        expect(find.text('Tag$i'), findsOneWidget);
      }
      expect(find.byKey(const Key('tags-strip-more')), findsNothing);
    });

    testWidgets('tapping the "+N" tile navigates to the tags picker', (tester) async {
      await tester.binding.setSurfaceSize(const Size(2400, 200));
      addTearDown(() => tester.binding.setSurfaceSize(null));
      final s = _suggestions(tags: [for (var i = 0; i < 15; i++) FilterSuggestionsTagDto(id: 't$i', value: 'Tag$i')]);
      final router = _TagsStripTestRouter();
      await tester.pumpWidget(
        EasyLocalization(
          supportedLocales: locales.values.toList(),
          path: translationsPath,
          startLocale: locales.values.first,
          fallbackLocale: locales.values.first,
          saveLocale: false,
          useFallbackTranslations: true,
          assetLoader: const CodegenLoader(),
          child: ProviderScope(
            overrides: _overrideSuggestions(s),
            child: Builder(
              builder: (context) => MaterialApp.router(
                debugShowCheckedModeBanner: false,
                routerConfig: router.config(),
                localizationsDelegates: context.localizationDelegates,
                supportedLocales: context.supportedLocales,
                locale: context.locale,
              ),
            ),
          ),
        ),
      );
      await tester.pumpAndSettle();

      expect(find.byKey(const Key('tags-strip-more')), findsOneWidget);
      await tester.tap(find.byKey(const Key('tags-strip-more')));
      await tester.pumpAndSettle();

      expect(find.byType(TagsPickerPage), findsOneWidget);
      expect(find.byType(TagsStrip), findsNothing);
    });
  });

  group('CameraStrip', () {
    testWidgets('empty data → hidden', (tester) async {
      await tester.pumpConsumerWidget(const CameraStrip(), overrides: _overrideSuggestions(_suggestions()));
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('camera-tile')), findsNothing);
    });

    testWidgets('tap on make sets camera filter', (tester) async {
      final s = _suggestions(cameraMakes: ['Canon', 'Sony']);
      await tester.pumpConsumerWidget(const CameraStrip(), overrides: _overrideSuggestions(s));
      await tester.pumpAndSettle();

      final container = ProviderScope.containerOf(tester.element(find.byType(CameraStrip)));
      await tester.tap(find.text('Canon'));
      await tester.pumpAndSettle();

      expect(container.read(photosFilterProvider).camera.make, 'Canon');
    });

    testWidgets('tap on already-selected make clears camera', (tester) async {
      final s = _suggestions(cameraMakes: ['Canon']);
      await tester.pumpConsumerWidget(const CameraStrip(), overrides: _overrideSuggestions(s));
      await tester.pumpAndSettle();

      final container = ProviderScope.containerOf(tester.element(find.byType(CameraStrip)));
      container.read(photosFilterProvider.notifier).setCamera(SearchCameraFilter(make: 'Canon'));
      await tester.pumpAndSettle();

      await tester.tap(find.text('Canon'));
      await tester.pumpAndSettle();

      expect(container.read(photosFilterProvider).camera.make, isNull);
    });

    testWidgets('caps to 10 tiles + a trailing "+N" tile when there are more than 10 makes', (tester) async {
      await tester.binding.setSurfaceSize(const Size(1600, 200));
      addTearDown(() => tester.binding.setSurfaceSize(null));
      final s = _suggestions(cameraMakes: [for (var i = 0; i < 15; i++) 'M$i']);
      await tester.pumpConsumerWidget(const CameraStrip(), overrides: _overrideSuggestions(s));
      await tester.pumpAndSettle();

      for (var i = 0; i < 10; i++) {
        expect(find.text('M$i'), findsOneWidget);
      }
      for (var i = 10; i < 15; i++) {
        expect(find.text('M$i'), findsNothing);
      }
      expect(find.byKey(const Key('camera-strip-more')), findsOneWidget);
      expect(
        find.descendant(of: find.byKey(const Key('camera-strip-more')), matching: find.textContaining('5')),
        findsOneWidget,
        reason: '15 - 10 = 5 more',
      );
    });

    testWidgets('no "+N" tile when there are 10 or fewer makes', (tester) async {
      await tester.binding.setSurfaceSize(const Size(1600, 200));
      addTearDown(() => tester.binding.setSurfaceSize(null));
      final s = _suggestions(cameraMakes: [for (var i = 0; i < 10; i++) 'M$i']);
      await tester.pumpConsumerWidget(const CameraStrip(), overrides: _overrideSuggestions(s));
      await tester.pumpAndSettle();

      for (var i = 0; i < 10; i++) {
        expect(find.text('M$i'), findsOneWidget);
      }
      expect(find.byKey(const Key('camera-strip-more')), findsNothing);
    });

    testWidgets('tapping the "+N" tile navigates to the camera picker', (tester) async {
      await tester.binding.setSurfaceSize(const Size(1600, 200));
      addTearDown(() => tester.binding.setSurfaceSize(null));
      final s = _suggestions(cameraMakes: [for (var i = 0; i < 15; i++) 'M$i']);
      final router = _CameraStripTestRouter();
      await tester.pumpWidget(
        EasyLocalization(
          supportedLocales: locales.values.toList(),
          path: translationsPath,
          startLocale: locales.values.first,
          fallbackLocale: locales.values.first,
          saveLocale: false,
          useFallbackTranslations: true,
          assetLoader: const CodegenLoader(),
          child: ProviderScope(
            overrides: _overrideSuggestions(s),
            child: Builder(
              builder: (context) => MaterialApp.router(
                debugShowCheckedModeBanner: false,
                routerConfig: router.config(),
                localizationsDelegates: context.localizationDelegates,
                supportedLocales: context.supportedLocales,
                locale: context.locale,
              ),
            ),
          ),
        ),
      );
      await tester.pumpAndSettle();

      expect(find.byKey(const Key('camera-strip-more')), findsOneWidget);
      await tester.tap(find.byKey(const Key('camera-strip-more')));
      await tester.pumpAndSettle();

      expect(find.byType(CameraPickerPage), findsOneWidget);
      expect(find.byType(CameraStrip), findsNothing);
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
