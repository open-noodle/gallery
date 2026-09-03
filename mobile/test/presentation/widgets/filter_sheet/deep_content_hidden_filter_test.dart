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
import 'package:immich_mobile/presentation/widgets/filter_sheet/filter_section_id.dart';
import 'package:immich_mobile/providers/photos_filter/filter_sheet.provider.dart';
import 'package:immich_mobile/providers/photos_filter/hidden_sections.provider.dart';
import 'package:immich_mobile/providers/photos_filter/photos_filter.provider.dart';
import 'package:immich_mobile/providers/photos_filter/time_buckets.provider.dart';

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
  setUp(() async => Store.put(StoreKey.filterSheetHiddenSections, '[]'));

  testWidgets('hiding a section does not clear its active filter', (tester) async {
    final controller = ScrollController();
    addTearDown(controller.dispose);
    await tester.binding.setSurfaceSize(const Size(400, 2400));
    addTearDown(() => tester.binding.setSurfaceSize(null));

    await tester.pumpConsumerWidget(
      DeepContent(scrollController: controller),
      overrides: [
        photosFilterSheetProvider.overrideWith((ref) => FilterSheetVisibility.visible),
        timeBucketsProvider.overrideWith((ref, filter) => Future.value(const [])),
      ],
    );
    await tester.pumpAndSettle();

    final container = ProviderScope.containerOf(tester.element(find.byType(DeepContent)));

    // Seed a tag selection.
    container.read(photosFilterProvider.notifier).toggleTag('tag-1');
    await tester.pumpAndSettle();
    expect(container.read(photosFilterProvider).tagIds, contains('tag-1'));
    expect(find.byKey(const Key('deep-section-tags')), findsOneWidget);

    // Hide the tags section.
    container.read(hiddenSectionsProvider.notifier).setVisible(FilterSectionId.tags, false);
    await tester.pumpAndSettle();

    expect(find.byKey(const Key('deep-section-tags')), findsNothing);
    // The active tag filter must be untouched by hiding the section.
    expect(container.read(photosFilterProvider).tagIds, contains('tag-1'));
  });
}
