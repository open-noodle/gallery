import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/models/search/search_filter.model.dart';
import 'package:immich_mobile/presentation/widgets/filter_sheet/deep/camera_cascade_section.widget.dart';
import 'package:immich_mobile/presentation/widgets/filter_sheet/filter_section_id.dart';
import 'package:immich_mobile/providers/photos_filter/camera_model_suggestions.provider.dart';
import 'package:immich_mobile/providers/photos_filter/collapsed_sections.provider.dart';
import 'package:immich_mobile/providers/photos_filter/filter_suggestions.provider.dart';
import 'package:immich_mobile/providers/photos_filter/photos_filter.provider.dart';
import 'package:openapi/api.dart';

import '../../../../widget_tester_extensions.dart';

class _FakePrefs implements FilterSectionPrefs {
  final Set<FilterSectionId> collapsed;
  _FakePrefs(this.collapsed);
  @override
  Set<FilterSectionId> loadCollapsed() => collapsed;
  @override
  Future<void> saveCollapsed(Set<FilterSectionId> ids) async {}
}

Override _noCollapsed() => filterSectionPrefsProvider.overrideWithValue(_FakePrefs({}));

FilterSuggestionsResponseDto _sugg({List<String>? cameraMakes}) =>
    FilterSuggestionsResponseDto(hasUnnamedPeople: false, cameraMakes: cameraMakes ?? const []);

void main() {
  group('CameraCascadeSection', () {
    testWidgets('renders make chips when no make selected', (tester) async {
      await tester.pumpConsumerWidget(
        const Material(child: CameraCascadeSection()),
        overrides: [
          _noCollapsed(),
          photosFilterSuggestionsProvider.overrideWith(
            (ref, filter) => Future.value(_sugg(cameraMakes: ['Canon', 'Sony'])),
          ),
        ],
      );
      await tester.pumpAndSettle();

      expect(find.byKey(const Key('camera-make-Canon')), findsOneWidget);
      expect(find.byKey(const Key('camera-make-Sony')), findsOneWidget);
    });

    testWidgets('tapping a make sets filter.camera.make and reveals model wrap', (tester) async {
      await tester.pumpConsumerWidget(
        const Material(child: CameraCascadeSection()),
        overrides: [
          _noCollapsed(),
          photosFilterSuggestionsProvider.overrideWith(
            (ref, filter) => Future.value(_sugg(cameraMakes: ['Canon', 'Sony'])),
          ),
          cameraModelSuggestionsProvider.overrideWith(
            (ref, make) => Future.value(make == 'Canon' ? ['EOS R5', 'EOS R6'] : const <String>[]),
          ),
        ],
      );
      await tester.pumpAndSettle();

      final container = ProviderScope.containerOf(tester.element(find.byType(CameraCascadeSection)));
      await tester.tap(find.byKey(const Key('camera-make-Canon')));
      await tester.pumpAndSettle();

      expect(container.read(photosFilterProvider).camera.make, 'Canon');
      expect(find.byKey(const Key('camera-make-selected')), findsOneWidget);
      expect(find.byKey(const Key('camera-model-EOS R5')), findsOneWidget);
      expect(find.byKey(const Key('camera-model-EOS R6')), findsOneWidget);
    });

    testWidgets('tapping a model sets filter.camera.model', (tester) async {
      await tester.pumpConsumerWidget(
        const Material(child: CameraCascadeSection()),
        overrides: [
          _noCollapsed(),
          photosFilterSuggestionsProvider.overrideWith((ref, filter) => Future.value(_sugg(cameraMakes: ['Canon']))),
          cameraModelSuggestionsProvider.overrideWith((ref, make) => Future.value(['EOS R5'])),
        ],
      );
      await tester.pumpAndSettle();

      final container = ProviderScope.containerOf(tester.element(find.byType(CameraCascadeSection)));
      container.read(photosFilterProvider.notifier).setCamera(const SearchCameraFilter(make: 'Canon'));
      await tester.pumpAndSettle();

      await tester.tap(find.byKey(const Key('camera-model-EOS R5')));
      await tester.pumpAndSettle();

      final camera = container.read(photosFilterProvider).camera;
      expect(camera.make, 'Canon');
      expect(camera.model, 'EOS R5');
    });

    testWidgets('clearing the selected make resets models and restores make wrap', (tester) async {
      await tester.pumpConsumerWidget(
        const Material(child: CameraCascadeSection()),
        overrides: [
          _noCollapsed(),
          photosFilterSuggestionsProvider.overrideWith(
            (ref, filter) => Future.value(_sugg(cameraMakes: ['Canon', 'Sony'])),
          ),
          cameraModelSuggestionsProvider.overrideWith((ref, make) => Future.value(['EOS R5'])),
        ],
      );
      await tester.pumpAndSettle();

      final container = ProviderScope.containerOf(tester.element(find.byType(CameraCascadeSection)));
      container.read(photosFilterProvider.notifier).setCamera(const SearchCameraFilter(make: 'Canon'));
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('camera-make-selected')), findsOneWidget);

      // Tap the × affordance on the selected-make chip.
      await tester.tap(find.byKey(const Key('camera-make-selected-clear')));
      await tester.pumpAndSettle();

      expect(container.read(photosFilterProvider).camera.make, isNull);
      expect(find.byKey(const Key('camera-make-Canon')), findsOneWidget);
      expect(find.byKey(const Key('camera-make-Sony')), findsOneWidget);
    });

    testWidgets('empty makes → section auto-collapses, "(0)" shown, empty caption hidden', (tester) async {
      await tester.pumpConsumerWidget(
        const Material(child: CameraCascadeSection()),
        overrides: [
          _noCollapsed(),
          photosFilterSuggestionsProvider.overrideWith((ref, filter) => Future.value(_sugg(cameraMakes: []))),
        ],
      );
      await tester.pumpAndSettle();

      expect(find.textContaining('(0)'), findsOneWidget);
      expect(find.byKey(const Key('deep-section-empty')), findsNothing);
    });

    testWidgets('caps make wrap to 10 + renders "Search N cameras →" in the body (not the header)', (tester) async {
      final makes = [for (var i = 0; i < 15; i++) 'M$i'];
      await tester.pumpConsumerWidget(
        const Material(child: CameraCascadeSection(onOpenPicker: null)),
        overrides: [
          _noCollapsed(),
          photosFilterSuggestionsProvider.overrideWith((ref, filter) => Future.value(_sugg(cameraMakes: makes))),
        ],
      );
      await tester.pumpAndSettle();

      for (var i = 0; i < 10; i++) {
        expect(find.byKey(Key('camera-make-M$i')), findsOneWidget);
      }
      for (var i = 10; i < 15; i++) {
        expect(find.byKey(Key('camera-make-M$i')), findsNothing);
      }

      expect(
        find.descendant(
          of: find.byKey(const Key('collapsible-body-camera')),
          matching: find.byKey(const Key('camera-section-search-more')),
        ),
        findsOneWidget,
      );
      expect(
        find.descendant(
          of: find.byKey(const Key('collapsible-header-camera')),
          matching: find.byKey(const Key('camera-section-search-more')),
        ),
        findsNothing,
      );
    });

    testWidgets('onOpenPicker callback fires when "Search N cameras →" tapped', (tester) async {
      var opened = false;
      final makes = [for (var i = 0; i < 15; i++) 'M$i'];
      await tester.pumpConsumerWidget(
        Material(child: CameraCascadeSection(onOpenPicker: () => opened = true)),
        overrides: [
          _noCollapsed(),
          photosFilterSuggestionsProvider.overrideWith((ref, filter) => Future.value(_sugg(cameraMakes: makes))),
        ],
      );
      await tester.pumpAndSettle();

      await tester.tap(find.byKey(const Key('camera-section-search-more')));
      expect(opened, isTrue);
    });

    testWidgets('≤10 makes renders all, no over-cap', (tester) async {
      final makes = [for (var i = 0; i < 6; i++) 'M$i'];
      await tester.pumpConsumerWidget(
        const Material(child: CameraCascadeSection(onOpenPicker: null)),
        overrides: [
          _noCollapsed(),
          photosFilterSuggestionsProvider.overrideWith((ref, filter) => Future.value(_sugg(cameraMakes: makes))),
        ],
      );
      await tester.pumpAndSettle();

      for (var i = 0; i < 6; i++) {
        expect(find.byKey(Key('camera-make-M$i')), findsOneWidget);
      }
    });

    testWidgets('empty makes → no "Search N cameras →" affordance', (tester) async {
      await tester.pumpConsumerWidget(
        const Material(child: CameraCascadeSection(onOpenPicker: null)),
        overrides: [
          _noCollapsed(),
          photosFilterSuggestionsProvider.overrideWith((ref, filter) => Future.value(_sugg(cameraMakes: []))),
        ],
      );
      await tester.pumpAndSettle();

      expect(find.byKey(const Key('camera-section-search-more')), findsNothing);
    });
  });
}
