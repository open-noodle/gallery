import 'package:easy_localization/easy_localization.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:immich_mobile/presentation/widgets/gallery_nav/animated_nav_icon.widget.dart';
import 'package:immich_mobile/presentation/widgets/gallery_nav/gallery_nav_segment.widget.dart';
import 'package:immich_mobile/providers/gallery_nav/gallery_tab_enum.dart';

import '../../../widget_tester_extensions.dart';

void main() {
  testWidgets('idle: icon slot collapsed (widthFactor 0), label shown', (tester) async {
    await tester.pumpConsumerWidget(GalleryNavSegment(tab: GalleryTabEnum.photos, active: false, onTap: () {}));
    await tester.pumpAndSettle();
    final align = tester.widget<Align>(find.byKey(const Key('gallery-nav-segment-icon-slot')));
    expect(align.widthFactor, 0.0, reason: 'idle icon slot has 0 width');
    expect(find.text('nav_photos'.tr()), findsOneWidget);
    expect(find.byType(AnimatedNavIcon), findsOneWidget);
  });

  testWidgets('active: icon slot expanded (widthFactor 1), icon + label rendered', (tester) async {
    await tester.pumpConsumerWidget(GalleryNavSegment(tab: GalleryTabEnum.photos, active: true, onTap: () {}));
    await tester.pumpAndSettle();
    final align = tester.widget<Align>(find.byKey(const Key('gallery-nav-segment-icon-slot')));
    expect(align.widthFactor, 1.0);
    expect(find.byType(AnimatedNavIcon), findsOneWidget);
    expect(find.text('nav_photos'.tr()), findsOneWidget);
  });

  testWidgets('active→idle transition: icon-slot collapses after settle', (tester) async {
    final active = ValueNotifier<bool>(true);
    await tester.pumpConsumerWidget(
      ValueListenableBuilder<bool>(
        valueListenable: active,
        builder: (_, v, __) => GalleryNavSegment(tab: GalleryTabEnum.photos, active: v, onTap: () {}),
      ),
    );
    await tester.pumpAndSettle();
    final sizeActive = tester.getSize(find.byKey(const Key('gallery-nav-segment-icon-slot')));

    active.value = false;
    await tester.pumpAndSettle();
    final sizeIdle = tester.getSize(find.byKey(const Key('gallery-nav-segment-icon-slot')));

    expect(sizeIdle.width, lessThan(sizeActive.width), reason: 'idle icon slot collapses smaller than active');
  });

  testWidgets('tap invokes onTap', (tester) async {
    int taps = 0;
    await tester.pumpConsumerWidget(GalleryNavSegment(tab: GalleryTabEnum.albums, active: false, onTap: () => taps++));
    await tester.tap(find.byType(GalleryNavSegment));
    expect(taps, 1);
  });

  testWidgets('active segment is a semantics live region', (tester) async {
    await tester.pumpConsumerWidget(GalleryNavSegment(tab: GalleryTabEnum.library, active: true, onTap: () {}));
    final semantics = tester.getSemantics(find.byType(GalleryNavSegment));
    expect(semantics.flagsCollection.isLiveRegion, isTrue);
  });

  testWidgets('tap target ≥ 44×44 pt', (tester) async {
    await tester.pumpConsumerWidget(GalleryNavSegment(tab: GalleryTabEnum.photos, active: true, onTap: () {}));
    expectTapTargetMin(tester, find.byType(GalleryNavSegment), min: 44);
  });

  testWidgets('dark theme: active label is non-null and has w500', (tester) async {
    await tester.pumpConsumerWidgetDark(GalleryNavSegment(tab: GalleryTabEnum.photos, active: true, onTap: () {}));
    final text = tester.widget<Text>(find.text('nav_photos'.tr()));
    expect(text.style!.color, isNotNull);
    expect(text.style!.fontWeight, FontWeight.w500);
  });
}
