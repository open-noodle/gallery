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
import 'package:immich_mobile/providers/photos_filter/hidden_sections.provider.dart';

class _FakeVis implements FilterSectionVisibilityPrefs {
  Set<FilterSectionId> stored;
  Set<FilterSectionId>? lastSaved;
  _FakeVis(this.stored);
  @override
  Set<FilterSectionId> loadHidden() => stored;
  @override
  Future<void> saveHidden(Set<FilterSectionId> ids) async {
    lastSaved = ids;
    stored = ids;
  }
}

ProviderContainer _c(FilterSectionVisibilityPrefs prefs) {
  final c = ProviderContainer(overrides: [filterSectionVisibilityPrefsProvider.overrideWithValue(prefs)]);
  addTearDown(c.dispose);
  return c;
}

void main() {
  group('codec', () {
    test('round-trips', () {
      final s = {FilterSectionId.people, FilterSectionId.rating};
      expect(decodeHiddenSections(encodeHiddenSections(s)), s);
    });
    test('ignores unknown/malformed', () {
      expect(decodeHiddenSections('["tags","junk"]'), {FilterSectionId.tags});
      expect(decodeHiddenSections('nope'), <FilterSectionId>{});
      expect(decodeHiddenSections('[]'), <FilterSectionId>{});
    });
  });

  group('hiddenSectionsProvider (fake gateway)', () {
    test('default: nothing hidden → all visible', () {
      final c = _c(_FakeVis({}));
      expect(c.read(hiddenSectionsProvider), isEmpty);
      expect(c.read(hiddenSectionsProvider.notifier).isVisible(FilterSectionId.tags), isTrue);
    });
    test('loads persisted hidden set', () {
      final c = _c(_FakeVis({FilterSectionId.tags}));
      expect(c.read(hiddenSectionsProvider.notifier).isVisible(FilterSectionId.tags), isFalse);
    });
    test('setVisible(false) hides, setVisible(true) shows, and persists', () {
      final prefs = _FakeVis({});
      final c = _c(prefs);
      final n = c.read(hiddenSectionsProvider.notifier);
      n.setVisible(FilterSectionId.tags, false);
      expect(c.read(hiddenSectionsProvider), {FilterSectionId.tags});
      expect(prefs.lastSaved, {FilterSectionId.tags});
      n.setVisible(FilterSectionId.tags, true);
      expect(c.read(hiddenSectionsProvider), isEmpty);
      expect(prefs.lastSaved, isEmpty);
    });
  });

  group('StoreFilterSectionVisibilityPrefs (real Store)', () {
    late Drift db;
    setUpAll(() async {
      TestWidgetsFlutterBinding.ensureInitialized();
      db = Drift(drift.DatabaseConnection(NativeDatabase.memory(), closeStreamsSynchronously: true));
      await StoreService.init(storeRepository: DriftStoreRepository(db));
    });
    tearDownAll(() async {
      await Store.clear();
      await db.close();
    });
    setUp(() async => Store.put(StoreKey.filterSheetHiddenSections, '[]'));

    test('save/load round-trips through Store; fresh container reloads (restart)', () async {
      const prefs = StoreFilterSectionVisibilityPrefs();
      expect(prefs.loadHidden(), isEmpty);
      await prefs.saveHidden({FilterSectionId.media});
      expect(prefs.loadHidden(), {FilterSectionId.media});
      final c = ProviderContainer();
      addTearDown(c.dispose);
      expect(c.read(hiddenSectionsProvider), {FilterSectionId.media});
    });
  });
}
