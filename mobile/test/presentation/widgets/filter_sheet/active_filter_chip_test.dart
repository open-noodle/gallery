import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/domain/models/person.model.dart';
import 'package:immich_mobile/presentation/widgets/filter_sheet/active_filter_chip.widget.dart';
import 'package:immich_mobile/providers/photos_filter/active_chips.dart';
import 'package:immich_mobile/providers/photos_filter/chip_id.dart';
import 'package:immich_mobile/providers/photos_filter/photos_filter.provider.dart';

import '../../../widget_tester_extensions.dart';

const _alice = PersonDto(id: 'a', name: 'Alice', isHidden: false, thumbnailPath: '');

void main() {
  group('ActiveFilterChip', () {
    testWidgets('renders label + close icon', (tester) async {
      const spec = ActiveChipSpec(
        id: LocationChipId(),
        label: 'Paris',
        visual: ChipVisual.location,
        icon: Icons.place_rounded,
      );

      await tester.pumpConsumerWidget(const ActiveFilterChip(spec: spec));
      await tester.pumpAndSettle();

      expect(find.text('Paris'), findsOneWidget);
      expect(find.byIcon(Icons.close_rounded), findsOneWidget);
    });

    testWidgets('tag spec renders leading dot with key', (tester) async {
      const spec = ActiveChipSpec(id: TagChipId('t1'), label: 'wedding', visual: ChipVisual.tag, tagDotSeed: 42);

      await tester.pumpConsumerWidget(const ActiveFilterChip(spec: spec));
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('tag-dot')), findsOneWidget);
    });

    testWidgets('location spec renders Icons.place_rounded leading', (tester) async {
      const spec = ActiveChipSpec(
        id: LocationChipId(),
        label: 'France',
        visual: ChipVisual.location,
        icon: Icons.place_rounded,
      );

      await tester.pumpConsumerWidget(const ActiveFilterChip(spec: spec));
      await tester.pumpAndSettle();
      expect(find.byIcon(Icons.place_rounded), findsOneWidget);
    });

    testWidgets('tap on close invokes removeChip with matching ChipId', (tester) async {
      const spec = ActiveChipSpec(id: TagChipId('t1'), label: 'wedding', visual: ChipVisual.tag);

      await tester.pumpConsumerWidget(const ActiveFilterChip(spec: spec));
      await tester.pumpAndSettle();

      final container = ProviderScope.containerOf(tester.element(find.byType(ActiveFilterChip)));
      container.read(photosFilterProvider.notifier).toggleTag('t1'); // seed state
      expect(container.read(photosFilterProvider).tagIds, ['t1']);

      await tester.tap(find.byIcon(Icons.close_rounded));
      await tester.pumpAndSettle();

      expect(container.read(photosFilterProvider).tagIds, anyOf(isNull, isEmpty));
    });

    testWidgets('close removes person with matching id (id-based equality)', (tester) async {
      const spec = ActiveChipSpec(id: PersonChipId('a'), label: 'Alice', visual: ChipVisual.person);

      await tester.pumpConsumerWidget(const ActiveFilterChip(spec: spec));
      await tester.pumpAndSettle();

      final container = ProviderScope.containerOf(tester.element(find.byType(ActiveFilterChip)));
      container.read(photosFilterProvider.notifier).togglePerson(_alice);

      await tester.tap(find.byIcon(Icons.close_rounded));
      await tester.pumpAndSettle();

      expect(container.read(photosFilterProvider).people, isEmpty);
    });
  });
}
