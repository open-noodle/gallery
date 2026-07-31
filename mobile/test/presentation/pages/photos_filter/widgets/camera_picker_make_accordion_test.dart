import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/models/search/search_filter.model.dart';
import 'package:immich_mobile/presentation/pages/photos_filter/widgets/camera_picker_make_accordion.widget.dart';
import 'package:immich_mobile/providers/photos_filter/camera_model_suggestions.provider.dart';
import 'package:immich_mobile/providers/photos_filter/camera_picker.provider.dart';
import 'package:immich_mobile/providers/photos_filter/filter_suggestions.provider.dart';
import 'package:immich_mobile/providers/photos_filter/photos_filter.provider.dart';
import 'package:openapi/api.dart';

import '../../../../widget_tester_extensions.dart';

FilterSuggestionsResponseDto _sugg(List<String> cameraMakes) =>
    FilterSuggestionsResponseDto(hasUnnamedPeople: false, cameraMakes: cameraMakes);

List<Override> _overrideMakes(List<String> cameraMakes) => [
  photosFilterSuggestionsProvider.overrideWith((ref, filter) async => _sugg(cameraMakes)),
];

Widget _harness({required String? expandedMake, required ValueChanged<String?> onExpand}) {
  return CameraPickerMakeAccordion(expandedMake: expandedMake, onExpandMake: onExpand);
}

void main() {
  group('CameraPickerMakeAccordion', () {
    testWidgets('renders make rows from cameraPickerMakesProvider', (tester) async {
      await tester.pumpConsumerWidget(
        SingleChildScrollView(child: _harness(expandedMake: null, onExpand: (_) {})),
        overrides: _overrideMakes(['Canon', 'Sony']),
      );
      await tester.pumpAndSettle();

      expect(find.byKey(const Key('camera-picker-make-Canon')), findsOneWidget);
      expect(find.byKey(const Key('camera-picker-make-Sony')), findsOneWidget);
    });

    testWidgets('empty makes -> hidden (SizedBox.shrink)', (tester) async {
      await tester.pumpConsumerWidget(_harness(expandedMake: null, onExpand: (_) {}), overrides: _overrideMakes([]));
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('camera-picker-make-Canon')), findsNothing);
    });

    testWidgets('tapping a make row selects it and calls onExpandMake with that make', (tester) async {
      String? expanded;
      await tester.pumpConsumerWidget(
        SingleChildScrollView(child: _harness(expandedMake: null, onExpand: (m) => expanded = m)),
        overrides: _overrideMakes(['Canon', 'Sony']),
      );
      await tester.pumpAndSettle();

      final container = ProviderScope.containerOf(tester.element(find.byType(CameraPickerMakeAccordion)));
      await tester.tap(find.byKey(const Key('camera-picker-make-Canon')));
      await tester.pumpAndSettle();

      expect(expanded, 'Canon');
      expect(container.read(photosFilterProvider).camera.make, 'Canon');
      expect(container.read(photosFilterProvider).camera.model, isNull);
    });

    testWidgets('tapping an already-expanded make calls onExpandMake(null)', (tester) async {
      String? expanded = 'Canon';
      await tester.pumpConsumerWidget(
        SingleChildScrollView(
          child: _harness(expandedMake: 'Canon', onExpand: (m) => expanded = m),
        ),
        overrides: [
          ..._overrideMakes(['Canon']),
          cameraModelSuggestionsProvider.overrideWith((ref, m) async => []),
        ],
      );
      await tester.pumpAndSettle();

      await tester.tap(find.byKey(const Key('camera-picker-make-Canon')));
      await tester.pumpAndSettle();
      expect(expanded, isNull);
    });

    testWidgets('expanding a make fetches its models only — other makes are not fetched', (tester) async {
      final fetchedFor = <String?>[];
      await tester.pumpConsumerWidget(
        SingleChildScrollView(
          child: _harness(expandedMake: 'Canon', onExpand: (_) {}),
        ),
        overrides: [
          ..._overrideMakes(['Canon', 'Sony']),
          cameraModelSuggestionsProvider.overrideWith((ref, make) async {
            fetchedFor.add(make);
            return make == 'Canon' ? ['EOS R5', 'EOS R6'] : ['should-not-appear'];
          }),
        ],
      );
      await tester.pumpAndSettle();

      expect(find.byKey(const Key('camera-picker-model-EOS R5')), findsOneWidget);
      expect(find.byKey(const Key('camera-picker-model-EOS R6')), findsOneWidget);
      expect(fetchedFor, ['Canon']);
      expect(find.text('should-not-appear'), findsNothing);
    });

    testWidgets('tapping a model selects make + model via setCamera', (tester) async {
      await tester.pumpConsumerWidget(
        SingleChildScrollView(
          child: _harness(expandedMake: 'Canon', onExpand: (_) {}),
        ),
        overrides: [
          ..._overrideMakes(['Canon']),
          cameraModelSuggestionsProvider.overrideWith((ref, make) async => ['EOS R5', 'EOS R6']),
        ],
      );
      await tester.pumpAndSettle();

      final container = ProviderScope.containerOf(tester.element(find.byType(CameraPickerMakeAccordion)));
      await tester.tap(find.byKey(const Key('camera-picker-model-EOS R5')));
      await tester.pumpAndSettle();

      final camera = container.read(photosFilterProvider).camera;
      expect(camera.make, 'Canon');
      expect(camera.model, 'EOS R5');
    });

    testWidgets('selecting a different make replaces the prior make/model selection', (tester) async {
      String? expanded = 'Canon';
      await tester.pumpConsumerWidget(
        SingleChildScrollView(
          child: _harness(expandedMake: expanded, onExpand: (m) => expanded = m),
        ),
        overrides: [
          ..._overrideMakes(['Canon', 'Sony']),
          cameraModelSuggestionsProvider.overrideWith((ref, make) async => make == 'Canon' ? ['EOS R5'] : []),
        ],
      );
      await tester.pumpAndSettle();

      final container = ProviderScope.containerOf(tester.element(find.byType(CameraPickerMakeAccordion)));
      container.read(photosFilterProvider.notifier).setCamera(SearchCameraFilter(make: 'Canon', model: 'EOS R5'));
      await tester.pumpAndSettle();

      await tester.tap(find.byKey(const Key('camera-picker-make-Sony')));
      await tester.pumpAndSettle();

      final camera = container.read(photosFilterProvider).camera;
      expect(camera.make, 'Sony');
      expect(camera.model, isNull);
    });

    testWidgets('search query filters the already-loaded model list for the expanded make', (tester) async {
      await tester.pumpConsumerWidget(
        SingleChildScrollView(
          child: _harness(expandedMake: 'Canon', onExpand: (_) {}),
        ),
        overrides: [
          ..._overrideMakes(['Canon']),
          cameraModelSuggestionsProvider.overrideWith((ref, make) async => ['EOS R5', 'EOS R6']),
        ],
      );
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('camera-picker-model-EOS R5')), findsOneWidget);
      expect(find.byKey(const Key('camera-picker-model-EOS R6')), findsOneWidget);

      final container = ProviderScope.containerOf(tester.element(find.byType(CameraPickerMakeAccordion)));
      container.read(cameraPickerQueryProvider.notifier).state = 'r5';
      await tester.pumpAndSettle();

      expect(find.byKey(const Key('camera-picker-model-EOS R5')), findsOneWidget);
      expect(find.byKey(const Key('camera-picker-model-EOS R6')), findsNothing);
    });

    testWidgets('per-make fetch error shows an inline retry for that make only', (tester) async {
      await tester.pumpConsumerWidget(
        SingleChildScrollView(
          child: _harness(expandedMake: 'Leica', onExpand: (_) {}),
        ),
        overrides: [
          ..._overrideMakes(['Leica']),
          cameraModelSuggestionsProvider.overrideWith((ref, make) async => throw Exception('boom')),
        ],
      );
      await tester.pumpAndSettle();

      expect(find.byKey(const Key('deep-section-retry')), findsNothing);
      expect(find.byIcon(Icons.refresh_rounded), findsOneWidget);
    });

    testWidgets('renders correctly in dark theme', (tester) async {
      await tester.pumpConsumerWidgetDark(
        SingleChildScrollView(child: _harness(expandedMake: null, onExpand: (_) {})),
        overrides: _overrideMakes(['Canon']),
      );
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('camera-picker-make-Canon')), findsOneWidget);
    });
  });
}
