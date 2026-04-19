import 'package:easy_localization/easy_localization.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:immich_mobile/presentation/widgets/gallery_nav/gallery_nav_pill.widget.dart';
import 'package:immich_mobile/providers/gallery_nav/gallery_tab_enum.dart';

import '../../../widget_tester_extensions.dart';

class _Harness extends StatefulWidget {
  @override
  State<_Harness> createState() => _HarnessState();
}

class _HarnessState extends State<_Harness> {
  GalleryTabEnum active = GalleryTabEnum.photos;
  void switchTo(GalleryTabEnum t) => setState(() => active = t);
  @override
  Widget build(BuildContext context) => GalleryNavPill(activeTab: active, onTabTap: (t) => setState(() => active = t));
}

void main() {
  testWidgets('renders 3 segments in canonical order', (tester) async {
    await tester.pumpConsumerWidget(
      SizedBox(
        width: 360,
        child: GalleryNavPill(activeTab: GalleryTabEnum.photos, onTabTap: (_) {}),
      ),
    );
    await tester.pumpAndSettle();
    expect(find.text('nav_photos'.tr()), findsOneWidget);
    expect(find.text('nav_albums'.tr()), findsOneWidget);
    expect(find.text('nav_library'.tr()), findsOneWidget);
  });

  testWidgets('tap on a segment invokes onTabTap with its enum', (tester) async {
    GalleryTabEnum? tapped;
    await tester.pumpConsumerWidget(
      SizedBox(
        width: 360,
        child: GalleryNavPill(activeTab: GalleryTabEnum.photos, onTabTap: (t) => tapped = t),
      ),
    );
    await tester.pumpAndSettle();
    await tester.tap(find.text('nav_albums'.tr()));
    expect(tapped, GalleryTabEnum.albums);
  });

  testWidgets('only active segment renders its icon', (tester) async {
    await tester.pumpConsumerWidget(
      SizedBox(
        width: 360,
        child: GalleryNavPill(activeTab: GalleryTabEnum.albums, onTabTap: (_) {}),
      ),
    );
    await tester.pumpAndSettle();
    expect(find.byIcon(Icons.photo_album), findsOneWidget);
    // Photos is idle — outlined icon is in the tree (AnimatedCrossFade keeps
    // both layered) but the Align collapses it to 0 width.
  });

  testWidgets('organic widths: active segment wider than idle sibling', (tester) async {
    await tester.pumpConsumerWidget(
      SizedBox(
        width: 360,
        child: GalleryNavPill(activeTab: GalleryTabEnum.photos, onTabTap: (_) {}),
      ),
    );
    await tester.pumpAndSettle();
    final activeSize = tester.getSize(find.byKey(const Key('gallery-nav-segment-photos')));
    final idleSize = tester.getSize(find.byKey(const Key('gallery-nav-segment-albums')));
    expect(
      activeSize.width,
      greaterThan(idleSize.width + 18),
      reason: 'active includes icon + gap + extra padding; not uniform 1/3 widths',
    );
  });

  testWidgets('first-paint underlay sits under the active segment', (tester) async {
    await tester.pumpConsumerWidget(
      SizedBox(
        width: 360,
        child: GalleryNavPill(activeTab: GalleryTabEnum.photos, onTabTap: (_) {}),
      ),
    );
    await tester.pumpAndSettle();
    final segmentRect = tester.getRect(find.byKey(const Key('gallery-nav-segment-photos')));
    final underlayRect = tester.getRect(find.byKey(const Key('gallery-nav-underlay')));
    expect((underlayRect.left - segmentRect.left).abs(), lessThan(0.5));
    expect((underlayRect.width - segmentRect.width).abs(), lessThan(0.5));
  });

  testWidgets('underlay tracks newly-active segment after tab change (Photos→Albums→Library)', (tester) async {
    // Regression: the rect-diff guard used Map.toString for equality, which
    // collapses to "Instance of 'Rect'" in profile mode — so _segmentRects
    // never updated after the initial mount and the underlay stayed pinned
    // to the default-active segment's rect.
    await tester.pumpConsumerWidget(SizedBox(width: 360, child: _Harness()));
    await tester.pumpAndSettle();

    final harness = tester.state<_HarnessState>(find.byType(_Harness));

    harness.switchTo(GalleryTabEnum.albums);
    await tester.pumpAndSettle();
    final albumsSeg = tester.getRect(find.byKey(const Key('gallery-nav-segment-albums')));
    final underlayAfterAlbums = tester.getRect(find.byKey(const Key('gallery-nav-underlay')));
    expect(
      (underlayAfterAlbums.left - albumsSeg.left).abs(),
      lessThan(0.5),
      reason: 'underlay left should match albums segment left after switching',
    );
    expect(
      (underlayAfterAlbums.width - albumsSeg.width).abs(),
      lessThan(0.5),
      reason: 'underlay width should match albums segment width — prevents icon rendering outside',
    );

    harness.switchTo(GalleryTabEnum.library);
    await tester.pumpAndSettle();
    final librarySeg = tester.getRect(find.byKey(const Key('gallery-nav-segment-library')));
    final underlayAfterLibrary = tester.getRect(find.byKey(const Key('gallery-nav-underlay')));
    expect((underlayAfterLibrary.left - librarySeg.left).abs(), lessThan(0.5));
    expect((underlayAfterLibrary.width - librarySeg.width).abs(), lessThan(0.5));
  });

  testWidgets('disabledTabs: dims Albums+Library to 0.3 opacity, blocks taps', (tester) async {
    int tapped = -1;
    await tester.pumpConsumerWidget(
      SizedBox(
        width: 360,
        child: GalleryNavPill(
          activeTab: GalleryTabEnum.photos,
          disabledTabs: const {GalleryTabEnum.albums, GalleryTabEnum.library},
          onTabTap: (t) => tapped = t.index,
        ),
      ),
    );
    await tester.pumpAndSettle();

    final albumsOpacity = tester.widget<Opacity>(
      find.ancestor(of: find.byKey(const Key('gallery-nav-segment-albums')), matching: find.byType(Opacity)),
    );
    expect(albumsOpacity.opacity, closeTo(0.3, 0.001));

    final photosOpacity = tester.widget<Opacity>(
      find.ancestor(of: find.byKey(const Key('gallery-nav-segment-photos')), matching: find.byType(Opacity)),
    );
    expect(photosOpacity.opacity, 1.0);

    await tester.tap(find.text('nav_albums'.tr()));
    await tester.pumpAndSettle();
    expect(tapped, -1, reason: 'disabled segment should not invoke onTabTap');

    await tester.tap(find.text('nav_photos'.tr()));
    await tester.pumpAndSettle();
    expect(tapped, GalleryTabEnum.photos.index);
  });

  testWidgets('light-theme variant: active fill opacity ≈ 0.22', (tester) async {
    await tester.pumpConsumerWidget(
      SizedBox(
        width: 360,
        child: GalleryNavPill(activeTab: GalleryTabEnum.photos, onTabTap: (_) {}),
      ),
    );
    await tester.pumpAndSettle();
    final underlayBox = tester.widget<DecoratedBox>(
      find.descendant(of: find.byKey(const Key('gallery-nav-underlay')), matching: find.byType(DecoratedBox)),
    );
    final color = (underlayBox.decoration as BoxDecoration).color!;
    expect(color.a, closeTo(0.22, 0.01));
  });

  testWidgets('inner-warmth highlight is rendered below underlay in stack order', (tester) async {
    await tester.pumpConsumerWidget(
      SizedBox(
        width: 360,
        child: GalleryNavPill(activeTab: GalleryTabEnum.photos, onTabTap: (_) {}),
      ),
    );
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('gallery-nav-inner-warmth')), findsOneWidget);
    final stackFinder = find.descendant(of: find.byType(GalleryNavPill), matching: find.byType(Stack)).first;
    final stack = tester.widget<Stack>(stackFinder);
    final warmthIdx = stack.children.indexWhere((w) => w.key == const Key('gallery-nav-inner-warmth'));
    final underlayIdx = stack.children.indexWhere((w) => w.key == const Key('gallery-nav-underlay'));
    expect(warmthIdx, lessThan(underlayIdx));
  });

  testWidgets('disableAnimations: underlay moves in one frame', (tester) async {
    final widget = SizedBox(
      width: 360,
      child: MediaQuery(data: const MediaQueryData(disableAnimations: true), child: _Harness()),
    );
    await tester.pumpConsumerWidget(widget);
    await tester.pumpAndSettle();
    final before = tester.getRect(find.byKey(const Key('gallery-nav-underlay')));
    final harness = tester.state<_HarnessState>(find.byType(_Harness));
    harness.switchTo(GalleryTabEnum.library);
    await tester.pump();
    await tester.pump();
    final after = tester.getRect(find.byKey(const Key('gallery-nav-underlay')));
    expect(after.left, isNot(equals(before.left)), reason: 'disableAnimations should snap in one frame, not tween');
  });
}
