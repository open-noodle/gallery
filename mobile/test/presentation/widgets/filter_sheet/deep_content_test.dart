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
import 'package:immich_mobile/presentation/widgets/filter_sheet/deep/when_accordion_section.widget.dart';
import 'package:immich_mobile/presentation/widgets/filter_sheet/deep_content.widget.dart';
import 'package:immich_mobile/providers/photos_filter/filter_sheet.provider.dart';
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

  group('DeepContent', () {
    testWidgets('sections render in the §5.2 order', (tester) async {
      final controller = ScrollController();
      addTearDown(controller.dispose);

      // Expand the test viewport so every ListView child is built — otherwise
      // lazy rendering leaves bottom sections (toggles) off-screen.
      await tester.binding.setSurfaceSize(const Size(400, 2400));
      addTearDown(() => tester.binding.setSurfaceSize(null));

      await tester.pumpConsumerWidget(
        DeepContent(scrollController: controller),
        overrides: [
          photosFilterSheetProvider.overrideWith((ref) => FilterSheetSnap.deep),
          // Return empty buckets so WhenAccordionSection collapses to the
          // short empty-caption body instead of the full skeleton / retry.
          timeBucketsProvider.overrideWith((ref, filter) => Future.value(const <BucketLite>[])),
        ],
      );
      await tester.pumpAndSettle();

      // In-flow sections must appear strictly top-to-bottom. The done-bar is
      // a `Positioned(bottom: 0)` overlay in a Stack so its global Y depends
      // only on viewport height, not list content — we assert its presence
      // separately.
      final orderedKeys = [
        const Key('deep-header'),
        const Key('deep-search'),
        const Key('deep-section-people'),
        const Key('deep-section-places'),
        const Key('deep-section-tags'),
        const Key('deep-section-when'),
        const Key('deep-section-rating'),
        const Key('deep-section-media'),
        const Key('deep-section-toggles'),
      ];

      double prev = double.negativeInfinity;
      for (final key in orderedKeys) {
        expect(find.byKey(key), findsOneWidget, reason: '$key missing');
        final box = tester.getTopLeft(find.byKey(key));
        expect(box.dy, greaterThan(prev), reason: '$key not below previous');
        prev = box.dy;
      }
      expect(find.byKey(const Key('deep-done-bar')), findsOneWidget);
    });

    testWidgets('PageStorageKey is set on the scroll body (§6.5 retention)', (tester) async {
      final controller = ScrollController();
      addTearDown(controller.dispose);

      await tester.pumpConsumerWidget(DeepContent(scrollController: controller));
      await tester.pumpAndSettle();

      final storage = find.byKey(const PageStorageKey('filter-sheet-deep-scroll'));
      expect(storage, findsOneWidget);
    });
  });

  group('DeepContent PeopleSection wire-up', () {
    testWidgets('DeepContent wires a non-null onOpenPicker into PeopleSectionDeep', (tester) async {
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
              ),
            ),
          ),
          timeBucketsProvider.overrideWith((ref, filter) => Future.value(const <BucketLite>[])),
        ],
      );
      await tester.pumpAndSettle();

      final peopleWidget = tester.widget<PeopleSectionDeep>(find.byKey(const Key('deep-section-people')));
      expect(peopleWidget.onOpenPicker, isNotNull);
    });

    testWidgets('photosFilterProvider.people survives DeepContent remount', (tester) async {
      final controller1 = ScrollController();
      addTearDown(controller1.dispose);
      await tester.binding.setSurfaceSize(const Size(400, 2400));
      addTearDown(() => tester.binding.setSurfaceSize(null));

      // Use a shared ProviderContainer so state survives across pumpWidget calls.
      final scope = ProviderContainer(
        overrides: [
          photosFilterSuggestionsProvider.overrideWith(
            (ref, filter) => Future.value(FilterSuggestionsResponseDto(hasUnnamedPeople: false, people: const [])),
          ),
          timeBucketsProvider.overrideWith((ref, filter) => Future.value(const <BucketLite>[])),
        ],
      );
      addTearDown(scope.dispose);

      // Seed a selection.
      scope
          .read(photosFilterProvider.notifier)
          .togglePerson(const PersonDto(id: 'p1', name: 'Emma', isHidden: false, thumbnailPath: ''));
      expect(scope.read(photosFilterProvider).people, hasLength(1));

      await tester.pumpWidget(
        UncontrolledProviderScope(
          container: scope,
          child: MaterialApp(
            debugShowCheckedModeBanner: false,
            home: Material(child: DeepContent(scrollController: controller1)),
          ),
        ),
      );
      await tester.pumpAndSettle();

      // Simulate unmount (picker push covers DeepContent).
      await tester.pumpWidget(
        UncontrolledProviderScope(
          container: scope,
          child: const MaterialApp(debugShowCheckedModeBanner: false, home: Material(child: SizedBox.shrink())),
        ),
      );
      await tester.pumpAndSettle();

      // Re-mount (picker pop returns to DeepContent).
      final controller2 = ScrollController();
      addTearDown(controller2.dispose);
      await tester.pumpWidget(
        UncontrolledProviderScope(
          container: scope,
          child: MaterialApp(
            debugShowCheckedModeBanner: false,
            home: Material(child: DeepContent(scrollController: controller2)),
          ),
        ),
      );
      await tester.pumpAndSettle();

      expect(scope.read(photosFilterProvider).people.any((p) => p.id == 'p1'), isTrue);
    });
  });

  group('DeepContent WhenSection wire-up', () {
    testWidgets('DeepContent wires non-null onOpenPicker into WhenAccordionSection', (tester) async {
      final controller = ScrollController();
      addTearDown(controller.dispose);
      await tester.binding.setSurfaceSize(const Size(400, 2400));
      addTearDown(() => tester.binding.setSurfaceSize(null));

      await tester.pumpConsumerWidget(
        DeepContent(scrollController: controller),
        overrides: [
          photosFilterSuggestionsProvider.overrideWith(
            (ref, filter) => Future.value(FilterSuggestionsResponseDto(hasUnnamedPeople: false)),
          ),
          timeBucketsProvider.overrideWith(
            (ref, filter) => Future.value(const <BucketLite>[(timeBucket: '2024-06-01', count: 10)]),
          ),
        ],
      );
      await tester.pumpAndSettle();

      final whenWidget = tester.widget<WhenAccordionSection>(find.byKey(const Key('deep-section-when')));
      expect(whenWidget.onOpenPicker, isNotNull);
    });
  });
}
