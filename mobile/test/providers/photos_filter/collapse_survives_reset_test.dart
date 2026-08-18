import 'package:drift/drift.dart' as drift;
import 'package:drift/native.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/domain/models/store.model.dart';
import 'package:immich_mobile/domain/services/store.service.dart';
import 'package:immich_mobile/entities/store.entity.dart';
import 'package:immich_mobile/infrastructure/repositories/db.repository.dart';
import 'package:immich_mobile/infrastructure/repositories/store.repository.dart';
import 'package:immich_mobile/presentation/widgets/filter_sheet/filter_section_id.dart';
import 'package:immich_mobile/providers/photos_filter/collapsed_sections.provider.dart';
import 'package:immich_mobile/providers/photos_filter/photos_filter.provider.dart';

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
  setUp(() async {
    await Store.put(StoreKey.filterSheetCollapsedSections, '[]'); // reset between tests
  });

  test('resetting the photos filter leaves collapsed sections untouched', () async {
    await const StoreFilterSectionPrefs().saveCollapsed({FilterSectionId.tags});
    final c = ProviderContainer();
    addTearDown(c.dispose);
    expect(c.read(collapsedSectionsProvider), {FilterSectionId.tags});

    c.read(photosFilterProvider.notifier).reset(); // clears the filter selections

    expect(c.read(collapsedSectionsProvider), {FilterSectionId.tags}); // collapse state preserved
  });
}
