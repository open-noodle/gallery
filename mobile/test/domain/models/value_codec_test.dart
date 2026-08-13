import 'package:flutter_test/flutter_test.dart';
import 'package:immich_mobile/domain/models/settings_key.dart';
import 'package:immich_mobile/domain/models/value_codec.dart';
import 'package:immich_mobile/pages/library/spaces/collection_sort.dart';

void main() {
  group('EnumCodec', () {
    test('round-trips a known value', () {
      const codec = EnumCodec(SpaceAlbumSortMode.values);
      expect(codec.encode(SpaceAlbumSortMode.photoCount), 'photoCount');
      expect(codec.decode('photoCount'), SpaceAlbumSortMode.photoCount);
    });

    // S25 — a value written by a newer build must not crash an older one at
    // startup. CachedKeyValueRepository._build calls decode unguarded and
    // SettingsRepository.ensureInitialized awaits it during app launch.
    test('returns the declared fallback for an unrecognised name', () {
      const codec = EnumCodec(SpaceAlbumSortMode.values, fallback: SpaceAlbumSortMode.recentlyLinked);
      expect(codec.decode('aModeFromTheFuture'), SpaceAlbumSortMode.recentlyLinked);
      expect(codec.decode(''), SpaceAlbumSortMode.recentlyLinked);
    });

    test('falls back to the first value when no fallback is declared', () {
      const codec = EnumCodec(SpaceAlbumSortMode.values);
      expect(codec.decode('nope'), SpaceAlbumSortMode.values.first);
    });

    // S25, asserted on the actual wired key rather than a local EnumCodec —
    // deleting the `fallback:` argument from
    // SettingsKey.spaceAlbumsSortMode's declaration must fail this test.
    test('SettingsKey.spaceAlbumsSortMode falls back to recentlyLinked for an unrecognised name', () {
      expect(SettingsKey.spaceAlbumsSortMode.decode('aModeFromTheFuture'), SpaceAlbumSortMode.recentlyLinked);
      expect(SettingsKey.spaceAlbumsSortMode.decode('recentlyUpdated'), SpaceAlbumSortMode.recentlyUpdated);
    });
  });
}
