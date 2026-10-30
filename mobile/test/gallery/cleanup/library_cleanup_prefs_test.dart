import 'package:flutter_test/flutter_test.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/domain/models/store.model.dart';
import 'package:immich_mobile/entities/store.entity.dart';
import 'package:immich_mobile/gallery/cleanup/cleanup_prefs.dart';
import 'package:immich_mobile/gallery/cleanup/models/library_cleanup_filters.dart';
import 'package:immich_mobile/gallery/cleanup/models/library_cleanup_queue.dart';
import 'package:openapi/api.dart';

import 'cleanup_test_utils.dart';

// Slice 1, "Prefs".
//
// Given nothing stored             When prefs are read   Then swipe mode, Swipe for every queue, no filters, overlay not seen
// Given a corrupt stored value     When prefs are read   Then the same defaults
// Given a choice made              When prefs are read in a fresh app   Then it is remembered, in the one StoreKey.libraryCleanupPrefs
// Given a half-damaged value       When read   Then the good fields survive and the bad ones are their defaults

void main() {
  setUpAll(initTestStore);

  setUp(() async {
    await Store.clear();
  });

  ProviderContainer fresh() {
    final container = ProviderContainer();
    addTearDown(container.dispose);
    return container;
  }

  test('with nothing stored the prefs are the defaults', () {
    final prefs = fresh().read(libraryCleanupPrefsProvider);

    expect(prefs.deckMode, LibraryCleanupDeckMode.swipe);
    for (final queue in LibraryCleanupQueue.values) {
      expect(prefs.viewFor(queue), LibraryCleanupView.swipe);
    }
    expect(prefs.filters, isEmpty);
    expect(prefs.filtersFor(LibraryCleanupQueue.blurry), LibraryCleanupFilters.defaults(LibraryCleanupQueue.blurry));
    expect(prefs.overlaySeen, isFalse);
    expect(prefs.gridHintSeen, isFalse);
  });

  for (final corrupt in ['not json', '[1, 2]', '{"deckMode": 5, "views": "x", "filters": []}', '']) {
    test('a corrupt stored value ($corrupt) reads as the defaults', () async {
      await Store.put(StoreKey.libraryCleanupPrefs, corrupt);

      final prefs = fresh().read(libraryCleanupPrefsProvider);

      expect(prefs.deckMode, LibraryCleanupDeckMode.swipe);
      expect(prefs.views, isEmpty);
      expect(prefs.filters, isEmpty);
      expect(prefs.overlaySeen, isFalse);
    });
  }

  test('every choice is remembered in the single store key', () async {
    final first = fresh();
    final notifier = first.read(libraryCleanupPrefsProvider.notifier);
    notifier.setDeckMode(LibraryCleanupDeckMode.button);
    notifier.setView(LibraryCleanupQueue.screenshots, LibraryCleanupView.grid);
    notifier.setFilters(
      LibraryCleanupFilters.defaults(
        LibraryCleanupQueue.blurry,
      ).copyWith(strictness: CleanupStrictness.strict, reason: CleanupBlurReason.dark, hideFaces: false),
    );
    notifier.setFilters(
      LibraryCleanupFilters.defaults(
        LibraryCleanupQueue.spaceHogs,
      ).copyWith(type: CleanupAssetTypeFilter.all, minSize: 524288000),
    );
    notifier.markOverlaySeen();
    notifier.markSeriesOverlaySeen();
    notifier.markGridHintSeen();
    await pumpEvents();

    // A new container is a new app run: only the Store carries over.
    final prefs = fresh().read(libraryCleanupPrefsProvider);

    expect(prefs.deckMode, LibraryCleanupDeckMode.button);
    expect(prefs.viewFor(LibraryCleanupQueue.screenshots), LibraryCleanupView.grid);
    expect(prefs.viewFor(LibraryCleanupQueue.blurry), LibraryCleanupView.swipe);
    final blurry = prefs.filtersFor(LibraryCleanupQueue.blurry);
    expect(
      [blurry.strictness, blurry.reason, blurry.hideFaces],
      [CleanupStrictness.strict, CleanupBlurReason.dark, false],
    );
    final hogs = prefs.filtersFor(LibraryCleanupQueue.spaceHogs);
    expect([hogs.type, hogs.minSize], [CleanupAssetTypeFilter.all, 524288000]);
    expect(prefs.overlaySeen, isTrue);
    expect(prefs.seriesOverlaySeen, isTrue);
    expect(prefs.gridHintSeen, isTrue);
    expect(Store.tryGet(StoreKey.libraryCleanupPrefs), isA<String>());
  });

  test('a damaged field falls back to its default and the rest survives', () async {
    await Store.put(
      StoreKey.libraryCleanupPrefs,
      '{"deckMode":"button","views":{"blurry":"grid","nope":"grid","bursts":"sideways"},'
      '"filters":{"blurry":{"strictness":"strict","reason":"bogus","hideFaces":"yes"},"screenshots":{"x":1}},'
      '"overlaySeen":true}',
    );

    final prefs = fresh().read(libraryCleanupPrefsProvider);

    expect(prefs.deckMode, LibraryCleanupDeckMode.button);
    expect(prefs.views, {LibraryCleanupQueue.blurry: LibraryCleanupView.grid});
    final blurry = prefs.filtersFor(LibraryCleanupQueue.blurry);
    expect(blurry.strictness, CleanupStrictness.strict);
    expect(blurry.reason, CleanupBlurReason.all, reason: 'an unknown reason is the default');
    expect(blurry.hideFaces, isTrue, reason: 'a non-boolean is the default');
    expect(prefs.filters.keys, [LibraryCleanupQueue.blurry], reason: 'screenshots has no filters to remember');
    expect(prefs.overlaySeen, isTrue);
  });
}
