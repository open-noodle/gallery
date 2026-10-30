import 'package:openapi/api.dart';

/// One card of the Bursts or Duplicates queue: a burst series or a duplicate group (specs/2026-10-29-mobile-library-
/// cleanup-design.md, "Queues: Bursts and Duplicates"). Both are shown with the same series card, so both are read into
/// this one shape: the frames as cleanup photos, in the server's order, and the frames the server suggests keeping.
class LibraryCleanupSeries {
  const LibraryCleanupSeries({
    required this.id,
    required this.assets,
    required this.suggested,
    this.source,
    this.full = const {},
  });

  /// A burst's `groupId` (its first frame's id) or a duplicate group's `duplicateId`.
  final String id;
  final List<CleanupAssetDto> assets;

  /// Bursts: the sharpest frame. Duplicates: `suggestedKeepAssetIds`.
  final Set<String> suggested;

  /// Bursts only: the camera's burst id, or a series found by time and looks.
  final CleanupBurstSource? source;

  /// Duplicates only: each copy's full asset, as `GET /duplicates` returns it, so the details sheet needs no
  /// `GET /assets/{id}`.
  final Map<String, AssetResponseDto> full;

  factory LibraryCleanupSeries.fromBurst(CleanupBurstGroupDto group) => LibraryCleanupSeries(
    id: group.groupId,
    assets: group.assets,
    suggested: {group.suggestedKeepId},
    source: group.source_,
  );

  factory LibraryCleanupSeries.fromDuplicate(DuplicateResponseDto group) => LibraryCleanupSeries(
    id: group.duplicateId,
    assets: [for (final asset in group.assets) libraryCleanupAssetOf(asset)],
    suggested: group.suggestedKeepAssetIds.toSet(),
    full: {for (final asset in group.assets) asset.id: asset},
  );

  /// The frames from [ids] only (a burst coming back after an undo with its restored frames), or null when fewer than
  /// two are left: one photo is not a series. The suggestion stays if its frame is back, else the first frame takes it.
  LibraryCleanupSeries? onlyFrames(Set<String> ids) {
    final kept = [
      for (final asset in assets)
        if (ids.contains(asset.id)) asset,
    ];
    if (kept.length < 2) {
      return null;
    }
    final stillSuggested = suggested.where((id) => kept.any((asset) => asset.id == id)).toSet();
    return LibraryCleanupSeries(
      id: id,
      assets: kept,
      suggested: stillSuggested.isEmpty ? {kept.first.id} : stillSuggested,
      source: source,
      full: full,
    );
  }

  int get bytes => assets.fold(0, (sum, asset) => sum + asset.fileSize.round());
}

/// A duplicate copy as a cleanup photo, so the series card, the details sheet and the finish screen show both queues
/// the same way. Resolution and size come from the asset, or its EXIF where the asset has none.
CleanupAssetDto libraryCleanupAssetOf(AssetResponseDto asset) {
  final exif = asset.exifInfo.orElse(null);
  return CleanupAssetDto(
    id: asset.id,
    type: asset.type,
    originalFileName: asset.originalFileName,
    localDateTime: asset.localDateTime.toUtc().toIso8601String(),
    thumbhash: asset.thumbhash,
    width: asset.width ?? exif?.exifImageWidth.orElse(null),
    height: asset.height ?? exif?.exifImageHeight.orElse(null),
    duration: asset.duration?.toDouble(),
    fileSize: (exif?.fileSizeInByte.orElse(null) ?? 0).toDouble(),
    isFavorite: asset.isFavorite,
    inAlbum: false,
    city: exif?.city.orElse(null),
    kept: false,
  );
}

/// What the user decided for a whole series. Like every other mark it is pending until Done → Apply, except [skip],
/// which marks nothing.
///
/// A decision is the series' selection at the moment it was applied (specs/2026-10-29-mobile-library-cleanup-design.md,
/// "Queues: Bursts and Duplicates"): its frames by their marks, or the stack or dismissal the "instead" chip chose.
enum LibraryCleanupSeriesDecision {
  /// The primary button or a swipe right on the frames' marks: each frame kept or trashed by its mark.
  asSet,

  /// Bursts, applied while "Stack instead" is on: the frames become one stack, the suggested frame on top.
  stack,

  /// Duplicates, applied while "Not duplicates" is on: the group dismissed and nothing deleted.
  dismiss,

  /// Skip or a swipe left: the series moves on with nothing marked. Never saved, so it comes back next session.
  skip;

  /// True for a decision Apply sends.
  bool get pending => this != skip;

  static LibraryCleanupSeriesDecision? fromName(Object? name) =>
      LibraryCleanupSeriesDecision.values.where((decision) => decision.name == name).firstOrNull;
}

/// The chips under the filmstrip. Each changes the selection; none applies it.
enum LibraryCleanupSeriesPick {
  /// "★ Best only" (Bursts) / "Suggested only" (Duplicates): the suggested frames kept, the rest marked for trash.
  suggested,

  /// "Keep all": every frame kept.
  all,

  /// "Stack instead" (Bursts) / "Not duplicates" (Duplicates), a toggle: while it is on, applying stacks or dismisses.
  instead,
}

/// What applying a series' selection does, as its primary button and its swipe-right stamp say.
enum LibraryCleanupSeriesOutcomeKind {
  /// "Keep 1 · Trash 5".
  keepTrash,

  /// "Keep all 6".
  keepAll,

  /// Bursts: "Trash all 6".
  trashAll,

  /// Bursts with "Stack instead" on: "Stack 6".
  stack,

  /// Duplicates with "Not duplicates" on.
  dismiss,

  /// Duplicates with every copy marked for trash: refused, "Keep at least one copy".
  refused,
}

typedef LibraryCleanupSeriesOutcome = ({LibraryCleanupSeriesOutcomeKind kind, int keep, int trash});

/// The marks of a series session: each frame's mark where the user changed it (any other frame follows the
/// suggestion), the series whose "instead" chip is on, and the decision on each series, with an undo stack that steps
/// back one series decision at a time.
class LibraryCleanupSeriesBook {
  LibraryCleanupSeriesBook();

  /// Frame id → kept (true) or trashed (false), only where the user flipped it.
  final Map<String, bool> _frames = {};

  /// Series whose "Stack instead" / "Not duplicates" chip is on.
  final Set<String> _instead = {};

  /// Series id → its decision, in the order they were made.
  final Map<String, LibraryCleanupSeriesDecision> _decisions = {};

  /// Each step: the series it decided and what each was before (several for "Keep the suggestion for all"), with the
  /// frame marks and "instead" chips it reset.
  final List<_Step> _history = [];

  Map<String, LibraryCleanupSeriesDecision> get decisions => Map.unmodifiable(_decisions);
  Map<String, bool> get frames => Map.unmodifiable(_frames);
  Set<String> get instead => Set.unmodifiable(_instead);
  bool get isEmpty => !_decisions.values.any((decision) => decision.pending) && _frames.isEmpty && _instead.isEmpty;
  bool get canUndo => _history.isNotEmpty;

  /// A frame's mark: what the user set, else kept when the series suggests it.
  bool isKept(LibraryCleanupSeries series, String frameId) => _frames[frameId] ?? series.suggested.contains(frameId);

  /// Flips one frame between keep and trash. While the "instead" chip is on every frame shows kept, so the chip goes
  /// off and the frame flips from what was shown: the others stay kept. Not an undo step: undo steps back whole series.
  void flip(LibraryCleanupSeries series, String frameId) {
    if (_instead.remove(series.id)) {
      for (final asset in series.assets) {
        _frames[asset.id] = asset.id != frameId;
      }
      return;
    }
    _frames[frameId] = !isKept(series, frameId);
  }

  /// Sets one frame's mark (the details sheet), which also turns the "instead" chip off.
  void setFrame(LibraryCleanupSeries series, String frameId, {required bool keep}) {
    if (_instead.remove(series.id)) {
      for (final asset in series.assets) {
        _frames[asset.id] = true;
      }
    }
    _frames[frameId] = keep;
  }

  /// A chip: changes the selection of [series], never decides it.
  void pick(LibraryCleanupSeries series, LibraryCleanupSeriesPick pick) {
    switch (pick) {
      case LibraryCleanupSeriesPick.suggested || LibraryCleanupSeriesPick.all:
        _instead.remove(series.id);
        for (final asset in series.assets) {
          _frames[asset.id] = pick == LibraryCleanupSeriesPick.all || series.suggested.contains(asset.id);
        }
      case LibraryCleanupSeriesPick.instead:
        if (!_instead.remove(series.id)) {
          _instead.add(series.id);
        }
    }
  }

  /// Replaces a decision without an undo step: a decided series whose selection changed (the list, the finish
  /// screen's rescue) is applied as it now stands. Null takes the decision back.
  void redecide(String seriesId, LibraryCleanupSeriesDecision? decision) {
    if (decision == null) {
      _decisions.remove(seriesId);
    } else {
      _decisions[seriesId] = decision;
    }
  }

  /// Decides [series] as one undo step.
  void decide(String seriesId, LibraryCleanupSeriesDecision decision) => decideMany([seriesId], decision);

  /// A burst swiped up: "Stack instead" turned on and applied, as one undo step that also gives the chip back as it
  /// was. The frame marks stay, so Undo returns the selection the series had.
  void stack(String seriesId) {
    _history.add(
      _Step(
        decisions: [MapEntry(seriesId, _decisions[seriesId])],
        frames: [],
        instead: [MapEntry(seriesId, _instead.contains(seriesId))],
      ),
    );
    _instead.add(seriesId);
    _decisions[seriesId] = LibraryCleanupSeriesDecision.stack;
  }

  /// Decides every series in [ids] as one undo step. With [resetFrames] their frames go back to the suggestion and
  /// their "instead" chip off ("Keep the suggestion for all").
  void decideMany(
    Iterable<String> ids,
    LibraryCleanupSeriesDecision decision, {
    Map<String, List<String>> resetFrames = const {},
  }) {
    final list = ids.toList();
    if (list.isEmpty) {
      return;
    }
    _history.add(
      _Step(
        decisions: [for (final id in list) MapEntry(id, _decisions[id])],
        frames: [
          for (final frames in resetFrames.values)
            for (final frame in frames) MapEntry(frame, _frames[frame]),
        ],
        instead: [for (final id in resetFrames.keys) MapEntry(id, _instead.contains(id))],
      ),
    );
    for (final MapEntry(key: id, value: frames) in resetFrames.entries) {
      frames.forEach(_frames.remove);
      _instead.remove(id);
    }
    for (final id in list) {
      _decisions[id] = decision;
    }
  }

  /// Steps back one decision; with nothing to undo it does nothing. Returns the series it took back.
  List<String> undo() {
    if (_history.isEmpty) {
      return const [];
    }
    final step = _history.removeLast();
    for (final MapEntry(:key, :value) in step.decisions) {
      if (value == null) {
        _decisions.remove(key);
      } else {
        _decisions[key] = value;
      }
    }
    for (final MapEntry(:key, :value) in step.frames) {
      if (value == null) {
        _frames.remove(key);
      } else {
        _frames[key] = value;
      }
    }
    for (final MapEntry(:key, :value) in step.instead) {
      if (value) {
        _instead.add(key);
      } else {
        _instead.remove(key);
      }
    }
    return [for (final entry in step.decisions) entry.key];
  }

  void clear() {
    _frames.clear();
    _instead.clear();
    _decisions.clear();
    _history.clear();
  }

  /// Drops the applied series and their frames. Undo steps may point at them, so the history goes too.
  void settle(Iterable<LibraryCleanupSeries> applied) {
    for (final series in applied) {
      _decisions.remove(series.id);
      _instead.remove(series.id);
      for (final asset in series.assets) {
        _frames.remove(asset.id);
      }
    }
    _history.clear();
  }

  /// Keeps only the marks of series [present] holds and frames [frame] accepts.
  void retainWhere({required bool Function(String seriesId) present, required bool Function(String frameId) frame}) {
    _decisions.removeWhere((id, _) => !present(id));
    _instead.removeWhere((id) => !present(id));
    _frames.removeWhere((id, _) => !frame(id));
    for (final step in _history) {
      step.decisions.removeWhere((entry) => !present(entry.key));
      step.frames.removeWhere((entry) => !frame(entry.key));
      step.instead.removeWhere((entry) => !present(entry.key));
    }
    _history.removeWhere((step) => step.decisions.isEmpty);
  }

  /// A skip is not saved: a skipped series comes back next session. A step that only skipped goes with it, and a step
  /// that took back a skip takes it back to undecided.
  Map<String, Object?> toJson() {
    String? saved(LibraryCleanupSeriesDecision? decision) => decision?.pending == true ? decision!.name : null;
    return {
      'frames': _frames,
      'instead': _instead.toList(),
      'decisions': {
        for (final entry in _decisions.entries)
          if (entry.value.pending) entry.key: entry.value.name,
      },
      'history': [
        for (final step in _history)
          if (step.decisions.any((entry) => _decisions[entry.key]?.pending == true || entry.value?.pending == true))
            {
              'decisions': [
                for (final entry in step.decisions) [entry.key, saved(entry.value)],
              ],
              'frames': [
                for (final entry in step.frames) [entry.key, entry.value],
              ],
              'instead': [
                for (final entry in step.instead) [entry.key, entry.value],
              ],
            },
      ],
    };
  }

  /// Reads what [toJson] wrote. A malformed entry is skipped rather than failing the whole restore.
  static LibraryCleanupSeriesBook fromJson(Object? json) {
    final book = LibraryCleanupSeriesBook();
    if (json is! Map) {
      return book;
    }
    final frames = json['frames'];
    if (frames is Map) {
      for (final entry in frames.entries) {
        if (entry.key is String && entry.value is bool) {
          book._frames[entry.key as String] = entry.value as bool;
        }
      }
    }
    final instead = json['instead'];
    if (instead is List) {
      book._instead.addAll(instead.whereType<String>());
    }
    final decisions = json['decisions'];
    if (decisions is Map) {
      for (final entry in decisions.entries) {
        final decision = LibraryCleanupSeriesDecision.fromName(entry.value);
        if (entry.key is String && decision != null && decision.pending) {
          book._decisions[entry.key as String] = decision;
        }
      }
    }
    final history = json['history'];
    if (history is List) {
      for (final raw in history) {
        if (raw is! Map) {
          continue;
        }
        final step = _Step(
          decisions: [
            for (final entry in (raw['decisions'] as List?) ?? const [])
              if (entry is List && entry.length == 2 && entry[0] is String)
                MapEntry(entry[0] as String, LibraryCleanupSeriesDecision.fromName(entry[1])),
          ],
          frames: [
            for (final entry in (raw['frames'] as List?) ?? const [])
              if (entry is List && entry.length == 2 && entry[0] is String)
                MapEntry(entry[0] as String, entry[1] is bool ? entry[1] as bool : null),
          ],
          instead: [
            for (final entry in (raw['instead'] as List?) ?? const [])
              if (entry is List && entry.length == 2 && entry[0] is String && entry[1] is bool)
                MapEntry(entry[0] as String, entry[1] as bool),
          ],
        );
        if (step.decisions.isNotEmpty) {
          book._history.add(step);
        }
      }
    }
    return book;
  }
}

class _Step {
  _Step({required this.decisions, required this.frames, required this.instead});

  final List<MapEntry<String, LibraryCleanupSeriesDecision?>> decisions;
  final List<MapEntry<String, bool?>> frames;
  final List<MapEntry<String, bool>> instead;
}
