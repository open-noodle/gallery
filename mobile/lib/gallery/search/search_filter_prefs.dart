import 'dart:async';

import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/domain/models/person.model.dart';
import 'package:immich_mobile/domain/models/store.model.dart';
import 'package:immich_mobile/entities/store.entity.dart';

// Search sheet choices kept on the device: the Filters sheet's collapsed and hidden sections, the People and Places sorts, and the People type.
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

/// How the People and Places sheets order their lists: most photos first (the server's order) or A–Z.
enum SearchListSort { count, name }

/// One sheet choice (a sort, the person type), kept on the device by name so the sheet opens with the one chosen last
/// time. An unknown or missing name is [fallback].
class SearchStoredChoiceNotifier<T extends Enum> extends Notifier<T> {
  final StoreKey<String> _key;
  final List<T> _values;
  final T _fallback;

  SearchStoredChoiceNotifier(this._key, this._values, this._fallback);

  @override
  T build() => _values.firstWhere((value) => value.name == Store.tryGet(_key), orElse: () => _fallback);

  void set(T value) {
    state = value;
    unawaited(Store.put(_key, value.name));
  }
}

final searchPeopleSortProvider = NotifierProvider<SearchStoredChoiceNotifier<SearchListSort>, SearchListSort>(
  () => SearchStoredChoiceNotifier(StoreKey.searchPeopleSort, SearchListSort.values, SearchListSort.count),
);

final searchPlacesSortProvider = NotifierProvider<SearchStoredChoiceNotifier<SearchListSort>, SearchListSort>(
  () => SearchStoredChoiceNotifier(StoreKey.searchPlacesSort, SearchListSort.values, SearchListSort.count),
);

/// The People sheet's All / People / Pets toggle, as on the People page. All by default.
final searchPeopleTypeProvider = NotifierProvider<SearchStoredChoiceNotifier<PeopleFilterBy>, PeopleFilterBy>(
  () => SearchStoredChoiceNotifier(StoreKey.searchPeopleType, PeopleFilterBy.values, PeopleFilterBy.all),
);
