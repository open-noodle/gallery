import 'dart:async';
import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/domain/models/store.model.dart';
import 'package:immich_mobile/entities/store.entity.dart';
import 'package:immich_mobile/presentation/widgets/filter_sheet/filter_section_id.dart';

@visibleForTesting
String encodeHiddenSections(Set<FilterSectionId> ids) => jsonEncode(ids.map((e) => e.storageId).toList());

@visibleForTesting
Set<FilterSectionId> decodeHiddenSections(String json) {
  try {
    final raw = jsonDecode(json);
    if (raw is! List) {
      return {};
    }
    return raw.whereType<String>().map(FilterSectionId.fromStorageId).whereType<FilterSectionId>().toSet();
  } catch (_) {
    return {};
  }
}

/// Persistence gateway for the hidden-section set (empty = all visible). SEPARATE
/// from Slice 1's FilterSectionPrefs so existing FilterSectionPrefs test fakes
/// are unaffected.
abstract class FilterSectionVisibilityPrefs {
  Set<FilterSectionId> loadHidden();
  Future<void> saveHidden(Set<FilterSectionId> ids);
}

class StoreFilterSectionVisibilityPrefs implements FilterSectionVisibilityPrefs {
  const StoreFilterSectionVisibilityPrefs();

  @override
  Set<FilterSectionId> loadHidden() => decodeHiddenSections(Store.get(StoreKey.filterSheetHiddenSections, '[]'));

  @override
  Future<void> saveHidden(Set<FilterSectionId> ids) =>
      Store.put(StoreKey.filterSheetHiddenSections, encodeHiddenSections(ids));
}

final filterSectionVisibilityPrefsProvider = Provider<FilterSectionVisibilityPrefs>(
  (_) => const StoreFilterSectionVisibilityPrefs(),
);

final hiddenSectionsProvider = NotifierProvider<HiddenSectionsNotifier, Set<FilterSectionId>>(
  HiddenSectionsNotifier.new,
);

class HiddenSectionsNotifier extends Notifier<Set<FilterSectionId>> {
  @override
  Set<FilterSectionId> build() => ref.read(filterSectionVisibilityPrefsProvider).loadHidden();

  bool isVisible(FilterSectionId id) => !state.contains(id);

  void setVisible(FilterSectionId id, bool visible) {
    final next = Set<FilterSectionId>.from(state);
    if (visible) {
      next.remove(id);
    } else {
      next.add(id);
    }
    state = next;
    unawaited(ref.read(filterSectionVisibilityPrefsProvider).saveHidden(next));
  }
}
