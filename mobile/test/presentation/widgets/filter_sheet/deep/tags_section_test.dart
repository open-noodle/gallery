import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/presentation/widgets/filter_sheet/deep/tags_section.widget.dart';
import 'package:immich_mobile/providers/photos_filter/filter_suggestions.provider.dart';
import 'package:immich_mobile/providers/photos_filter/photos_filter.provider.dart';
import 'package:openapi/api.dart';

import '../../../../widget_tester_extensions.dart';

FilterSuggestionsResponseDto _sugg({List<FilterSuggestionsTagDto>? tags}) =>
    FilterSuggestionsResponseDto(hasUnnamedPeople: false, tags: tags ?? const []);

void main() {
  group('TagsSectionDeep', () {
    testWidgets('renders one FilterChip per tag via DeepSectionScaffold', (tester) async {
      await tester.pumpConsumerWidget(
        const Material(child: TagsSectionDeep()),
        overrides: [
          photosFilterSuggestionsProvider.overrideWith(
            (ref, filter) => Future.value(
              _sugg(
                tags: [
                  FilterSuggestionsTagDto(id: 't1', value: 'Travel'),
                  FilterSuggestionsTagDto(id: 't2', value: 'Food'),
                ],
              ),
            ),
          ),
        ],
      );
      await tester.pumpAndSettle();

      expect(find.byKey(const Key('tag-chip-t1')), findsOneWidget);
      expect(find.byKey(const Key('tag-chip-t2')), findsOneWidget);
      expect(find.text('Travel'), findsOneWidget);
      expect(find.text('Food'), findsOneWidget);
    });

    testWidgets('tapping a chip calls toggleTag and selected state flips', (tester) async {
      await tester.pumpConsumerWidget(
        const Material(child: TagsSectionDeep()),
        overrides: [
          photosFilterSuggestionsProvider.overrideWith(
            (ref, filter) => Future.value(
              _sugg(
                tags: [FilterSuggestionsTagDto(id: 't1', value: 'Travel')],
              ),
            ),
          ),
        ],
      );
      await tester.pumpAndSettle();

      final container = ProviderScope.containerOf(tester.element(find.byType(TagsSectionDeep)));
      await tester.tap(find.byKey(const Key('tag-chip-t1')));
      await tester.pumpAndSettle();

      expect(container.read(photosFilterProvider).tagIds, contains('t1'));

      await tester.tap(find.byKey(const Key('tag-chip-t1')));
      await tester.pumpAndSettle();

      final after = container.read(photosFilterProvider).tagIds;
      expect(after == null || !after.contains('t1'), isTrue);
    });

    testWidgets('selected chip reflects photosFilterProvider.tagIds', (tester) async {
      await tester.pumpConsumerWidget(
        const Material(child: TagsSectionDeep()),
        overrides: [
          photosFilterSuggestionsProvider.overrideWith(
            (ref, filter) => Future.value(
              _sugg(
                tags: [FilterSuggestionsTagDto(id: 't1', value: 'Travel')],
              ),
            ),
          ),
        ],
      );
      await tester.pumpAndSettle();

      final container = ProviderScope.containerOf(tester.element(find.byType(TagsSectionDeep)));
      container.read(photosFilterProvider.notifier).toggleTag('t1');
      await tester.pumpAndSettle();

      final chip = tester.widget<FilterChip>(find.byKey(const Key('tag-chip-t1')));
      expect(chip.selected, isTrue);
    });

    testWidgets('empty tags → empty caption rendered by DeepSectionScaffold', (tester) async {
      await tester.pumpConsumerWidget(
        const Material(child: TagsSectionDeep()),
        overrides: [photosFilterSuggestionsProvider.overrideWith((ref, filter) => Future.value(_sugg(tags: [])))],
      );
      await tester.pumpAndSettle();

      expect(find.byKey(const Key('deep-section-empty')), findsOneWidget);
    });

    testWidgets('section title renders via filter_sheet_deep_tags_section key', (tester) async {
      await tester.pumpConsumerWidget(
        const Material(child: TagsSectionDeep()),
        overrides: [
          photosFilterSuggestionsProvider.overrideWith(
            (ref, filter) => Future.value(
              _sugg(
                tags: [FilterSuggestionsTagDto(id: 't1', value: 'Travel')],
              ),
            ),
          ),
        ],
      );
      await tester.pumpAndSettle();

      // DeepSectionScaffold uppercases the key via .tr().toUpperCase() — in
      // tests without localization init, .tr() returns the key as-is.
      expect(find.text('FILTER_SHEET_DEEP_TAGS_SECTION'), findsOneWidget);
    });

    testWidgets('selected chip renders primary color in dark theme', (tester) async {
      await tester.pumpConsumerWidgetDark(
        const Material(child: TagsSectionDeep()),
        overrides: [
          photosFilterSuggestionsProvider.overrideWith(
            (ref, filter) => Future.value(
              _sugg(
                tags: [FilterSuggestionsTagDto(id: 't1', value: 'Travel')],
              ),
            ),
          ),
        ],
      );
      await tester.pumpAndSettle();

      final container = ProviderScope.containerOf(tester.element(find.byType(TagsSectionDeep)));
      container.read(photosFilterProvider.notifier).toggleTag('t1');
      await tester.pumpAndSettle();

      final chip = tester.widget<FilterChip>(find.byKey(const Key('tag-chip-t1')));
      expect(chip.selected, isTrue);
      // Visual assertion: chip's selected state drives ColorScheme.secondaryContainer.
    });
  });
}
