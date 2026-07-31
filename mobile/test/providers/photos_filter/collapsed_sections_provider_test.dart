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

class _FakePrefs implements FilterSectionPrefs {
  Set<FilterSectionId> stored;
  Set<FilterSectionId>? lastSaved;
  _FakePrefs(this.stored);
  @override
  Set<FilterSectionId> loadCollapsed() => stored;
  @override
  Future<void> saveCollapsed(Set<FilterSectionId> ids) async {
    lastSaved = ids;
    stored = ids;
  }
}

ProviderContainer _containerWith(FilterSectionPrefs prefs) {
  final c = ProviderContainer(overrides: [filterSectionPrefsProvider.overrideWithValue(prefs)]);
  addTearDown(c.dispose);
  return c;
}

void main() {
  group('collapsed sections codec', () {
    test('encode → decode round-trips', () {
      final set = {FilterSectionId.tags, FilterSectionId.rating};
      expect(decodeCollapsedSections(encodeCollapsedSections(set)), set);
    });
    test('decode ignores unknown ids and malformed json', () {
      expect(decodeCollapsedSections('["tags","unknown-id","junk"]'), {FilterSectionId.tags});
      expect(decodeCollapsedSections('not json'), <FilterSectionId>{});
      expect(decodeCollapsedSections('{"a":1}'), <FilterSectionId>{});
      expect(decodeCollapsedSections('[]'), <FilterSectionId>{});
    });
  });

  group('collapsedSectionsProvider', () {
    test('default (nothing stored) is all-expanded → empty collapsed set', () {
      final c = _containerWith(_FakePrefs({}));
      expect(c.read(collapsedSectionsProvider), isEmpty);
      expect(c.read(collapsedSectionsProvider.notifier).isCollapsed(FilterSectionId.people), isFalse);
    });

    test('initial state loads the persisted collapsed set', () {
      final c = _containerWith(_FakePrefs({FilterSectionId.tags}));
      expect(c.read(collapsedSectionsProvider), {FilterSectionId.tags});
      expect(c.read(collapsedSectionsProvider.notifier).isCollapsed(FilterSectionId.tags), isTrue);
    });

    test('toggle collapses then expands, and persists each change', () {
      final prefs = _FakePrefs({});
      final c = _containerWith(prefs);
      final notifier = c.read(collapsedSectionsProvider.notifier);

      notifier.toggle(FilterSectionId.people);
      expect(c.read(collapsedSectionsProvider), {FilterSectionId.people});
      expect(prefs.lastSaved, {FilterSectionId.people});

      notifier.toggle(FilterSectionId.people);
      expect(c.read(collapsedSectionsProvider), isEmpty);
      expect(prefs.lastSaved, isEmpty);
    });
  });

  // Genuine persistence: the DEFAULT gateway against a real in-memory Drift Store.
  // Proves "collapsed state persists across app restarts" (BDD).
  group('StoreFilterSectionPrefs (real Store round-trip)', () {
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
    setUp(() async => Store.put(StoreKey.filterSheetCollapsedSections, '[]'));

    test('save then load round-trips through Store', () async {
      const prefs = StoreFilterSectionPrefs();
      expect(prefs.loadCollapsed(), isEmpty);
      await prefs.saveCollapsed({FilterSectionId.tags, FilterSectionId.media});
      expect(prefs.loadCollapsed(), {FilterSectionId.tags, FilterSectionId.media});
    });

    test('a fresh provider container loads the persisted set (simulated restart)', () async {
      await const StoreFilterSectionPrefs().saveCollapsed({FilterSectionId.people});
      final c = ProviderContainer(); // default gateway → reads real Store
      addTearDown(c.dispose);
      expect(c.read(collapsedSectionsProvider), {FilterSectionId.people});
    });
  });
}
