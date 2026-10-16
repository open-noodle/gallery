import 'dart:math' as math;

import 'package:auto_route/auto_route.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/domain/models/asset/base_asset.model.dart';
import 'package:immich_mobile/domain/models/config/app_config.dart';
import 'package:immich_mobile/domain/models/timeline.model.dart';
import 'package:immich_mobile/domain/models/timeline_grouping.model.dart';
import 'package:immich_mobile/domain/services/timeline.service.dart';
import 'package:immich_mobile/presentation/widgets/timeline/timeline.widget.dart';
import 'package:immich_mobile/providers/asset_viewer/scroll_to_asset_notifier.provider.dart';
import 'package:immich_mobile/providers/infrastructure/settings.provider.dart';
import 'package:immich_mobile/providers/infrastructure/timeline.provider.dart';
import 'package:immich_mobile/providers/timeline/highlighted_asset.provider.dart';
import 'package:immich_mobile/providers/timeline/timeline_grouping.provider.dart';

import '../../../fixtures/asset.stub.dart';

class _MonthsOverviewNotifier extends TimelineOverviewModeNotifier {
  @override
  TimelineOverviewMode build() => TimelineOverviewMode.months;
}

/// #1047: a Space timeline is pushed OVER the main one, which stays mounted and
/// listening on the same global latch. These pump a real [Timeline] to prove the scope
/// actually reaches the drain — the pure `decideScrollDrain` tests cannot see whether
/// `Timeline.spaceId` is wired through to it.
void main() {
  final assets = List<BaseAsset>.generate(
    200,
    (i) => LocalAssetStub.image1.copyWith(id: 'a$i', createdAt: DateTime(2025)),
  );
  final target = assets[120];

  setUp(() => scrollToAssetNotifierProvider.consume());
  tearDown(() => scrollToAssetNotifierProvider.consume());

  Future<ScrollPosition> pumpTimeline(WidgetTester tester, {String? spaceId, bool monthsOverview = false}) async {
    tester.view.devicePixelRatio = 3.0;
    tester.view.physicalSize = const Size(1206, 2622);
    addTearDown(tester.view.reset);

    final service = TimelineService((
      assetSource: (i, n) async => assets.sublist(i, math.min(i + n, assets.length)),
      bucketSource: () => Stream.value([TimeBucket(date: DateTime(2025), assetCount: assets.length)]),
      origin: spaceId == null ? TimelineOrigin.main : TimelineOrigin.remoteSpace,
    ));
    addTearDown(service.dispose);

    final router = RootStackRouter.build(
      routes: [
        AutoRoute(
          initial: true,
          page: PageInfo(
            'Timeline',
            builder: (_) => Timeline(
              withScrubber: false,
              readOnly: true,
              // A pinned groupBy forces the photo grid; the overview case needs it unset.
              groupBy: monthsOverview ? null : GroupAssetsBy.none,
              appBar: const SliverToBoxAdapter(child: SizedBox.shrink()),
              spaceId: spaceId,
            ),
          ),
        ),
      ],
    );

    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          timelineServiceProvider.overrideWithValue(service),
          appConfigProvider.overrideWithValue(const AppConfig()),
          if (monthsOverview) timelineOverviewModeProvider.overrideWith(_MonthsOverviewNotifier.new),
        ],
        child: MaterialApp.router(routerConfig: router.config()),
      ),
    );
    await tester.pump();
    await tester.pump();
    // Thumbnails will fail to load.
    tester.takeException();

    return tester
        .state<ScrollableState>(find.descendant(of: find.byType(Timeline), matching: find.byType(Scrollable)).first)
        .position;
  }

  testWidgets('the personal timeline leaves a Space-scoped request for the Space timeline', (tester) async {
    final position = await pumpTimeline(tester);

    scrollToAssetNotifierProvider.scrollToAsset(target, spaceId: 'space-1');
    await tester.pumpAndSettle();

    expect(position.pixels, 0, reason: 'the main timeline must not scroll to a photo it is not showing');
    expect(
      scrollToAssetNotifierProvider.value?.spaceId,
      'space-1',
      reason: 'the request must survive for the Space timeline being pushed over this one',
    );
  });

  testWidgets('the Space timeline drains the request addressed to it', (tester) async {
    final position = await pumpTimeline(tester, spaceId: 'space-1');

    scrollToAssetNotifierProvider.scrollToAsset(target, spaceId: 'space-1');
    await tester.pumpAndSettle();

    expect(position.pixels, greaterThan(0));
    expect(scrollToAssetNotifierProvider.value, isNull, reason: 'the request is consumed once honoured');
  });

  testWidgets('a Space timeline leaves a personal-timeline request alone', (tester) async {
    final position = await pumpTimeline(tester, spaceId: 'space-1');

    scrollToAssetNotifierProvider.scrollToAsset(target);
    await tester.pumpAndSettle();

    expect(position.pixels, 0);
    expect(scrollToAssetNotifierProvider.value, isNotNull);
  });

  testWidgets('the personal timeline still drains its own request', (tester) async {
    // The guard must not have turned the ordinary jump off.
    final position = await pumpTimeline(tester);

    scrollToAssetNotifierProvider.scrollToAsset(target);
    await tester.pumpAndSettle();

    expect(position.pixels, greaterThan(0));
    expect(scrollToAssetNotifierProvider.value, isNull);
  });

  testWidgets('a request latched before mount on a Months overview drills into the grid and lands on the photo', (
    tester,
  ) async {
    // The request survives the timeline mounting fresh; the overview cards have no tiles,
    // so the drain switches to the photo grid, waits out the segment reload, then scrolls.
    scrollToAssetNotifierProvider.scrollToAsset(target);
    await pumpTimeline(tester, monthsOverview: true);
    await tester.pumpAndSettle();
    tester.takeException();

    final container = ProviderScope.containerOf(tester.element(find.byType(Scrollable).first));
    expect(container.read(timelineOverviewModeProvider), TimelineOverviewMode.all);
    expect(scrollToAssetNotifierProvider.value, isNull, reason: 'the request is consumed once honoured');
    final position = tester.state<ScrollableState>(find.byType(Scrollable).first).position;
    expect(position.pixels, greaterThan(0));
    expect(container.read(timelineHighlightedAssetProvider)?.id, target.id);
  });
}
