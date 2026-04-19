import 'package:easy_localization/easy_localization.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:immich_mobile/presentation/widgets/gallery_nav/gallery_search_blob.widget.dart';

import '../../../widget_tester_extensions.dart';

void main() {
  testWidgets('renders search icon at 24pt', (tester) async {
    await tester.pumpConsumerWidget(GallerySearchBlob(enabled: true, onTap: () {}));
    await tester.pumpAndSettle();
    final icon = tester.widget<Icon>(find.byIcon(Icons.search));
    expect(icon.size, 24);
  });

  testWidgets('tap invokes onTap when enabled', (tester) async {
    int taps = 0;
    await tester.pumpConsumerWidget(GallerySearchBlob(enabled: true, onTap: () => taps++));
    await tester.tap(find.byType(GallerySearchBlob));
    expect(taps, 1);
  });

  testWidgets('disabled: opacity 0.3, taps ignored', (tester) async {
    int taps = 0;
    await tester.pumpConsumerWidget(GallerySearchBlob(enabled: false, onTap: () => taps++));
    final opacity = tester.widget<Opacity>(find.byType(Opacity));
    expect(opacity.opacity, closeTo(0.3, 0.001));
    await tester.tap(find.byType(GallerySearchBlob));
    expect(taps, 0);
  });

  testWidgets('semantics label resolves from nav.search_photos_hint', (tester) async {
    await tester.pumpConsumerWidget(GallerySearchBlob(enabled: true, onTap: () {}));
    final semantics = tester.getSemantics(find.byType(GallerySearchBlob));
    expect(semantics.label, 'nav_search_photos_hint'.tr());
  });

  testWidgets('tap target ≥ 44×44 pt', (tester) async {
    await tester.pumpConsumerWidget(GallerySearchBlob(enabled: true, onTap: () {}));
    expectTapTargetMin(tester, find.byType(GallerySearchBlob), min: 44);
  });

  testWidgets('pressed state: icon color swaps to primary', (tester) async {
    await tester.pumpConsumerWidget(GallerySearchBlob(enabled: true, onTap: () {}));
    final gesture = await tester.startGesture(tester.getCenter(find.byType(GallerySearchBlob)));
    await tester.pumpAndSettle();
    final icon = tester.widget<Icon>(find.byIcon(Icons.search));
    expect(icon.color, isNotNull);
    await gesture.up();
  });
}
