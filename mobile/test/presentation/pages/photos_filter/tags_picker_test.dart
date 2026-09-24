import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/data/store.dart';
import 'package:immich_mobile/domain/models/tag.model.dart';
import 'package:immich_mobile/generated/translations.g.dart';
import 'package:immich_mobile/presentation/pages/photos_filter/tags_picker.page.dart';
import 'package:immich_mobile/providers/photos_filter/photos_filter.provider.dart';
import 'package:immich_mobile/providers/photos_filter/tags_picker.provider.dart';

import '../../../widget_tester_extensions.dart';

Tag _t(String id, String value) => Tag(id: id, value: value);

List<Override> _overrides(Set<Tag> tags) => [Store.tags.all().overrideWith((ref) async => tags.toList())];

void main() {
  group('TagsPickerPage', () {
    testWidgets('renders AppBar with back icon, title key, and Done button', (tester) async {
      await tester.pumpConsumerWidget(const TagsPickerPage(), overrides: _overrides({}));
      expect(find.byIcon(Icons.arrow_back_rounded), findsOneWidget);
      expect(find.text(StaticTranslations.instance.filter_sheet_picker_tags_title), findsOneWidget);
      expect(find.byKey(const Key('tags-picker-done')), findsOneWidget);
    });

    testWidgets('Done button meets 48pt tap target', (tester) async {
      await tester.pumpConsumerWidget(const TagsPickerPage(), overrides: _overrides({}));
      expectTapTargetMin(tester, find.byKey(const Key('tags-picker-done')));
    });

    testWidgets('Done button pops the navigator stack', (tester) async {
      await tester.pumpConsumerWidget(
        Builder(
          builder: (context) => Scaffold(
            body: Center(
              child: TextButton(
                key: const Key('open-tags-picker'),
                onPressed: () => Navigator.of(context).push(MaterialPageRoute(builder: (_) => const TagsPickerPage())),
                child: const Text('open'),
              ),
            ),
          ),
        ),
        overrides: _overrides({}),
      );
      await tester.tap(find.byKey(const Key('open-tags-picker')));
      await tester.pumpAndSettle();
      expect(find.byType(TagsPickerPage), findsOneWidget);

      await tester.tap(find.byKey(const Key('tags-picker-done')));
      await tester.pumpAndSettle();
      expect(find.byType(TagsPickerPage), findsNothing);
    });

    testWidgets('renders correctly in dark theme', (tester) async {
      await tester.pumpConsumerWidgetDark(const TagsPickerPage(), overrides: _overrides({}));
      expect(find.byType(TagsPickerPage), findsOneWidget);
    });
  });

  group('TagsPickerPage rows + search', () {
    testWidgets('lists tags from the full Store.tags.all(), each with leaf + full-path subtitle', (tester) async {
      await tester.pumpConsumerWidget(
        const TagsPickerPage(),
        overrides: _overrides({_t('t1', 'Travel/Italy/Rome'), _t('t2', 'Food')}),
      );
      await tester.pumpAndSettle();

      expect(find.byKey(const Key('tag-row-t1')), findsOneWidget);
      expect(find.byKey(const Key('tag-row-t2')), findsOneWidget);
      expect(find.descendant(of: find.byKey(const Key('tag-row-t1')), matching: find.text('Rome')), findsOneWidget);
      expect(
        find.descendant(of: find.byKey(const Key('tag-row-t1')), matching: find.textContaining('Travel / Italy')),
        findsOneWidget,
      );
      expect(find.descendant(of: find.byKey(const Key('tag-row-t2')), matching: find.text('Food')), findsOneWidget);
      expect(find.byKey(const Key('tag-row-subtitle-t2')), findsNothing);
    });

    testWidgets('tapping rows multi-selects: tap two → both present; tap again → removed', (tester) async {
      await tester.pumpConsumerWidget(
        const TagsPickerPage(),
        overrides: _overrides({_t('t1', 'Food'), _t('t2', 'Travel')}),
      );
      await tester.pumpAndSettle();

      final container = ProviderScope.containerOf(tester.element(find.byType(TagsPickerPage)));

      await tester.tap(find.byKey(const Key('tag-row-t1')));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('tag-row-t2')));
      await tester.pumpAndSettle();
      expect(container.read(photosFilterProvider).tagIds, containsAll(['t1', 't2']));

      await tester.tap(find.byKey(const Key('tag-row-t1')));
      await tester.pumpAndSettle();
      final after = container.read(photosFilterProvider).tagIds;
      expect(after, isNot(contains('t1')));
      expect(after, contains('t2'));
    });

    testWidgets('typing updates tagsPickerQueryProvider', (tester) async {
      await tester.pumpConsumerWidget(
        const TagsPickerPage(),
        overrides: _overrides({_t('t1', 'Travel/Italy/Rome'), _t('t2', 'Food')}),
      );
      await tester.pumpAndSettle();

      final container = ProviderScope.containerOf(tester.element(find.byType(TagsPickerPage)));
      await tester.enterText(find.byKey(const Key('tags-picker-search-field')), 'rom');
      await tester.pump();

      expect(container.read(tagsPickerQueryProvider), 'rom');
    });

    testWidgets('search "rom" narrows the list to only the Rome row', (tester) async {
      await tester.pumpConsumerWidget(
        const TagsPickerPage(),
        overrides: _overrides({_t('t1', 'Travel/Italy/Rome'), _t('t2', 'Food')}),
      );
      await tester.pumpAndSettle();

      await tester.enterText(find.byKey(const Key('tags-picker-search-field')), 'rom');
      await tester.pumpAndSettle();

      expect(find.byKey(const Key('tag-row-t1')), findsOneWidget);
      expect(find.byKey(const Key('tag-row-t2')), findsNothing);
    });

    testWidgets('clearing the query resets provider state', (tester) async {
      await tester.pumpConsumerWidget(const TagsPickerPage(), overrides: _overrides({_t('t1', 'Food')}));
      await tester.pumpAndSettle();

      final container = ProviderScope.containerOf(tester.element(find.byType(TagsPickerPage)));
      await tester.enterText(find.byKey(const Key('tags-picker-search-field')), 'xyz');
      await tester.pump();
      expect(container.read(tagsPickerQueryProvider), 'xyz');

      await tester.enterText(find.byKey(const Key('tags-picker-search-field')), '');
      await tester.pump();
      expect(container.read(tagsPickerQueryProvider), '');
    });

    testWidgets('non-matching query renders No results + Clear search, tapping clears', (tester) async {
      await tester.pumpConsumerWidget(const TagsPickerPage(), overrides: _overrides({_t('t1', 'Food')}));
      await tester.pumpAndSettle();

      await tester.enterText(find.byKey(const Key('tags-picker-search-field')), 'zzzzz');
      await tester.pumpAndSettle();

      expect(find.byKey(const Key('tags-picker-clear-search')), findsOneWidget);

      final container = ProviderScope.containerOf(tester.element(find.byType(TagsPickerPage)));
      await tester.tap(find.byKey(const Key('tags-picker-clear-search')));
      await tester.pumpAndSettle();

      expect(container.read(tagsPickerQueryProvider), '');
      expect(find.byKey(const Key('tags-picker-clear-search')), findsNothing);
    });
  });

  group('TagsPickerPage error state', () {
    testWidgets('renders a tappable retry; tapping invalidates Store.tags.all() and refetches', (tester) async {
      // Throws on the first fetch, succeeds on every later one — proves that tapping "retry"
      // performs a genuine refetch (invalidate re-runs this override), not a cosmetic re-render.
      var calls = 0;
      await tester.pumpConsumerWidget(
        const TagsPickerPage(),
        overrides: [
          Store.tags.all().overrideWith((ref) async {
            calls++;
            if (calls == 1) {
              throw Exception('network down');
            }
            return [_t('t1', 'Food')];
          }),
        ],
      );
      await tester.pumpAndSettle();

      expect(find.byKey(const Key('tags-picker-retry')), findsOneWidget);

      await tester.tap(find.byKey(const Key('tags-picker-retry')));
      await tester.pumpAndSettle();

      expect(find.byKey(const Key('tags-picker-retry')), findsNothing);
      expect(find.byKey(const Key('tag-row-t1')), findsOneWidget);
    });
  });
}
