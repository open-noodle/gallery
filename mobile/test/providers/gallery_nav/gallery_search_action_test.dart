import 'dart:async';
import 'package:fake_async/fake_async.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/gallery/search/search_mode.provider.dart';
import 'package:immich_mobile/providers/gallery_nav/gallery_search_action.dart';
import 'package:immich_mobile/providers/gallery_nav/gallery_tab_enum.dart';
import 'package:immich_mobile/providers/haptic_feedback.provider.dart';

import '../../test_helpers/fake_tabs_router.dart';

/// Subclass of HapticNotifier that overrides selectionClick to count calls
/// without reading from appSettingsServiceProvider (keeps the test hermetic).
class _HapticSpy extends HapticNotifier {
  int selectionClicks = 0;
  _HapticSpy(super.ref);

  @override
  dynamic selectionClick() {
    selectionClicks++;
    return null;
  }
}

ProviderContainer _container() =>
    ProviderContainer(overrides: [hapticFeedbackProvider.overrideWith((ref) => _HapticSpy(ref))]);

// The search button always opens Photos search mode (specs/2026-10-23-mobile-search-redesign-design.md, Slice 5
// "Entry"); there is no preview switch and no filter sheet any more.
void main() {
  test('already on Photos: no tab switch, no delay, search mode opens', () async {
    final router = FakeTabsRouter(initialIndex: kGalleryPhotosIndex);
    final c = _container();
    addTearDown(c.dispose);
    final haptic = c.read(hapticFeedbackProvider.notifier) as _HapticSpy;

    await openGallerySearch(router, c.read);

    expect(router.setCalls, isEmpty);
    expect(c.read(searchModeProvider), isTrue);
    expect(haptic.selectionClicks, 1);
  });

  test('from Albums: setActiveIndex(photos), 620ms delay, then search mode', () {
    fakeAsync((async) {
      final router = FakeTabsRouter(initialIndex: kGalleryCollectionIndex);
      final c = _container();
      addTearDown(c.dispose);

      unawaited(openGallerySearch(router, c.read));
      async.flushMicrotasks();

      expect(router.setCalls, [kGalleryPhotosIndex]);
      expect(c.read(searchModeProvider), isFalse, reason: 'search mode waits for the tab transition');

      async.elapse(const Duration(milliseconds: 619));
      expect(c.read(searchModeProvider), isFalse, reason: 'still under 620ms');

      async.elapse(const Duration(milliseconds: 2));
      expect(c.read(searchModeProvider), isTrue);
    });
  });

  test('search mode already open: it stays open, and the haptic fires once per tap', () async {
    final router = FakeTabsRouter(initialIndex: kGalleryPhotosIndex);
    final c = _container();
    addTearDown(c.dispose);
    final haptic = c.read(hapticFeedbackProvider.notifier) as _HapticSpy;

    await openGallerySearch(router, c.read);
    await openGallerySearch(router, c.read);

    expect(c.read(searchModeProvider), isTrue);
    expect(haptic.selectionClicks, 2);
  });

  test('user taps a different tab mid-delay: no crash, deferred open accepted', () {
    fakeAsync((async) {
      final router = FakeTabsRouter(initialIndex: kGalleryCollectionIndex);
      final c = _container();
      addTearDown(c.dispose);

      unawaited(openGallerySearch(router, c.read));
      async.elapse(const Duration(milliseconds: 100));
      router.setActiveIndex(kGalleryLibraryIndex);
      async.elapse(const Duration(milliseconds: 700));

      expect(c.read(searchModeProvider), isTrue);
      expect(router.activeIndex, kGalleryLibraryIndex);
    });
  });
}
