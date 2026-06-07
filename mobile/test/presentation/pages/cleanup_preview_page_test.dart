import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/domain/models/asset/base_asset.model.dart';
import 'package:immich_mobile/domain/models/config/app_config.dart';
import 'package:immich_mobile/domain/models/config/timeline_config.dart';
import 'package:immich_mobile/domain/models/timeline.model.dart';
import 'package:immich_mobile/domain/services/timeline.service.dart';
import 'package:immich_mobile/presentation/pages/cleanup_preview.page.dart';
import 'package:immich_mobile/presentation/widgets/timeline/timeline.widget.dart';
import 'package:immich_mobile/presentation/widgets/timeline/timeline_grouping_header_sliver.widget.dart';
import 'package:immich_mobile/providers/infrastructure/settings.provider.dart';
import 'package:immich_mobile/providers/infrastructure/timeline.provider.dart';
import 'package:mocktail/mocktail.dart';

class _MockLocalAsset extends Mock implements LocalAsset {}

class _MockTimelineFactory extends Mock implements TimelineFactory {}

class _MockTimelineService extends Mock implements TimelineService {}

void main() {
  testWidgets('cleanup preview stays day grouped read-only without grouping header', (tester) async {
    final factory = _MockTimelineFactory();
    final timelineService = _MockTimelineService();
    final asset = _MockLocalAsset();

    when(() => factory.fromAssetsWithBuckets([asset], TimelineOrigin.search)).thenReturn(timelineService);
    when(timelineService.dispose).thenAnswer((_) async {});

    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          appConfigProvider.overrideWithValue(const AppConfig(timeline: TimelineConfig(tilesPerRow: 3))),
          timelineFactoryProvider.overrideWithValue(factory),
        ],
        child: MaterialApp(home: CleanupPreviewPage(assets: [asset])),
      ),
    );

    final timeline = tester.widget<Timeline>(find.byType(Timeline));
    expect(timeline.groupBy, GroupAssetsBy.day);
    expect(timeline.readOnly, isTrue);
    expect(find.byType(TimelineGroupingHeaderSliver), findsNothing);
  });
}
