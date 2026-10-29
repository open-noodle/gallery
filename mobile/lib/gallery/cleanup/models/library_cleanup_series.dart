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

/// What the user decided for a whole series. Like every other mark, it is pending until Done → Apply.
enum LibraryCleanupSeriesDecision {
  /// Swipe right, "Keep as set": each frame kept or trashed by its mark.
  asSet,

  /// Bursts, swipe left: every frame to the trash.
  trashAll,

  /// Bursts, swipe up: every frame kept.
  keepAll,

  /// Bursts, "Stack instead": the frames become one stack, the suggested frame on top.
  stack,

  /// Duplicates, swipe up: "not duplicates", the group dismissed and nothing deleted.
  dismiss;

  static LibraryCleanupSeriesDecision? fromName(Object? name) =>
      LibraryCleanupSeriesDecision.values.where((decision) => decision.name == name).firstOrNull;
}

/// The marks of a series session: each frame's mark where the user changed it (any other frame follows the
/// suggestion), and the decision on each series, with an undo stack that steps back one series at a time.
class LibraryCleanupSeriesBook {
  LibraryCleanupSeriesBook();

  /// Frame id → kept (true) or trashed (false), only where the user flipped it.
  final Map<String, bool> _frames = {};

  /// Series id → its decision, in the order they were made.
  final Map<String, LibraryCleanupSeriesDecision> _decisions = {};

  /// Each step: the series it decided and what each was before (several for "Keep the suggestion for all"), with the
  /// frame marks it reset.
  final List<_Step> _history = [];

  Map<String, LibraryCleanupSeriesDecision> get decisions => Map.unmodifiable(_decisions);
  Map<String, bool> get frames => Map.unmodifiable(_frames);
  bool get isEmpty => _decisions.isEmpty && _frames.isEmpty;
  bool get canUndo => _history.isNotEmpty;

  /// A frame's mark: what the user set, else kept when the series suggests it.
  bool isKept(LibraryCleanupSeries series, String frameId) => _frames[frameId] ?? series.suggested.contains(frameId);

  List<String> keptIds(LibraryCleanupSeries series) => [
    for (final asset in series.assets)
      if (isKept(series, asset.id)) asset.id,
  ];

  List<String> trashedIds(LibraryCleanupSeries series) => [
    for (final asset in series.assets)
      if (!isKept(series, asset.id)) asset.id,
  ];

  /// Flips one frame between keep and trash. Not an undo step: undo steps back whole series.
  void flip(LibraryCleanupSeries series, String frameId) => setFrame(frameId, keep: !isKept(series, frameId));

  void setFrame(String frameId, {required bool keep}) => _frames[frameId] = keep;

  /// Decides [series] as one undo step.
  void decide(String seriesId, LibraryCleanupSeriesDecision decision) => decideMany([seriesId], decision);

  /// Decides every series in [ids] as one undo step. With [resetFrames] their frames go back to the suggestion
  /// ("Keep the suggestion for all").
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
      ),
    );
    for (final frames in resetFrames.values) {
      frames.forEach(_frames.remove);
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
    return [for (final entry in step.decisions) entry.key];
  }

  void clear() {
    _frames.clear();
    _decisions.clear();
    _history.clear();
  }

  /// Drops the applied series and their frames. Undo steps may point at them, so the history goes too.
  void settle(Iterable<LibraryCleanupSeries> applied) {
    for (final series in applied) {
      _decisions.remove(series.id);
      for (final asset in series.assets) {
        _frames.remove(asset.id);
      }
    }
    _history.clear();
  }

  /// Keeps only the marks of series [present] holds and frames [frame] accepts.
  void retainWhere({required bool Function(String seriesId) present, required bool Function(String frameId) frame}) {
    _decisions.removeWhere((id, _) => !present(id));
    _frames.removeWhere((id, _) => !frame(id));
    for (final step in _history) {
      step.decisions.removeWhere((entry) => !present(entry.key));
      step.frames.removeWhere((entry) => !frame(entry.key));
    }
    _history.removeWhere((step) => step.decisions.isEmpty);
  }

  Map<String, Object?> toJson() => {
    'frames': _frames,
    'decisions': {for (final entry in _decisions.entries) entry.key: entry.value.name},
    'history': [
      for (final step in _history)
        {
          'decisions': [
            for (final entry in step.decisions) [entry.key, entry.value?.name],
          ],
          'frames': [
            for (final entry in step.frames) [entry.key, entry.value],
          ],
        },
    ],
  };

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
    final decisions = json['decisions'];
    if (decisions is Map) {
      for (final entry in decisions.entries) {
        final decision = LibraryCleanupSeriesDecision.fromName(entry.value);
        if (entry.key is String && decision != null) {
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
  _Step({required this.decisions, required this.frames});

  final List<MapEntry<String, LibraryCleanupSeriesDecision?>> decisions;
  final List<MapEntry<String, bool?>> frames;
}
