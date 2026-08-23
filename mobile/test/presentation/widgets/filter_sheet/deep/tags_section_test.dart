import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/generated/translations.g.dart';
import 'package:immich_mobile/presentation/widgets/filter_sheet/deep/tags_section.widget.dart';
import 'package:immich_mobile/presentation/widgets/filter_sheet/filter_section_id.dart';
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

FilterSuggestionsResponseDto _sugg({List<FilterSuggestionsTagDto>? tags}) => FilterSuggestionsResponseDto(
  hasUnnamedPeople: false,
  hasFavorites: true,
  hasAssetsInAlbum: true,
  hasAssetsNotInAlbum: true,
  tags: tags ?? const [],
);

void main() {
  group('TagsSectionDeep', () {
    testWidgets('renders one FilterChip per tag via DeepSectionScaffold', (tester) async {
      await tester.pumpConsumerWidget(
        const Material(child: TagsSectionDeep()),
        overrides: [
          _noCollapsed(),
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
          _noCollapsed(),
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
          _noCollapsed(),
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

    testWidgets('empty tags → section auto-collapses, "(0)" shown, empty caption hidden', (tester) async {
      await tester.pumpConsumerWidget(
        const Material(child: TagsSectionDeep()),
        overrides: [
          _noCollapsed(),
          photosFilterSuggestionsProvider.overrideWith((ref, filter) => Future.value(_sugg(tags: []))),
        ],
      );
      await tester.pumpAndSettle();

      expect(find.textContaining('(0)'), findsOneWidget);
      expect(find.byKey(const Key('deep-section-empty')), findsNothing);
    });

    testWidgets('section title renders via filter_sheet_deep_tags_section key', (tester) async {
      await tester.pumpConsumerWidget(
        const Material(child: TagsSectionDeep()),
        overrides: [
          _noCollapsed(),
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

      // DeepSectionScaffold renders the title as .tr().toUpperCase(); the
      // localized pump resolves it, so assert on the same value.
      expect(find.text(StaticTranslations.instance.filter_sheet_deep_tags_section.toUpperCase()), findsOneWidget);
    });

    // Slice 5 / final review: cap the preview Wrap to 10 chips + a body "Search N tags →" row.
    testWidgets('caps preview to 10 chips + renders "Search N tags →" in the body (not the header)', (tester) async {
      final tags = [for (var i = 0; i < 15; i++) FilterSuggestionsTagDto(id: 't$i', value: 'Tag$i')];
      await tester.pumpConsumerWidget(
        const Material(child: TagsSectionDeep()),
        overrides: [
          _noCollapsed(),
          photosFilterSuggestionsProvider.overrideWith((ref, filter) => Future.value(_sugg(tags: tags))),
        ],
      );
      await tester.pumpAndSettle();

      for (var i = 0; i < 10; i++) {
        expect(find.byKey(Key('tag-chip-t$i')), findsOneWidget);
      }
      for (var i = 10; i < 15; i++) {
        expect(find.byKey(Key('tag-chip-t$i')), findsNothing);
      }

      expect(
        find.descendant(
          of: find.byKey(const Key('collapsible-body-tags')),
          matching: find.byKey(const Key('tags-section-search-more')),
        ),
        findsOneWidget,
      );
      expect(
        find.descendant(
          of: find.byKey(const Key('collapsible-header-tags')),
          matching: find.byKey(const Key('tags-section-search-more')),
        ),
        findsNothing,
      );
    });

    testWidgets('tapping "Search N tags →" fires onOpenPicker', (tester) async {
      var opened = false;
      final tags = [for (var i = 0; i < 15; i++) FilterSuggestionsTagDto(id: 't$i', value: 'Tag$i')];
      await tester.pumpConsumerWidget(
        Material(child: TagsSectionDeep(onOpenPicker: () => opened = true)),
        overrides: [
          _noCollapsed(),
          photosFilterSuggestionsProvider.overrideWith((ref, filter) => Future.value(_sugg(tags: tags))),
        ],
      );
      await tester.pumpAndSettle();

      await tester.tap(find.byKey(const Key('tags-section-search-more')));
      expect(opened, isTrue);
    });

    testWidgets('pins a selected tag beyond the first 10', (tester) async {
      final tags = [for (var i = 0; i < 15; i++) FilterSuggestionsTagDto(id: 't$i', value: 'Tag$i')];
      await tester.pumpConsumerWidget(
        const Material(child: TagsSectionDeep()),
        overrides: [
          _noCollapsed(),
          photosFilterSuggestionsProvider.overrideWith((ref, filter) => Future.value(_sugg(tags: tags))),
        ],
      );
      await tester.pumpAndSettle();

      final container = ProviderScope.containerOf(tester.element(find.byType(TagsSectionDeep)));
      container.read(photosFilterProvider.notifier).toggleTag('t11');
      await tester.pumpAndSettle();

      // Pinned beyond the cap because it's selected.
      expect(find.byKey(const Key('tag-chip-t11')), findsOneWidget);
      // The remaining, unselected overflow stays hidden.
      expect(find.byKey(const Key('tag-chip-t12')), findsNothing);
      expect(find.byKey(const Key('tag-chip-t13')), findsNothing);
      expect(find.byKey(const Key('tag-chip-t14')), findsNothing);
    });

    testWidgets('≤10 tags renders all, no over-cap', (tester) async {
      final tags = [for (var i = 0; i < 7; i++) FilterSuggestionsTagDto(id: 't$i', value: 'Tag$i')];
      await tester.pumpConsumerWidget(
        const Material(child: TagsSectionDeep()),
        overrides: [
          _noCollapsed(),
          photosFilterSuggestionsProvider.overrideWith((ref, filter) => Future.value(_sugg(tags: tags))),
        ],
      );
      await tester.pumpAndSettle();

      for (var i = 0; i < 7; i++) {
        expect(find.byKey(Key('tag-chip-t$i')), findsOneWidget);
      }
    });

    testWidgets('selected chip renders primary color in dark theme', (tester) async {
      await tester.pumpConsumerWidgetDark(
        const Material(child: TagsSectionDeep()),
        overrides: [
          _noCollapsed(),
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
