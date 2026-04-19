import 'package:fake_async/fake_async.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/providers/gallery_nav/gallery_search_action.dart';
import 'package:immich_mobile/providers/gallery_nav/gallery_tab_enum.dart';
import 'package:immich_mobile/providers/haptic_feedback.provider.dart';
import 'package:immich_mobile/providers/photos_filter/filter_sheet.provider.dart';
import 'package:immich_mobile/providers/photos_filter/search_focus.provider.dart';

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

ProviderContainer _container({required FilterSheetSnap sheet, _HapticSpy? haptic}) {
  final c = ProviderContainer(
    overrides: [
      hapticFeedbackProvider.overrideWith((ref) => haptic ?? _HapticSpy(ref)),
      photosFilterSheetProvider.overrideWith((_) => sheet),
    ],
  );
  return c;
}

void main() {
  test('already on Photos: no tab switch, no delay, sheet→browse, focus++', () async {
    final router = FakeTabsRouter(initialIndex: GalleryTabEnum.photos.index);
    final c = _container(sheet: FilterSheetSnap.hidden);
    addTearDown(c.dispose);
    final haptic = c.read(hapticFeedbackProvider.notifier) as _HapticSpy;

    await openGallerySearch(router, c.read);

    expect(router.setCalls, isEmpty);
    expect(c.read(photosFilterSheetProvider), FilterSheetSnap.deep);
    expect(c.read(photosFilterSearchFocusRequestProvider), 1);
    expect(haptic.selectionClicks, 1);
  });

  test('from Albums: setActiveIndex(photos), 620ms delay, then sheet+focus', () {
    fakeAsync((async) {
      final router = FakeTabsRouter(initialIndex: GalleryTabEnum.albums.index);
      final c = _container(sheet: FilterSheetSnap.hidden);
      addTearDown(c.dispose);

      openGallerySearch(router, c.read);
      async.flushMicrotasks();

      expect(router.setCalls, [GalleryTabEnum.photos.index]);
      expect(c.read(photosFilterSheetProvider), FilterSheetSnap.hidden, reason: 'sheet waits for delay');
      expect(c.read(photosFilterSearchFocusRequestProvider), 0, reason: 'focus waits for delay');

      async.elapse(const Duration(milliseconds: 619));
      expect(c.read(photosFilterSheetProvider), FilterSheetSnap.hidden, reason: 'still under 620ms');

      async.elapse(const Duration(milliseconds: 2));
      expect(c.read(photosFilterSheetProvider), FilterSheetSnap.deep);
      expect(c.read(photosFilterSearchFocusRequestProvider), 1);
    });
  });

  test('sheet already at deep: write is no-op, focus still increments', () async {
    final router = FakeTabsRouter(initialIndex: GalleryTabEnum.photos.index);
    final c = _container(sheet: FilterSheetSnap.deep);
    addTearDown(c.dispose);

    await openGallerySearch(router, c.read);
    expect(c.read(photosFilterSheetProvider), FilterSheetSnap.deep);
    expect(c.read(photosFilterSearchFocusRequestProvider), 1);
  });

  test('sheet at browse: write transitions to deep, focus counter += 1', () async {
    final router = FakeTabsRouter(initialIndex: GalleryTabEnum.photos.index);
    final c = _container(sheet: FilterSheetSnap.browse);
    addTearDown(c.dispose);

    await openGallerySearch(router, c.read);
    expect(c.read(photosFilterSheetProvider), FilterSheetSnap.deep);
    expect(c.read(photosFilterSearchFocusRequestProvider), 1);
  });

  test('from Library: same behavior as Albums', () {
    fakeAsync((async) {
      final router = FakeTabsRouter(initialIndex: GalleryTabEnum.library.index);
      final c = _container(sheet: FilterSheetSnap.hidden);
      addTearDown(c.dispose);

      openGallerySearch(router, c.read);
      async.elapse(const Duration(milliseconds: 620));
      async.flushMicrotasks();

      expect(router.setCalls, [GalleryTabEnum.photos.index]);
      expect(c.read(photosFilterSheetProvider), FilterSheetSnap.deep);
      expect(c.read(photosFilterSearchFocusRequestProvider), 1);
    });
  });

  test('haptic fires exactly once per call regardless of sheet state', () async {
    for (final initial in [FilterSheetSnap.hidden, FilterSheetSnap.deep, FilterSheetSnap.deep]) {
      final router = FakeTabsRouter(initialIndex: GalleryTabEnum.photos.index);
      final c = _container(sheet: initial);
      final haptic = c.read(hapticFeedbackProvider.notifier) as _HapticSpy;

      await openGallerySearch(router, c.read);
      expect(haptic.selectionClicks, 1, reason: 'starting from $initial, haptic must fire exactly once');
      c.dispose();
    }
  });

  test('rapid second openGallerySearch mid-delay: +2 counter, no crash', () {
    fakeAsync((async) {
      final router = FakeTabsRouter(initialIndex: GalleryTabEnum.albums.index);
      final c = _container(sheet: FilterSheetSnap.hidden);
      addTearDown(c.dispose);

      openGallerySearch(router, c.read);
      async.elapse(const Duration(milliseconds: 300));
      openGallerySearch(router, c.read);
      async.elapse(const Duration(milliseconds: 700));

      expect(c.read(photosFilterSheetProvider), FilterSheetSnap.deep);
      expect(c.read(photosFilterSearchFocusRequestProvider), 2);
    });
  });

  test('user taps different tab mid-delay: no crash, deferred-open accepted', () {
    fakeAsync((async) {
      final router = FakeTabsRouter(initialIndex: GalleryTabEnum.albums.index);
      final c = _container(sheet: FilterSheetSnap.hidden);
      addTearDown(c.dispose);

      openGallerySearch(router, c.read);
      async.elapse(const Duration(milliseconds: 100));
      router.setActiveIndex(GalleryTabEnum.library.index);
      async.elapse(const Duration(milliseconds: 700));

      expect(c.read(photosFilterSheetProvider), FilterSheetSnap.deep);
      expect(c.read(photosFilterSearchFocusRequestProvider), 1);
      expect(router.activeIndex, GalleryTabEnum.library.index);
    });
  });
}
