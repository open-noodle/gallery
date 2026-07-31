import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/presentation/widgets/filter_sheet/deep/deep_section_scaffold.widget.dart';
import 'package:immich_mobile/presentation/widgets/filter_sheet/filter_section_id.dart';
import 'package:immich_mobile/providers/photos_filter/collapsed_sections.provider.dart';

class _FakePrefs implements FilterSectionPrefs {
  Set<FilterSectionId> stored;
  _FakePrefs(this.stored);
  @override
  Set<FilterSectionId> loadCollapsed() => stored;
  @override
  Future<void> saveCollapsed(Set<FilterSectionId> ids) async => stored = ids;
}

Widget _host(AsyncValue<List<String>> items, {Set<FilterSectionId> collapsed = const {}}) => ProviderScope(
  overrides: [
    filterSectionPrefsProvider.overrideWithValue(_FakePrefs({...collapsed})),
  ],
  child: MaterialApp(
    localizationsDelegates: const [DefaultMaterialLocalizations.delegate, DefaultWidgetsLocalizations.delegate],
    home: Scaffold(
      body: ListView(
        children: [
          DeepSectionScaffold<String>(
            sectionId: FilterSectionId.tags,
            titleKey: FilterSectionId.tags.titleKey,
            emptyCaptionKey: 'filter_sheet_deep_empty_tags',
            items: items,
            childBuilder: (data) => Column(children: [for (final d in data) Text(d, key: Key('item-$d'))]),
          ),
        ],
      ),
    ),
  ),
);

/// Mutable-data harness: drives a SINGLE `DeepSectionScaffold` instance
/// through a data transition (e.g. empty → non-empty) via a `ValueNotifier`,
/// mirroring the `_pump` helper in `deep_section_scaffold_test.dart`.
Future<ValueNotifier<AsyncValue<List<String>>>> _pumpMutable(
  WidgetTester tester, {
  required AsyncValue<List<String>> initial,
  Set<FilterSectionId> collapsed = const {},
}) async {
  final notifier = ValueNotifier<AsyncValue<List<String>>>(initial);
  addTearDown(notifier.dispose);
  await tester.pumpWidget(
    ProviderScope(
      overrides: [
        filterSectionPrefsProvider.overrideWithValue(_FakePrefs({...collapsed})),
      ],
      child: MaterialApp(
        localizationsDelegates: const [DefaultMaterialLocalizations.delegate, DefaultWidgetsLocalizations.delegate],
        home: Scaffold(
          body: ListView(
            children: [
              ValueListenableBuilder<AsyncValue<List<String>>>(
                valueListenable: notifier,
                builder: (_, value, __) => DeepSectionScaffold<String>(
                  sectionId: FilterSectionId.tags,
                  titleKey: FilterSectionId.tags.titleKey,
                  emptyCaptionKey: 'filter_sheet_deep_empty_tags',
                  items: value,
                  childBuilder: (data) => Column(children: [for (final d in data) Text(d, key: Key('item-$d'))]),
                ),
              ),
            ],
          ),
        ),
      ),
    ),
  );
  await tester.pumpAndSettle();
  return notifier;
}

void main() {
  testWidgets('non-empty section renders items and is collapsible', (t) async {
    await t.pumpWidget(_host(const AsyncData(['a', 'b'])));
    await t.pumpAndSettle();
    expect(find.byKey(const Key('item-a')), findsOneWidget);
    await t.tap(find.byKey(const Key('collapsible-header-tags')));
    await t.pumpAndSettle();
    expect(find.byKey(const Key('item-a')), findsNothing);
  });

  testWidgets('empty section auto-collapses (items hidden, "(0)" shown)', (t) async {
    await t.pumpWidget(_host(const AsyncData(<String>[])));
    await t.pumpAndSettle();
    expect(find.textContaining('(0)'), findsOneWidget);
    // no items, and tapping does not expand (disabled)
    await t.tap(find.byKey(const Key('collapsible-header-tags')));
    await t.pumpAndSettle();
    expect(find.byKey(const Key('deep-section-empty')), findsNothing);
  });

  testWidgets('a section that becomes non-empty is re-enabled and defaults expanded', (t) async {
    final notifier = await _pumpMutable(t, initial: const AsyncData<List<String>>([]));

    // Starts empty: "(0)" shown, tapping the header is a no-op (body stays hidden).
    expect(find.textContaining('(0)'), findsOneWidget);
    await t.tap(find.byKey(const Key('collapsible-header-tags')));
    await t.pumpAndSettle();
    expect(find.byKey(const Key('item-a')), findsNothing);

    // Data arrives on the SAME widget instance.
    notifier.value = const AsyncData<List<String>>(['a']);
    await t.pumpAndSettle();

    // Re-enabled + defaults expanded (not in the collapsed set) so the item is visible.
    expect(find.byKey(const Key('item-a')), findsOneWidget);

    // The header now toggles like any other non-empty section.
    await t.tap(find.byKey(const Key('collapsible-header-tags')));
    await t.pumpAndSettle();
    expect(find.byKey(const Key('item-a')), findsNothing);
  });

  testWidgets('a section that becomes non-empty respects a stored collapse choice', (t) async {
    final notifier = await _pumpMutable(
      t,
      initial: const AsyncData<List<String>>([]),
      collapsed: {FilterSectionId.tags},
    );

    expect(find.textContaining('(0)'), findsOneWidget);

    notifier.value = const AsyncData<List<String>>(['a']);
    await t.pumpAndSettle();

    // Section is present and re-enabled, but the stored collapse choice keeps it collapsed.
    expect(find.byKey(const Key('collapsible-section-tags')), findsOneWidget);
    expect(find.byKey(const Key('item-a')), findsNothing);

    // Tapping the (now enabled) header expands it.
    await t.tap(find.byKey(const Key('collapsible-header-tags')));
    await t.pumpAndSettle();
    expect(find.byKey(const Key('item-a')), findsOneWidget);
  });
}
