import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:immich_mobile/widgets/spaces/space_card.dart';
import 'package:openapi/api.dart';

import '../../widget_tester_extensions.dart';

/// Force a taller logical viewport so the square collage (rendered at the
/// widget's full available width, 800 in the default test surface) fits
/// without overflowing the default 800x600 test surface. Mirrors
/// `_setTallLogicalSize` in `test/presentation/pages/space_b6_mutations_test.dart`.
void _setTallLogicalSize(WidgetTester tester, {double dpr = 3.0}) {
  tester.view.devicePixelRatio = dpr;
  tester.view.physicalSize = Size(800 * dpr, 1200 * dpr);
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);
}

void main() {
  SharedSpaceResponseDto fullSpace() => SharedSpaceResponseDto(
    id: 's1',
    name: 'Family Photos',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    createdById: 'user-1',
    newAssetCount: const Optional.present(0),
    recentAssetIds: const Optional.present([]),
    recentAssetThumbhashes: const Optional.present([]),
    color: const Optional.present(UserAvatarColor.blue),
    members: const Optional.present([]),
    assetCount: const Optional.present(3),
    memberCount: const Optional.present(2),
  );

  testWidgets('a long-press fires onLongPress and does NOT also fire onTap', (tester) async {
    _setTallLogicalSize(tester);
    final events = <String>[];
    await tester.pumpConsumerWidget(
      SpaceCard(
        space: fullSpace(),
        onTap: () => events.add('tap'),
        onLongPress: () => events.add('longPress'),
      ),
    );

    await tester.longPress(find.byType(SpaceCard));
    await tester.pumpAndSettle();

    expect(events, ['longPress'], reason: 'a long-press must not navigate into the space behind the sheet');
  });

  testWidgets('a tap still fires onTap only', (tester) async {
    _setTallLogicalSize(tester);
    final events = <String>[];
    await tester.pumpConsumerWidget(
      SpaceCard(
        space: fullSpace(),
        onTap: () => events.add('tap'),
        onLongPress: () => events.add('longPress'),
      ),
    );

    await tester.tap(find.byType(SpaceCard));
    await tester.pumpAndSettle();

    expect(events, ['tap']);
  });

  testWidgets('omitting onLongPress leaves tap behaviour unchanged', (tester) async {
    _setTallLogicalSize(tester);
    final events = <String>[];
    await tester.pumpConsumerWidget(
      SpaceCard(space: fullSpace(), onTap: () => events.add('tap')),
    );

    await tester.longPress(find.byType(SpaceCard));
    await tester.pumpAndSettle();

    expect(events, isEmpty);
  });
}
