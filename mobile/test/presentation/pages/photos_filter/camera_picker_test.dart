import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/generated/translations.g.dart';
import 'package:immich_mobile/presentation/pages/photos_filter/camera_picker.page.dart';
import 'package:immich_mobile/providers/photos_filter/camera_model_suggestions.provider.dart';
import 'package:immich_mobile/providers/photos_filter/camera_picker.provider.dart';
import 'package:immich_mobile/providers/photos_filter/filter_suggestions.provider.dart';
import 'package:openapi/api.dart';

import '../../../widget_tester_extensions.dart';

FilterSuggestionsResponseDto _sugg(List<String> cameraMakes) => FilterSuggestionsResponseDto(
  hasUnnamedPeople: false,
  hasFavorites: true,
  hasAssetsInAlbum: true,
  hasAssetsNotInAlbum: true,
  cameraMakes: cameraMakes,
);

List<Override> _overrideMakes(List<String> cameraMakes) => [
  photosFilterSuggestionsProvider.overrideWith((ref, filter) async => _sugg(cameraMakes)),
];

void main() {
  group('CameraPickerPage', () {
    testWidgets('renders AppBar with back icon, title key, and Done button', (tester) async {
      await tester.pumpConsumerWidget(const CameraPickerPage(), overrides: _overrideMakes([]));
      await tester.pumpAndSettle();
      expect(find.byIcon(Icons.arrow_back_rounded), findsOneWidget);
      expect(find.text(StaticTranslations.instance.filter_sheet_picker_camera_title), findsOneWidget);
      expect(find.byKey(const Key('camera-picker-done')), findsOneWidget);
    });

    testWidgets('Done button meets 48pt tap target', (tester) async {
      await tester.pumpConsumerWidget(const CameraPickerPage(), overrides: _overrideMakes([]));
      await tester.pumpAndSettle();
      expectTapTargetMin(tester, find.byKey(const Key('camera-picker-done')));
    });

    testWidgets('Done button pops the navigator stack', (tester) async {
      await tester.pumpConsumerWidget(
        Builder(
          builder: (context) => Scaffold(
            body: Center(
              child: TextButton(
                key: const Key('open-camera-picker'),
                onPressed: () =>
                    Navigator.of(context).push(MaterialPageRoute(builder: (_) => const CameraPickerPage())),
                child: const Text('open'),
              ),
            ),
          ),
        ),
        overrides: _overrideMakes([]),
      );
      await tester.tap(find.byKey(const Key('open-camera-picker')));
      await tester.pumpAndSettle();
      expect(find.byType(CameraPickerPage), findsOneWidget);

      await tester.tap(find.byKey(const Key('camera-picker-done')));
      await tester.pumpAndSettle();
      expect(find.byType(CameraPickerPage), findsNothing);
    });

    testWidgets('renders correctly in dark theme', (tester) async {
      await tester.pumpConsumerWidgetDark(const CameraPickerPage(), overrides: _overrideMakes([]));
      await tester.pumpAndSettle();
      expect(find.byType(CameraPickerPage), findsOneWidget);
    });
  });

  group('CameraPickerPage search', () {
    testWidgets('typing updates cameraPickerQueryProvider', (tester) async {
      await tester.pumpConsumerWidget(const CameraPickerPage(), overrides: _overrideMakes(['Canon', 'Sony']));
      await tester.pumpAndSettle();

      final container = ProviderScope.containerOf(tester.element(find.byType(CameraPickerPage)));
      await tester.enterText(find.byKey(const Key('camera-picker-search-field')), 'can');
      await tester.pump();

      expect(container.read(cameraPickerQueryProvider), 'can');
    });

    testWidgets('non-matching query renders No results panel + Clear search, tapping clears', (tester) async {
      await tester.pumpConsumerWidget(const CameraPickerPage(), overrides: _overrideMakes(['Canon']));
      await tester.pumpAndSettle();

      await tester.enterText(find.byKey(const Key('camera-picker-search-field')), 'zzzzz');
      await tester.pumpAndSettle();

      expect(find.byKey(const Key('camera-picker-clear-search')), findsOneWidget);

      final container = ProviderScope.containerOf(tester.element(find.byType(CameraPickerPage)));
      await tester.tap(find.byKey(const Key('camera-picker-clear-search')));
      await tester.pumpAndSettle();

      expect(container.read(cameraPickerQueryProvider), '');
      expect(find.byKey(const Key('camera-picker-clear-search')), findsNothing);
    });
  });

  group('CameraPickerPage integration', () {
    testWidgets('renders a row per make from suggestions (no proactive model fetch)', (tester) async {
      await tester.pumpConsumerWidget(const CameraPickerPage(), overrides: _overrideMakes(['Canon', 'Sony', 'Nikon']));
      await tester.pumpAndSettle();

      expect(find.byKey(const Key('camera-picker-make-Canon')), findsOneWidget);
      expect(find.byKey(const Key('camera-picker-make-Sony')), findsOneWidget);
      expect(find.byKey(const Key('camera-picker-make-Nikon')), findsOneWidget);
    });

    testWidgets('typing "can" filters the make list to Canon only', (tester) async {
      await tester.pumpConsumerWidget(const CameraPickerPage(), overrides: _overrideMakes(['Canon', 'Sony', 'Nikon']));
      await tester.pumpAndSettle();

      await tester.enterText(find.byKey(const Key('camera-picker-search-field')), 'can');
      await tester.pumpAndSettle();

      expect(find.byKey(const Key('camera-picker-make-Canon')), findsOneWidget);
      expect(find.byKey(const Key('camera-picker-make-Sony')), findsNothing);
      expect(find.byKey(const Key('camera-picker-make-Nikon')), findsNothing);
    });

    testWidgets('query matching only an already-loaded model of the expanded make keeps the accordion visible', (
      tester,
    ) async {
      await tester.pumpConsumerWidget(
        const CameraPickerPage(),
        overrides: [
          ..._overrideMakes(['Canon']),
          cameraModelSuggestionsProvider.overrideWith((ref, make) async => make == 'Canon' ? ['EOS R5', 'EOS R6'] : []),
        ],
      );
      await tester.pumpAndSettle();

      // Expand Canon so its models load and get cached.
      await tester.tap(find.byKey(const Key('camera-picker-make-Canon')));
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('camera-picker-model-EOS R5')), findsOneWidget);
      expect(find.byKey(const Key('camera-picker-model-EOS R6')), findsOneWidget);

      // "r5" matches no make name, but matches the already-loaded model
      // EOS R5 under the still-expanded Canon — the page must keep showing
      // the accordion (Canon + EOS R5), not fall back to No results.
      await tester.enterText(find.byKey(const Key('camera-picker-search-field')), 'r5');
      await tester.pumpAndSettle();

      expect(find.byKey(const Key('camera-picker-make-Canon')), findsOneWidget);
      expect(find.byKey(const Key('camera-picker-model-EOS R5')), findsOneWidget);
      expect(find.byKey(const Key('camera-picker-model-EOS R6')), findsNothing);
      expect(find.byKey(const Key('camera-picker-clear-search')), findsNothing);
    });
  });

  group('CameraPickerPage error state', () {
    testWidgets('renders a tappable retry; tapping invalidates the suggestions provider and refetches', (tester) async {
      var calls = 0;
      await tester.pumpConsumerWidget(
        const CameraPickerPage(),
        overrides: [
          photosFilterSuggestionsProvider.overrideWith((ref, filter) async {
            calls++;
            if (calls == 1) {
              throw Exception('network down');
            }
            return _sugg(['Canon']);
          }),
        ],
      );
      await tester.pumpAndSettle();

      expect(find.byKey(const Key('camera-picker-retry')), findsOneWidget);

      await tester.tap(find.byKey(const Key('camera-picker-retry')));
      await tester.pumpAndSettle();

      expect(find.byKey(const Key('camera-picker-retry')), findsNothing);
      expect(find.byKey(const Key('camera-picker-make-Canon')), findsOneWidget);
    });
  });
}
