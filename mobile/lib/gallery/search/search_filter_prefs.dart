import 'dart:async';

import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/domain/models/store.model.dart';
import 'package:immich_mobile/entities/store.entity.dart';

// The Filters sheet's own layout choices, kept on the device: which sections are collapsed, and which the cog hides.
// A section is named by its key in the sheet (`search-filter-section-<name>`): the SearchSection names plus
// `dateRange`. Names the sheet no longer has are ignored.

class SearchFilterSectionPrefs {
  final Set<String> collapsed;
  final Set<String> hidden;

  const SearchFilterSectionPrefs({this.collapsed = const {}, this.hidden = const {}});
}

class SearchFilterSectionPrefsNotifier extends Notifier<SearchFilterSectionPrefs> {
  @override
  SearchFilterSectionPrefs build() => SearchFilterSectionPrefs(
    collapsed: _read(StoreKey.searchFiltersCollapsedSections),
    hidden: _read(StoreKey.searchFiltersHiddenSections),
  );

  static Set<String> _read(StoreKey<String> key) {
    final value = Store.tryGet(key);
    if (value == null || value.isEmpty) {
      return const {};
    }
    return value.split(',').where((name) => name.isNotEmpty).toSet();
  }

  static Set<String> _toggled(Set<String> names, String name) =>
      names.contains(name) ? ({...names}..remove(name)) : {...names, name};

  void toggleCollapsed(String section) {
    state = SearchFilterSectionPrefs(collapsed: _toggled(state.collapsed, section), hidden: state.hidden);
    unawaited(Store.put(StoreKey.searchFiltersCollapsedSections, (state.collapsed.toList()..sort()).join(',')));
  }

  void toggleHidden(String section) {
    state = SearchFilterSectionPrefs(collapsed: state.collapsed, hidden: _toggled(state.hidden, section));
    unawaited(Store.put(StoreKey.searchFiltersHiddenSections, (state.hidden.toList()..sort()).join(',')));
  }
}

final searchFilterSectionPrefsProvider = NotifierProvider<SearchFilterSectionPrefsNotifier, SearchFilterSectionPrefs>(
  SearchFilterSectionPrefsNotifier.new,
);
