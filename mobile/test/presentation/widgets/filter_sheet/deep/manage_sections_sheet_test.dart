import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/presentation/widgets/filter_sheet/deep/manage_sections_sheet.widget.dart';
import 'package:immich_mobile/presentation/widgets/filter_sheet/filter_section_id.dart';
import 'package:immich_mobile/providers/photos_filter/hidden_sections.provider.dart';

import '../../../../widget_tester_extensions.dart';

class _FakeVis implements FilterSectionVisibilityPrefs {
  Set<FilterSectionId> stored;
  _FakeVis(this.stored);
  @override
  Set<FilterSectionId> loadHidden() => stored;
  @override
  Future<void> saveHidden(Set<FilterSectionId> ids) async => stored = ids;
}

List<Override> _vis([Set<FilterSectionId> hidden = const {}]) => [
  filterSectionVisibilityPrefsProvider.overrideWithValue(_FakeVis({...hidden})),
];

void main() {
  testWidgets('renders a toggle per section; hidden ones are OFF', (t) async {
    await t.pumpConsumerWidget(const ManageSectionsSheet(), overrides: _vis({FilterSectionId.tags}));
    for (final s in FilterSectionId.values) {
      expect(find.byKey(Key('manage-section-${s.storageId}')), findsOneWidget);
    }
    final tagsTile = t.widget<SwitchListTile>(find.byKey(const Key('manage-section-tags')));
    expect(tagsTile.value, isFalse);
    final peopleTile = t.widget<SwitchListTile>(find.byKey(const Key('manage-section-people')));
    expect(peopleTile.value, isTrue);
  });

  testWidgets('toggling a section off updates the provider', (t) async {
    await t.pumpConsumerWidget(const ManageSectionsSheet(), overrides: _vis());
    await t.tap(find.byKey(const Key('manage-section-people')));
    await t.pumpAndSettle();
    final peopleTile = t.widget<SwitchListTile>(find.byKey(const Key('manage-section-people')));
    expect(peopleTile.value, isFalse);
  });
}
