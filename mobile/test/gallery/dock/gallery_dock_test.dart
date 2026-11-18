import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/gallery/dock/gallery_dock.widget.dart';
import 'package:immich_mobile/gallery/dock/gallery_dock_fold.dart';
import 'package:immich_mobile/providers/gallery_nav/gallery_tab_enum.dart';

import '../../widget_tester_extensions.dart';

const _slots = [GalleryTabEnum.photos, GalleryTabEnum.spaces, GalleryTabEnum.library];
const _width = 360.0;

class _Taps {
  final tabs = <GalleryTabEnum>[];
  int search = 0;
  int circle = 0;
}

Widget _host(
  GalleryDockMode mode, {
  GalleryTabEnum active = GalleryTabEnum.photos,
  bool showGrouping = true,
  bool searchEnabled = true,
  Set<GalleryTabEnum> disabled = const {},
  TextDirection direction = TextDirection.ltr,
  _Taps? taps,
}) {
  final t = taps ?? _Taps();
  return ProviderScope(
    child: MaterialApp(
      home: Directionality(
        textDirection: direction,
        child: Scaffold(
          body: Align(
            alignment: Alignment.bottomLeft,
            child: SizedBox(
              width: _width,
              child: GalleryDock(
                slots: _slots,
                activeTab: active,
                mode: mode,
                showGrouping: showGrouping,
                searchEnabled: searchEnabled,
                disabledTabs: disabled,
                onTabTap: t.tabs.add,
                onSearchTap: () => t.search++,
                onCircleTap: () => t.circle++,
              ),
            ),
          ),
        ),
      ),
    ),
  );
}

Rect _rect(WidgetTester tester, String key) => tester.getRect(find.byKey(Key(key)));

double _opacityAbove(WidgetTester tester, Finder finder) {
  final opacities = tester.widgetList<AnimatedOpacity>(
    find.ancestor(of: finder, matching: find.byType(AnimatedOpacity)),
  );
  return opacities.fold(1.0, (value, o) => value * o.opacity);
}

void main() {
  group('geometry', () {
    testWidgets('unfolded on Photos: grouping row above a full-width tab bar, search in the last slot', (tester) async {
      await tester.pumpWidget(localizedForTest(_host(GalleryDockMode.unfolded)));
      await tester.pumpAndSettle();

      final dock = _rect(tester, 'gallery-dock');
      final tabs = _rect(tester, 'gallery-dock-tabs');
      final grouping = _rect(tester, 'gallery-dock-grouping');
      final search = _rect(tester, 'gallery-dock-search');

      expect(dock.height, GalleryDock.tabBarHeight + GalleryDock.rowGap + GalleryDock.groupingHeight);
      expect(tabs, Rect.fromLTWH(0, dock.bottom - GalleryDock.tabBarHeight, _width, GalleryDock.tabBarHeight));
      expect(grouping.bottom, tabs.top - GalleryDock.rowGap);
      expect(grouping.width, _width);
      expect(search.left, closeTo(_width * 3 / 4, 0.01));
      expect(search.bottom, dock.bottom);
    });

    testWidgets('folded: the tab circle, the grouping control between, the search circle', (tester) async {
      await tester.pumpWidget(localizedForTest(_host(GalleryDockMode.folded)));
      await tester.pumpAndSettle();

      final dock = _rect(tester, 'gallery-dock');
      final tabs = _rect(tester, 'gallery-dock-tabs');
      final grouping = _rect(tester, 'gallery-dock-grouping');
      final search = _rect(tester, 'gallery-dock-search');
      const c = GalleryDock.circle;

      expect(tabs, Rect.fromLTWH(0, dock.bottom - c, c, c));
      expect(search, Rect.fromLTWH(_width - c, dock.bottom - c, c, c));
      expect(grouping.left, c + GalleryDock.rowGap);
      expect(grouping.right, _width - c - GalleryDock.rowGap);
      expect(grouping.bottom, dock.bottom);
      // Folding never changes the room the dock keeps, so the content under it does not jump.
      expect(dock.height, GalleryDock.reservedHeight(showGrouping: true));
    });

    testWidgets('search: the grouping row fills everything after the tab circle and search is gone', (tester) async {
      await tester.pumpWidget(localizedForTest(_host(GalleryDockMode.search)));
      await tester.pumpAndSettle();

      final dock = _rect(tester, 'gallery-dock');
      final grouping = _rect(tester, 'gallery-dock-grouping');

      expect(grouping.left, GalleryDock.circle + GalleryDock.rowGap);
      expect(grouping.right, _width);
      expect(grouping.bottom, dock.bottom, reason: 'the grouping row sits on the bottom edge, never mid-screen');
      expect(_opacityAbove(tester, find.byKey(const Key('gallery-dock-search'))), 0);
    });

    testWidgets('right to left: the tab circle sits on the right and search on the left', (tester) async {
      await tester.pumpWidget(localizedForTest(_host(GalleryDockMode.folded, direction: TextDirection.rtl)));
      await tester.pumpAndSettle();

      expect(_rect(tester, 'gallery-dock-tabs').right, _width);
      expect(_rect(tester, 'gallery-dock-search').left, 0);
    });

    testWidgets('other tabs: no grouping row, and the dock keeps only the tab bar height', (tester) async {
      await tester.pumpWidget(
        localizedForTest(_host(GalleryDockMode.unfolded, active: GalleryTabEnum.spaces, showGrouping: false)),
      );
      await tester.pumpAndSettle();

      expect(_rect(tester, 'gallery-dock').height, GalleryDock.tabBarHeight);
      expect(_opacityAbove(tester, find.byKey(const Key('gallery-dock-grouping'))), 0);
    });
  });

  group('taps', () {
    testWidgets('unfolded: a tab reports itself and search opens search', (tester) async {
      final taps = _Taps();
      await tester.pumpWidget(localizedForTest(_host(GalleryDockMode.unfolded, taps: taps)));
      await tester.pumpAndSettle();

      await tester.tap(find.byKey(const Key('gallery-dock-tab-library')));
      await tester.tap(find.byKey(const Key('gallery-dock-search')));
      await tester.pumpAndSettle();

      expect(taps.tabs, [GalleryTabEnum.library]);
      expect(taps.search, 1);
      expect(taps.circle, 0);
    });

    testWidgets('folded: the circle is one target that unfolds, never a tab switch', (tester) async {
      final taps = _Taps();
      await tester.pumpWidget(localizedForTest(_host(GalleryDockMode.folded, taps: taps)));
      await tester.pumpAndSettle();

      await tester.tap(find.byKey(const Key('gallery-dock-tabs')));
      await tester.pumpAndSettle();

      expect(taps.circle, 1);
      expect(taps.tabs, isEmpty);
    });

    testWidgets('read-only: disabled tabs and search ignore taps', (tester) async {
      final taps = _Taps();
      await tester.pumpWidget(
        localizedForTest(
          _host(
            GalleryDockMode.unfolded,
            taps: taps,
            searchEnabled: false,
            disabled: {GalleryTabEnum.spaces, GalleryTabEnum.library},
          ),
        ),
      );
      await tester.pumpAndSettle();

      await tester.tap(find.byKey(const Key('gallery-dock-tab-spaces')), warnIfMissed: false);
      await tester.tap(find.byKey(const Key('gallery-dock-search')), warnIfMissed: false);
      await tester.tap(find.byKey(const Key('gallery-dock-tab-photos')));
      await tester.pumpAndSettle();

      expect(taps.tabs, [GalleryTabEnum.photos]);
      expect(taps.search, 0);
    });
  });

  group('scroll folding', () {
    Future<ProviderContainer> pumpList(WidgetTester tester, {ScrollController? controller}) async {
      final container = ProviderContainer();
      addTearDown(container.dispose);
      await tester.pumpWidget(
        UncontrolledProviderScope(
          container: container,
          child: MaterialApp(
            home: GalleryDockScrollListener(
              child: ListView(
                key: const Key('list'),
                controller: controller,
                children: [
                  SizedBox(
                    height: 120,
                    child: ListView(
                      key: const Key('row'),
                      scrollDirection: Axis.horizontal,
                      children: [for (var i = 0; i < 30; i++) const SizedBox(width: 100)],
                    ),
                  ),
                  for (var i = 0; i < 100; i++) const SizedBox(height: 80),
                ],
              ),
            ),
          ),
        ),
      );
      return container;
    }

    testWidgets('scrolling down folds the dock and scrolling up unfolds it', (tester) async {
      final container = await pumpList(tester);

      await tester.drag(find.byKey(const Key('list')), const Offset(0, -400));
      await tester.pump();
      expect(container.read(galleryDockFoldedProvider), isTrue);

      await tester.drag(find.byKey(const Key('list')), const Offset(0, 100));
      await tester.pump();
      expect(container.read(galleryDockFoldedProvider), isFalse);
    });

    testWidgets('a short wiggle under the threshold changes nothing', (tester) async {
      final controller = ScrollController();
      addTearDown(controller.dispose);
      final container = await pumpList(tester, controller: controller);

      controller.jumpTo(400);
      await tester.pump();
      controller.jumpTo(800);
      await tester.pump();
      expect(container.read(galleryDockFoldedProvider), isTrue);

      // Back up by less than the threshold: still folded.
      controller.jumpTo(800 - GalleryDockScrollListener.travel + 8);
      await tester.pump();
      expect(container.read(galleryDockFoldedProvider), isTrue);

      // Further up, past it: unfolded.
      controller.jumpTo(800 - GalleryDockScrollListener.travel - 8);
      await tester.pump();
      expect(container.read(galleryDockFoldedProvider), isFalse);
    });

    testWidgets('back near the top always unfolds', (tester) async {
      final container = await pumpList(tester);
      await tester.drag(find.byKey(const Key('list')), const Offset(0, -400));
      await tester.pump();
      container.read(galleryDockFoldedProvider.notifier).state = true;

      await tester.drag(find.byKey(const Key('list')), const Offset(0, 1000));
      await tester.pumpAndSettle();
      expect(container.read(galleryDockFoldedProvider), isFalse);
    });

    // On device: switching Years / Months / All, or a tab page rebuilt by the nav setting, puts a fresh list at the
    // top without any scroll, which left the dock folded over the top of the page.
    testWidgets('content swapped for a fresh list at the top unfolds the dock', (tester) async {
      final container = await pumpList(tester);
      await tester.drag(find.byKey(const Key('list')), const Offset(0, -400));
      await tester.pump();
      expect(container.read(galleryDockFoldedProvider), isTrue);

      await tester.pumpWidget(
        UncontrolledProviderScope(
          container: container,
          child: MaterialApp(
            home: GalleryDockScrollListener(
              child: ListView(
                key: const Key('fresh'),
                children: [for (var i = 0; i < 100; i++) const SizedBox(height: 80)],
              ),
            ),
          ),
        ),
      );
      await tester.pump();
      expect(container.read(galleryDockFoldedProvider), isFalse);
    });

    testWidgets('pulling down at the top unfolds the dock, though nothing scrolls', (tester) async {
      final container = await pumpList(tester);
      container.read(galleryDockFoldedProvider.notifier).state = true;

      await tester.drag(find.byKey(const Key('list')), const Offset(0, 200));
      await tester.pumpAndSettle();
      expect(container.read(galleryDockFoldedProvider), isFalse);
    });

    testWidgets('a horizontal row never folds the dock', (tester) async {
      final container = await pumpList(tester);

      await tester.drag(find.byKey(const Key('row')), const Offset(-600, 0));
      await tester.pumpAndSettle();
      expect(container.read(galleryDockFoldedProvider), isFalse);
    });
  });
}
