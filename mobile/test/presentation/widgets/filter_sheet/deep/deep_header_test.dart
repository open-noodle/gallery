import 'package:easy_localization/easy_localization.dart';
import 'package:easy_localization/src/localization.dart';
import 'package:easy_localization/src/translations.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/generated/codegen_loader.g.dart';
import 'package:immich_mobile/presentation/widgets/filter_sheet/deep/deep_header.widget.dart';
import 'package:immich_mobile/providers/photos_filter/filter_sheet.provider.dart';
import 'package:immich_mobile/providers/photos_filter/photos_filter.provider.dart';

import '../../../../widget_tester_extensions.dart';

void main() {
  setUpAll(() async {
    TestWidgetsFlutterBinding.ensureInitialized();
    EasyLocalization.logger.enableBuildModes = [];
    const loader = CodegenLoader();
    final data = await loader.load('', const Locale('en'));
    Localization.load(const Locale('en'), translations: Translations(data));
  });

  group('DeepHeader', () {
    testWidgets('renders Close icon, title, and Reset button when filter non-empty', (tester) async {
      await tester.pumpConsumerWidget(const Material(child: DeepHeader()));
      final container = ProviderScope.containerOf(tester.element(find.byType(DeepHeader)));
      container.read(photosFilterProvider.notifier).setText('paris');
      await tester.pumpAndSettle();

      expect(find.byKey(const Key('deep-header-close')), findsOneWidget);
      expect(find.text('Filters'), findsOneWidget);
      expect(find.byKey(const Key('deep-header-reset')), findsOneWidget);
    });

    testWidgets('Reset button is hidden when filter is empty', (tester) async {
      await tester.pumpConsumerWidget(const Material(child: DeepHeader()));
      expect(find.byKey(const Key('deep-header-reset')), findsNothing);
    });

    testWidgets('Close button sets sheet snap to browse', (tester) async {
      await tester.pumpConsumerWidget(const Material(child: DeepHeader()));
      final container = ProviderScope.containerOf(tester.element(find.byType(DeepHeader)));
      container.read(photosFilterSheetProvider.notifier).state = FilterSheetSnap.deep;
      await tester.pumpAndSettle();

      await tester.tap(find.byKey(const Key('deep-header-close')));
      await tester.pumpAndSettle();

      expect(container.read(photosFilterSheetProvider), FilterSheetSnap.browse);
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
      container.read(photosFilterSheetProvider.notifier).state = FilterSheetSnap.deep;
      container.read(photosFilterProvider.notifier).setText('paris');
      await tester.pumpAndSettle();

      await tester.tap(find.byKey(const Key('deep-header-reset')));
      await tester.pumpAndSettle();

      expect(container.read(photosFilterSheetProvider), FilterSheetSnap.deep);
    });

    testWidgets('close + reset buttons have ≥44×44 pt tap targets (a11y)', (tester) async {
      await tester.pumpConsumerWidget(const Material(child: DeepHeader()));
      final container = ProviderScope.containerOf(tester.element(find.byType(DeepHeader)));
      container.read(photosFilterProvider.notifier).setText('paris');
      await tester.pumpAndSettle();
      for (final key in [const Key('deep-header-close'), const Key('deep-header-reset')]) {
        final size = tester.getSize(find.byKey(key));
        expect(size.width, greaterThanOrEqualTo(44), reason: '$key width');
        expect(size.height, greaterThanOrEqualTo(44), reason: '$key height');
      }
    });

    testWidgets('renders correctly in dark theme', (tester) async {
      await tester.pumpConsumerWidgetDark(const Material(child: DeepHeader()));
      expect(find.byKey(const Key('deep-header-close')), findsOneWidget);
    });
  });
}
