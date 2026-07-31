import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/domain/models/tag.model.dart';
import 'package:immich_mobile/presentation/pages/photos_filter/widgets/selected_tags_strip.widget.dart';
import 'package:immich_mobile/providers/infrastructure/tag.provider.dart';
import 'package:immich_mobile/providers/photos_filter/photos_filter.provider.dart';

import '../../../../widget_tester_extensions.dart';

class _FakeTagNotifier extends TagNotifier {
  final Set<Tag> tags;
  _FakeTagNotifier(this.tags);

  @override
  Future<Set<Tag>> build() async => tags;
}

Tag _t(String id, String value) => Tag(id: id, value: value);

List<Override> _overrides(Set<Tag> tags) => [tagProvider.overrideWith(() => _FakeTagNotifier(tags))];

void main() {
  group('SelectedTagsStrip', () {
    testWidgets('hidden when no selections', (tester) async {
      // Wrap in a Column so SizedBox.shrink() gets loose constraints and
      // actually renders at Size.zero, matching SelectedPeopleStrip's test.
      await tester.pumpConsumerWidget(
        const Column(children: [SelectedTagsStrip()]),
        overrides: _overrides({}),
      );
      expect(find.byType(InputChip), findsNothing);
      expect(tester.getSize(find.byType(SelectedTagsStrip)), Size.zero);
    });

    testWidgets('renders one chip per selected tag id, resolved to full-path value', (tester) async {
      await tester.pumpConsumerWidget(
        const SelectedTagsStrip(),
        overrides: _overrides({_t('t1', 'Travel/Italy/Rome')}),
      );
      final container = ProviderScope.containerOf(tester.element(find.byType(SelectedTagsStrip)));
      container.read(photosFilterProvider.notifier).toggleTag('t1');
      await tester.pumpAndSettle();

      expect(find.byKey(const Key('selected-tag-chip-t1')), findsOneWidget);
      expect(
        find.descendant(of: find.byKey(const Key('selected-tag-chip-t1')), matching: find.text('Travel/Italy/Rome')),
        findsOneWidget,
      );
    });

    testWidgets('unresolved tag id falls back to filter_sheet_tag_fallback label', (tester) async {
      await tester.pumpConsumerWidget(const SelectedTagsStrip(), overrides: _overrides({}));
      final container = ProviderScope.containerOf(tester.element(find.byType(SelectedTagsStrip)));
      container.read(photosFilterProvider.notifier).toggleTag('missing');
      await tester.pumpAndSettle();

      expect(find.byKey(const Key('selected-tag-chip-missing')), findsOneWidget);
      expect(
        find.descendant(of: find.byKey(const Key('selected-tag-chip-missing')), matching: find.text('Tag')),
        findsOneWidget,
      );
    });

    testWidgets('tapping delete removes that tag from photosFilterProvider.tagIds', (tester) async {
      await tester.pumpConsumerWidget(
        const SelectedTagsStrip(),
        overrides: _overrides({_t('t1', 'Travel'), _t('t2', 'Food')}),
      );
      final container = ProviderScope.containerOf(tester.element(find.byType(SelectedTagsStrip)));
      container.read(photosFilterProvider.notifier).toggleTag('t1');
      container.read(photosFilterProvider.notifier).toggleTag('t2');
      await tester.pumpAndSettle();

      final chip = find.byKey(const Key('selected-tag-chip-t1'));
      final deleteIcon = find.descendant(of: chip, matching: find.byIcon(Icons.close_rounded));
      expect(deleteIcon, findsOneWidget);
      await tester.tap(deleteIcon);
      await tester.pumpAndSettle();

      final remaining = container.read(photosFilterProvider).tagIds;
      expect(remaining, ['t2']);
    });

    testWidgets('renders correctly in dark theme', (tester) async {
      await tester.pumpConsumerWidgetDark(const SelectedTagsStrip(), overrides: _overrides({_t('t1', 'Travel')}));
      final container = ProviderScope.containerOf(tester.element(find.byType(SelectedTagsStrip)));
      container.read(photosFilterProvider.notifier).toggleTag('t1');
      await tester.pumpAndSettle();
      expect(find.byType(InputChip), findsOneWidget);
    });
  });
}
