import 'package:easy_localization/easy_localization.dart' hide TextDirection;
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/domain/models/tag.model.dart';
import 'package:immich_mobile/presentation/pages/photos_filter/widgets/tags_picker_list.widget.dart';
import 'package:immich_mobile/providers/photos_filter/photos_filter.provider.dart';

import '../../../../widget_tester_extensions.dart';

Tag _t(String id, String value) => Tag(id: id, value: value);

void main() {
  group('TagsPickerList', () {
    testWidgets('shows a MATCHES bucket header', (tester) async {
      await tester.pumpConsumerWidget(TagsPickerList(tags: [_t('t1', 'Food')]));
      expect(find.text('filter_sheet_picker_tags_matches'.tr().toUpperCase()), findsOneWidget);
    });

    testWidgets('nested tag row shows leaf title + full-path subtitle', (tester) async {
      await tester.pumpConsumerWidget(TagsPickerList(tags: [_t('t1', 'Travel/Italy/Rome')]));
      expect(find.byKey(const Key('tag-row-t1')), findsOneWidget);
      expect(find.descendant(of: find.byKey(const Key('tag-row-t1')), matching: find.text('Rome')), findsOneWidget);
      expect(
        find.descendant(of: find.byKey(const Key('tag-row-t1')), matching: find.textContaining('Travel / Italy')),
        findsOneWidget,
      );
    });

    testWidgets('flat (no-slash) tag row shows the value and no subtitle', (tester) async {
      await tester.pumpConsumerWidget(TagsPickerList(tags: [_t('t1', 'Food')]));
      expect(find.byKey(const Key('tag-row-t1')), findsOneWidget);
      expect(find.descendant(of: find.byKey(const Key('tag-row-t1')), matching: find.text('Food')), findsOneWidget);
      expect(find.byKey(const Key('tag-row-subtitle-t1')), findsNothing);
    });

    testWidgets('tapping a row toggles selection (multi-select)', (tester) async {
      await tester.pumpConsumerWidget(TagsPickerList(tags: [_t('t1', 'Food'), _t('t2', 'Travel')]));
      final container = ProviderScope.containerOf(tester.element(find.byType(TagsPickerList)));

      await tester.tap(find.byKey(const Key('tag-row-t1')));
      await tester.pumpAndSettle();
      expect(container.read(photosFilterProvider).tagIds, contains('t1'));

      await tester.tap(find.byKey(const Key('tag-row-t2')));
      await tester.pumpAndSettle();
      expect(container.read(photosFilterProvider).tagIds, containsAll(['t1', 't2']));

      await tester.tap(find.byKey(const Key('tag-row-t1')));
      await tester.pumpAndSettle();
      final after = container.read(photosFilterProvider).tagIds;
      expect(after, isNot(contains('t1')));
      expect(after, contains('t2'));
    });

    testWidgets('selected row shows a trailing check icon', (tester) async {
      await tester.pumpConsumerWidget(TagsPickerList(tags: [_t('t1', 'Food')]));
      final container = ProviderScope.containerOf(tester.element(find.byType(TagsPickerList)));
      container.read(photosFilterProvider.notifier).toggleTag('t1');
      await tester.pumpAndSettle();

      expect(find.byKey(const Key('tag-row-t1-check')), findsOneWidget);
    });

    testWidgets('large list (5000 tags) is windowed — far-offscreen rows are not built', (tester) async {
      final tags = [for (var i = 0; i < 5000; i++) _t('t$i', 'Tag$i')];
      await tester.pumpConsumerWidget(TagsPickerList(tags: tags));

      expect(find.byKey(const Key('tags-picker-list')), findsOneWidget);
      expect(find.byKey(const Key('tag-row-t0')), findsOneWidget);
      expect(find.byKey(const Key('tag-row-t4999')), findsNothing);
    });

    testWidgets('renders correctly in dark theme', (tester) async {
      await tester.pumpConsumerWidgetDark(TagsPickerList(tags: [_t('t1', 'Food')]));
      expect(find.byKey(const Key('tag-row-t1')), findsOneWidget);
    });
  });
}
