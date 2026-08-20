import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/domain/models/store.model.dart';
import 'package:immich_mobile/entities/store.entity.dart';

@visibleForTesting
String encodeHiddenDailyBanners(Set<String> spaceIds) => jsonEncode(spaceIds.toList());

@visibleForTesting
Set<String> decodeHiddenDailyBanners(String json) {
  try {
    final raw = jsonDecode(json);
    if (raw is! List) return {};
    return raw.whereType<String>().toSet();
  } catch (_) {
    return {};
  }
}

/// Persistence gateway for the set of spaces whose daily banner is hidden (empty = all shown).
///
/// DEVICE-local rather than account-level, and deliberately so: the banner it hides exists only in
/// this client — web renders the daily card on the space Challenges page and nowhere else — so a
/// server-side member preference would be storing a display choice no other client can act on.
abstract class HiddenDailyBannerPrefs {
  Set<String> loadHidden();
  Future<void> saveHidden(Set<String> spaceIds);
}

class StoreHiddenDailyBannerPrefs implements HiddenDailyBannerPrefs {
  const StoreHiddenDailyBannerPrefs();

  @override
  Set<String> loadHidden() => decodeHiddenDailyBanners(Store.get(StoreKey.spacesHiddenDailyBanner, '[]'));

  @override
  Future<void> saveHidden(Set<String> spaceIds) =>
      Store.put(StoreKey.spacesHiddenDailyBanner, encodeHiddenDailyBanners(spaceIds));
}

final hiddenDailyBannerPrefsProvider = Provider<HiddenDailyBannerPrefs>((_) => const StoreHiddenDailyBannerPrefs());

/// Read SYNCHRONOUSLY at build: `computeTopSliverHeight` consumes the space timeline's reserved
/// height at layout time, so a Future-backed preference would reserve the banner's height for a
/// frame before hiding it. `Store.get` is a synchronous cache read, which is what makes that work.
final hiddenDailyBannerProvider = NotifierProvider<HiddenDailyBannerNotifier, Set<String>>(
  HiddenDailyBannerNotifier.new,
);

class HiddenDailyBannerNotifier extends Notifier<Set<String>> {
  @override
  Set<String> build() => ref.read(hiddenDailyBannerPrefsProvider).loadHidden();

  bool isHidden(String spaceId) => state.contains(spaceId);

  void setHidden(String spaceId, bool hidden) {
    final next = Set<String>.from(state);
    if (hidden) {
      next.add(spaceId);
    } else {
      next.remove(spaceId);
    }
    state = next;
    ref.read(hiddenDailyBannerPrefsProvider).saveHidden(next);
  }
}
