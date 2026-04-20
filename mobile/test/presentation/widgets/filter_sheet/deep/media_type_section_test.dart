import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/domain/models/asset/base_asset.model.dart';
import 'package:immich_mobile/presentation/widgets/filter_sheet/deep/media_type_section.widget.dart';
import 'package:immich_mobile/providers/photos_filter/photos_filter.provider.dart';

import '../../../../widget_tester_extensions.dart';

void main() {
  group('MediaTypeSection', () {
    testWidgets('renders 4 segments with i18n-key fallback labels', (tester) async {
      await tester.pumpConsumerWidget(const Material(child: MediaTypeSection()));
      await tester.pumpAndSettle();

      expect(find.byKey(const Key('media-segment-all')), findsOneWidget);
      expect(find.byKey(const Key('media-segment-image')), findsOneWidget);
      expect(find.byKey(const Key('media-segment-video')), findsOneWidget);
      expect(find.byKey(const Key('media-segment-audio')), findsOneWidget);
    });

    testWidgets('tapping Photos calls setMediaType(AssetType.image)', (tester) async {
      await tester.pumpConsumerWidget(const Material(child: MediaTypeSection()));
      final container = ProviderScope.containerOf(tester.element(find.byType(MediaTypeSection)));

      await tester.tap(find.byKey(const Key('media-segment-image')));
      await tester.pumpAndSettle();

      expect(container.read(photosFilterProvider).mediaType, AssetType.image);
    });

    testWidgets('tapping All clears to AssetType.other (the "no constraint" sentinel)', (tester) async {
      await tester.pumpConsumerWidget(const Material(child: MediaTypeSection()));
      final container = ProviderScope.containerOf(tester.element(find.byType(MediaTypeSection)));
      container.read(photosFilterProvider.notifier).setMediaType(AssetType.image);
      await tester.pumpAndSettle();

      await tester.tap(find.byKey(const Key('media-segment-all')));
      await tester.pumpAndSettle();

      expect(container.read(photosFilterProvider).mediaType, AssetType.other);
    });

    testWidgets('selected segment reflects current mediaType', (tester) async {
      await tester.pumpConsumerWidget(const Material(child: MediaTypeSection()));
      final container = ProviderScope.containerOf(tester.element(find.byType(MediaTypeSection)));
      container.read(photosFilterProvider.notifier).setMediaType(AssetType.video);
      await tester.pumpAndSettle();

      final segmented = tester.widget<SegmentedButton<AssetType>>(find.byType(SegmentedButton<AssetType>));
      expect(segmented.selected, {AssetType.video});
    });

    testWidgets('segmented button meets kMinInteractiveDimension (48pt)', (tester) async {
      await tester.pumpConsumerWidget(const SizedBox(width: 400, child: Material(child: MediaTypeSection())));
      await tester.pumpAndSettle();
      expectTapTargetMin(tester, find.byType(SegmentedButton<AssetType>));
    });

    testWidgets('renders correctly in dark theme', (tester) async {
      await tester.pumpConsumerWidgetDark(const Material(child: MediaTypeSection()));
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('media-segment-all')), findsOneWidget);
      expect(find.byKey(const Key('media-segment-image')), findsOneWidget);
      expect(find.byKey(const Key('media-segment-video')), findsOneWidget);
      expect(find.byKey(const Key('media-segment-audio')), findsOneWidget);
    });
  });
}
