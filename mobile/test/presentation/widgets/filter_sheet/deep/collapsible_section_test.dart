import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/presentation/widgets/filter_sheet/deep/collapsible_section.widget.dart';
import 'package:immich_mobile/presentation/widgets/filter_sheet/filter_section_id.dart';
import 'package:immich_mobile/providers/photos_filter/collapsed_sections.provider.dart';

import '../../../../widget_tester_extensions.dart';

class _FakePrefs implements FilterSectionPrefs {
  final Set<FilterSectionId> collapsed;
  _FakePrefs(this.collapsed);
  @override
  Set<FilterSectionId> loadCollapsed() => collapsed;
  @override
  Future<void> saveCollapsed(Set<FilterSectionId> ids) async {}
}

List<Override> _prefs([Set<FilterSectionId> collapsed = const {}]) => [
  filterSectionPrefsProvider.overrideWithValue(_FakePrefs({...collapsed})),
];

CollapsibleSection _section(FilterSectionId id, {bool isEmpty = false, Widget? trailing}) => CollapsibleSection(
  sectionId: id,
  titleKey: id.titleKey,
  isEmpty: isEmpty,
  trailingHeader: trailing,
  child: const Text('BODY', key: Key('body-marker')),
);

void main() {
  testWidgets('expanded by default: header + body visible', (t) async {
    await t.pumpConsumerWidget(_section(FilterSectionId.people), overrides: _prefs());
    expect(find.byKey(const Key('collapsible-header-people')), findsOneWidget);
    expect(find.byKey(const Key('body-marker')), findsOneWidget);
  });

  testWidgets('tapping header collapses the body', (t) async {
    await t.pumpConsumerWidget(_section(FilterSectionId.people), overrides: _prefs());
    await t.tap(find.byKey(const Key('collapsible-header-people')));
    await t.pumpAndSettle();
    expect(find.byKey(const Key('body-marker')), findsNothing);
  });

  testWidgets('starts collapsed when id is in the persisted set, expands on tap', (t) async {
    await t.pumpConsumerWidget(_section(FilterSectionId.tags), overrides: _prefs({FilterSectionId.tags}));
    expect(find.byKey(const Key('body-marker')), findsNothing);
    await t.tap(find.byKey(const Key('collapsible-header-tags')));
    await t.pumpAndSettle();
    expect(find.byKey(const Key('body-marker')), findsOneWidget);
  });

  testWidgets('empty section: body hidden, "(0)" shown, tap is a no-op', (t) async {
    await t.pumpConsumerWidget(_section(FilterSectionId.tags, isEmpty: true), overrides: _prefs());
    expect(find.byKey(const Key('body-marker')), findsNothing);
    expect(find.textContaining('(0)'), findsOneWidget);
    await t.tap(find.byKey(const Key('collapsible-header-tags')));
    await t.pumpAndSettle();
    expect(find.byKey(const Key('body-marker')), findsNothing); // still collapsed/disabled
  });

  testWidgets('trailing header is rendered when provided', (t) async {
    await t.pumpConsumerWidget(
      _section(FilterSectionId.people, trailing: const Text('TRAILING', key: Key('trailing-marker'))),
      overrides: _prefs(),
    );
    expect(find.byKey(const Key('trailing-marker')), findsOneWidget);
  });

  testWidgets('reduced motion collapses immediately', (t) async {
    await t.pumpConsumerWidget(
      Builder(
        builder: (context) => MediaQuery(
          data: MediaQuery.of(context).copyWith(disableAnimations: true),
          child: _section(FilterSectionId.people),
        ),
      ),
      overrides: _prefs(),
    );
    await t.tap(find.byKey(const Key('collapsible-header-people')));
    await t.pump();
    expect(find.byKey(const Key('body-marker')), findsNothing);
  });
}
