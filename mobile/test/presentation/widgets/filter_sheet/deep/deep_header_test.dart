import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/generated/translations.g.dart';
import 'package:immich_mobile/presentation/widgets/filter_sheet/deep/deep_header.widget.dart';
import 'package:immich_mobile/presentation/widgets/filter_sheet/filter_section_id.dart';
import 'package:immich_mobile/providers/photos_filter/filter_sheet.provider.dart';
import 'package:immich_mobile/providers/photos_filter/hidden_sections.provider.dart';
import 'package:immich_mobile/providers/photos_filter/photos_filter.provider.dart';

import '../../../../widget_tester_extensions.dart';

class _FakeVis implements FilterSectionVisibilityPrefs {
  Set<FilterSectionId> stored;
  _FakeVis(this.stored);
  @override
  Set<FilterSectionId> loadHidden() => stored;
  @override
  Future<void> saveHidden(Set<FilterSectionId> ids) async => stored = ids;
}

void main() {
  group('DeepHeader', () {
    testWidgets('renders Close icon, title, and Reset button when filter non-empty', (tester) async {
      await tester.pumpConsumerWidget(const Material(child: DeepHeader()));
      final container = ProviderScope.containerOf(tester.element(find.byType(DeepHeader)));
      container.read(photosFilterProvider.notifier).setText('paris');
      await tester.pumpAndSettle();

      expect(find.byKey(const Key('deep-header-close')), findsOneWidget);
      expect(find.text(StaticTranslations.instance.filter_sheet_title), findsOneWidget);
      expect(find.byKey(const Key('deep-header-reset')), findsOneWidget);
    });

    testWidgets('Reset button is hidden when filter is empty', (tester) async {
      await tester.pumpConsumerWidget(const Material(child: DeepHeader()));
      expect(find.byKey(const Key('deep-header-reset')), findsNothing);
    });

    testWidgets('Close button closes the sheet (hidden)', (tester) async {
      // The X is a "close" affordance (icon: close_rounded, tooltip: close) — it must
      // dismiss the sheet, consistent with Done / system-back / scrim-tap / drag-to-dismiss.
      // The sheet has no intermediate state, so every close affordance goes straight to hidden.
      await tester.pumpConsumerWidget(const Material(child: DeepHeader()));
      final container = ProviderScope.containerOf(tester.element(find.byType(DeepHeader)));
      container.read(photosFilterSheetProvider.notifier).state = FilterSheetVisibility.visible;
      await tester.pumpAndSettle();

      await tester.tap(find.byKey(const Key('deep-header-close')));
      await tester.pumpAndSettle();

      expect(container.read(photosFilterSheetProvider), FilterSheetVisibility.hidden);
    });

    testWidgets('Reset calls reset() on notifier and filter becomes empty', (tester) async {
      await tester.pumpConsumerWidget(const Material(child: DeepHeader()));
      final container = ProviderScope.containerOf(tester.element(find.byType(DeepHeader)));
      container.read(photosFilterProvider.notifier).setText('paris');
      container.read(photosFilterProvider.notifier).setRating(4);
      await tester.pumpAndSettle();

      await tester.tap(find.byKey(const Key('deep-header-reset')));
      await tester.pumpAndSettle();

      expect(container.read(photosFilterProvider).isEmpty, isTrue);
    });

    testWidgets('Reset does not dismiss the sheet', (tester) async {
      await tester.pumpConsumerWidget(const Material(child: DeepHeader()));
      final container = ProviderScope.containerOf(tester.element(find.byType(DeepHeader)));
      container.read(photosFilterSheetProvider.notifier).state = FilterSheetVisibility.visible;
      container.read(photosFilterProvider.notifier).setText('paris');
      await tester.pumpAndSettle();

      await tester.tap(find.byKey(const Key('deep-header-reset')));
      await tester.pumpAndSettle();

      expect(container.read(photosFilterSheetProvider), FilterSheetVisibility.visible);
    });

    testWidgets('close + reset buttons meet kMinInteractiveDimension tap targets (a11y)', (tester) async {
      await tester.pumpConsumerWidget(const Material(child: DeepHeader()));
      final container = ProviderScope.containerOf(tester.element(find.byType(DeepHeader)));
      container.read(photosFilterProvider.notifier).setText('paris');
      await tester.pumpAndSettle();
      expectTapTargetMin(tester, find.byKey(const Key('deep-header-close')));
      expectTapTargetMin(tester, find.byKey(const Key('deep-header-reset')));
    });

    testWidgets('renders correctly in dark theme', (tester) async {
      await tester.pumpConsumerWidgetDark(const Material(child: DeepHeader()));
      expect(find.byKey(const Key('deep-header-close')), findsOneWidget);
    });

    testWidgets('shows a manage-sections button that opens the sheet', (tester) async {
      await tester.pumpConsumerWidget(
        const Material(child: DeepHeader()),
        overrides: [filterSectionVisibilityPrefsProvider.overrideWithValue(_FakeVis({}))],
      );
      expect(find.byKey(const Key('deep-header-manage')), findsOneWidget);
      await tester.tap(find.byKey(const Key('deep-header-manage')));
      await tester.pumpAndSettle();
      // The manage sheet is now open — its section toggles are present.
      expect(find.byKey(const Key('manage-section-people')), findsOneWidget);
    });
  });
}
