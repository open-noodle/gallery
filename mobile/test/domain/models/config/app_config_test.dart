import 'package:flutter_test/flutter_test.dart';
import 'package:immich_mobile/domain/models/config/app_config.dart';
import 'package:immich_mobile/domain/models/settings_key.dart';
import 'package:immich_mobile/pages/library/spaces/collection_sort.dart';

void main() {
  group('AppConfig spaces & space-albums sort prefs', () {
    test('space-album + spaces sort prefs round-trip and default correctly', () {
      const c = AppConfig();
      expect(c.spaceAlbums.sortMode, SpaceAlbumSortMode.recentlyLinked); // default
      expect(c.spaces.sortMode, SpaceSortMode.recentActivity); // default

      final w = c
          .write(SettingsKey.spaceAlbumsSortMode, SpaceAlbumSortMode.name)
          .write(SettingsKey.spaceAlbumsIsReverse, true)
          .write(SettingsKey.spacesSortMode, SpaceSortMode.members);
      expect(w.read(SettingsKey.spaceAlbumsSortMode), SpaceAlbumSortMode.name);
      expect(w.read(SettingsKey.spaceAlbumsIsReverse), true);
      expect(w.read(SettingsKey.spacesSortMode), SpaceSortMode.members);
    });

    test('spaces isReverse defaults to false and round-trips', () {
      const c = AppConfig();
      expect(c.spaces.isReverse, false);

      final w = c.write(SettingsKey.spacesIsReverse, true);
      expect(w.read(SettingsKey.spacesIsReverse), true);
    });
  });
}
