import 'dart:async';
import 'dart:convert';

import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/domain/models/store.model.dart';
import 'package:immich_mobile/entities/store.entity.dart';
import 'package:immich_mobile/gallery/cleanup/models/library_cleanup_filters.dart';
import 'package:immich_mobile/gallery/cleanup/models/library_cleanup_queue.dart';

// Library Cleanup's remembered choices, all in one JSON string under StoreKey.libraryCleanupPrefs: swipe or button
// mode (one setting for every deck), Swipe or Grid per queue, the filters per queue, and the first-run flags. A
// missing or corrupt value is the defaults.

enum LibraryCleanupDeckMode { swipe, button }

enum LibraryCleanupView { swipe, grid }

class LibraryCleanupPrefs {
  const LibraryCleanupPrefs({
    this.deckMode = LibraryCleanupDeckMode.swipe,
    this.views = const {},
    this.filters = const {},
    this.overlaySeen = false,
    this.seriesOverlaySeen = false,
    this.gridHintSeen = false,
  });

  final LibraryCleanupDeckMode deckMode;
  final Map<LibraryCleanupQueue, LibraryCleanupView> views;

  /// Only the queues the user changed filters for; the others are at their defaults.
  final Map<LibraryCleanupQueue, LibraryCleanupFilters> filters;

  /// The gesture overlay of the first photo deck ever (rewind or a photo queue).
  final bool overlaySeen;

  /// The series card's own gesture overlay, the first time Bursts or Duplicates opens: its swipes mean something else.
  final bool seriesOverlaySeen;

  /// The one-time "Hold a photo for details" hint.
  final bool gridHintSeen;

  LibraryCleanupView viewFor(LibraryCleanupQueue queue) => views[queue] ?? LibraryCleanupView.swipe;

  LibraryCleanupFilters filtersFor(LibraryCleanupQueue queue) =>
      filters[queue] ?? LibraryCleanupFilters.defaults(queue);

  LibraryCleanupPrefs copyWith({
    LibraryCleanupDeckMode? deckMode,
    Map<LibraryCleanupQueue, LibraryCleanupView>? views,
    Map<LibraryCleanupQueue, LibraryCleanupFilters>? filters,
    bool? overlaySeen,
    bool? seriesOverlaySeen,
    bool? gridHintSeen,
  }) => LibraryCleanupPrefs(
    deckMode: deckMode ?? this.deckMode,
    views: views ?? this.views,
    filters: filters ?? this.filters,
    overlaySeen: overlaySeen ?? this.overlaySeen,
    seriesOverlaySeen: seriesOverlaySeen ?? this.seriesOverlaySeen,
    gridHintSeen: gridHintSeen ?? this.gridHintSeen,
  );

  String toJsonString() => jsonEncode({
    'deckMode': deckMode.name,
    'views': {for (final entry in views.entries) entry.key.slug: entry.value.name},
    'filters': {for (final entry in filters.entries) entry.key.slug: entry.value.toJson()},
    'overlaySeen': overlaySeen,
    'seriesOverlaySeen': seriesOverlaySeen,
    'gridHintSeen': gridHintSeen,
  });

  /// Reads what [toJsonString] wrote. Anything missing or malformed is its default.
  static LibraryCleanupPrefs fromJsonString(String? value) {
    if (value == null || value.isEmpty) {
      return const LibraryCleanupPrefs();
    }
    try {
      final json = jsonDecode(value);
      if (json is! Map) {
        return const LibraryCleanupPrefs();
      }
      final views = <LibraryCleanupQueue, LibraryCleanupView>{};
      if (json['views'] is Map) {
        for (final entry in (json['views'] as Map).entries) {
          final queue = LibraryCleanupQueue.fromSlug(entry.key as String?);
          final view = LibraryCleanupView.values.where((v) => v.name == entry.value).firstOrNull;
          if (queue != null && view != null) {
            views[queue] = view;
          }
        }
      }
      final filters = <LibraryCleanupQueue, LibraryCleanupFilters>{};
      if (json['filters'] is Map) {
        for (final entry in (json['filters'] as Map).entries) {
          final queue = LibraryCleanupQueue.fromSlug(entry.key as String?);
          if (queue != null) {
            final read = LibraryCleanupFilters.fromJson(queue, entry.value);
            if (read.isBlurry || read.isSpaceHogs) {
              filters[queue] = read;
            }
          }
        }
      }
      return LibraryCleanupPrefs(
        deckMode:
            LibraryCleanupDeckMode.values.where((m) => m.name == json['deckMode']).firstOrNull ??
            LibraryCleanupDeckMode.swipe,
        views: views,
        filters: filters,
        overlaySeen: json['overlaySeen'] == true,
        seriesOverlaySeen: json['seriesOverlaySeen'] == true,
        gridHintSeen: json['gridHintSeen'] == true,
      );
    } catch (_) {
      return const LibraryCleanupPrefs();
    }
  }
}

class LibraryCleanupPrefsNotifier extends Notifier<LibraryCleanupPrefs> {
  @override
  LibraryCleanupPrefs build() => LibraryCleanupPrefs.fromJsonString(Store.tryGet(StoreKey.libraryCleanupPrefs));

  void _set(LibraryCleanupPrefs next) {
    state = next;
    unawaited(Store.put(StoreKey.libraryCleanupPrefs, next.toJsonString()));
  }

  void setDeckMode(LibraryCleanupDeckMode mode) => _set(state.copyWith(deckMode: mode));

  void setView(LibraryCleanupQueue queue, LibraryCleanupView view) =>
      _set(state.copyWith(views: {...state.views, queue: view}));

  void setFilters(LibraryCleanupFilters filters) =>
      _set(state.copyWith(filters: {...state.filters, filters.queue: filters}));

  /// Counts as seen as soon as it shows (the web explainer's rule).
  void markOverlaySeen() {
    if (!state.overlaySeen) {
      _set(state.copyWith(overlaySeen: true));
    }
  }

  void markSeriesOverlaySeen() {
    if (!state.seriesOverlaySeen) {
      _set(state.copyWith(seriesOverlaySeen: true));
    }
  }

  /// One flag for every grid's "Hold a photo for details", seen as soon as it shows.
  void markGridHintSeen() {
    if (!state.gridHintSeen) {
      _set(state.copyWith(gridHintSeen: true));
    }
  }
}

final libraryCleanupPrefsProvider = NotifierProvider<LibraryCleanupPrefsNotifier, LibraryCleanupPrefs>(
  LibraryCleanupPrefsNotifier.new,
);
