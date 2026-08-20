import 'package:drift/drift.dart' as drift;
import 'package:drift/native.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/domain/models/store.model.dart';
import 'package:immich_mobile/domain/services/store.service.dart';
import 'package:immich_mobile/entities/store.entity.dart';
import 'package:immich_mobile/infrastructure/repositories/db.repository.dart';
import 'package:immich_mobile/infrastructure/repositories/store.repository.dart';
import 'package:immich_mobile/providers/game/hidden_daily_banner.provider.dart';

class _FakePrefs implements HiddenDailyBannerPrefs {
  Set<String> stored;
  Set<String>? lastSaved;
  _FakePrefs(this.stored);
  @override
  Set<String> loadHidden() => stored;
  @override
  Future<void> saveHidden(Set<String> spaceIds) async {
    lastSaved = spaceIds;
    stored = spaceIds;
  }
}

ProviderContainer _c(HiddenDailyBannerPrefs prefs) {
  final c = ProviderContainer(overrides: [hiddenDailyBannerPrefsProvider.overrideWithValue(prefs)]);
  addTearDown(c.dispose);
  return c;
}

void main() {
  group('codec', () {
    test('round-trips', () {
      final s = {'space-1', 'space-2'};
      expect(decodeHiddenDailyBanners(encodeHiddenDailyBanners(s)), s);
    });

    // A corrupt or hand-edited value must not take the space page down with it: every failure
    // decodes to "nothing hidden", which is the same as a fresh install.
    test('malformed input decodes to nothing hidden', () {
      expect(decodeHiddenDailyBanners('nope'), <String>{});
      expect(decodeHiddenDailyBanners('[]'), <String>{});
      expect(decodeHiddenDailyBanners('{"space-1":true}'), <String>{});
      expect(decodeHiddenDailyBanners('["space-1",7,null]'), {'space-1'});
    });
  });

  group('hiddenDailyBannerProvider (fake gateway)', () {
    // The default matters more than it looks: an empty set is what every existing install has, so
    // shipping this must not hide a banner anyone is already seeing.
    test('default: nothing hidden', () {
      final c = _c(_FakePrefs({}));
      expect(c.read(hiddenDailyBannerProvider), isEmpty);
      expect(c.read(hiddenDailyBannerProvider.notifier).isHidden('space-1'), isFalse);
    });

    test('loads the persisted hidden set', () {
      final c = _c(_FakePrefs({'space-1'}));
      expect(c.read(hiddenDailyBannerProvider.notifier).isHidden('space-1'), isTrue);
      expect(c.read(hiddenDailyBannerProvider.notifier).isHidden('space-2'), isFalse);
    });

    test('setHidden(true) hides, setHidden(false) shows, and both persist', () {
      final prefs = _FakePrefs({});
      final c = _c(prefs);
      final n = c.read(hiddenDailyBannerProvider.notifier);

      n.setHidden('space-1', true);
      expect(c.read(hiddenDailyBannerProvider), {'space-1'});
      expect(prefs.lastSaved, {'space-1'});

      n.setHidden('space-1', false);
      expect(c.read(hiddenDailyBannerProvider), isEmpty);
      expect(prefs.lastSaved, isEmpty);
    });

    // Hiding is per space, so one space's choice must not move another's.
    test('hiding one space leaves the others visible', () {
      final c = _c(_FakePrefs({}));
      final n = c.read(hiddenDailyBannerProvider.notifier);
      n.setHidden('space-1', true);
      expect(n.isHidden('space-1'), isTrue);
      expect(n.isHidden('space-2'), isFalse);
    });
  });

  group('StoreHiddenDailyBannerPrefs (real Store)', () {
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
    setUp(() async => Store.put(StoreKey.spacesHiddenDailyBanner, '[]'));

    test('save/load round-trips through Store; fresh container reloads (restart)', () async {
      const prefs = StoreHiddenDailyBannerPrefs();
      expect(prefs.loadHidden(), isEmpty);
      await prefs.saveHidden({'space-1'});
      expect(prefs.loadHidden(), {'space-1'});
      final c = ProviderContainer();
      addTearDown(c.dispose);
      expect(c.read(hiddenDailyBannerProvider), {'space-1'});
    });
  });
}
