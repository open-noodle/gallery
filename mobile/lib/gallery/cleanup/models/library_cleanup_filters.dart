import 'package:immich_mobile/gallery/cleanup/models/library_cleanup_queue.dart';
import 'package:openapi/api.dart';

/// The per-queue filters, with the web's defaults (`SelectQueue.svelte`, `SpaceHogsQueue.svelte`). The web sends the
/// filters a queue has on every page request, defaults included: Blurry's strictness, reason and hide-faces, Space
/// hogs' type and minimum size. Screenshots and Bursts have none, so nothing is sent for them.
class LibraryCleanupFilters {
  final LibraryCleanupQueue queue;

  /// Blurry only.
  final CleanupStrictness strictness;
  final CleanupBlurReason reason;
  final bool hideFaces;

  /// Space hogs only.
  final CleanupAssetTypeFilter type;
  final int minSize;

  const LibraryCleanupFilters._(this.queue, this.strictness, this.reason, this.hideFaces, this.type, this.minSize);

  /// The queue's filters at their defaults.
  factory LibraryCleanupFilters.defaults(LibraryCleanupQueue queue) => LibraryCleanupFilters._(
    queue,
    CleanupStrictness.balanced,
    CleanupBlurReason.all,
    true,
    // The web's Space hogs opens on videos.
    CleanupAssetTypeFilter.video,
    libraryCleanupSpaceHogDefaultMinSize,
  );

  LibraryCleanupFilters copyWith({
    CleanupStrictness? strictness,
    CleanupBlurReason? reason,
    bool? hideFaces,
    CleanupAssetTypeFilter? type,
    int? minSize,
  }) => LibraryCleanupFilters._(
    queue,
    strictness ?? this.strictness,
    reason ?? this.reason,
    hideFaces ?? this.hideFaces,
    type ?? this.type,
    minSize ?? this.minSize,
  );

  bool get isBlurry => queue == LibraryCleanupQueue.blurry;
  bool get isSpaceHogs => queue == LibraryCleanupQueue.spaceHogs;

  Map<String, Object?> toJson() => {
    if (isBlurry) ...{'strictness': strictness.toJson(), 'reason': reason.toJson(), 'hideFaces': hideFaces},
    if (isSpaceHogs) ...{'type': type.toJson(), 'minSize': minSize},
  };

  /// Reads what [toJson] wrote; a missing or malformed field is its default.
  static LibraryCleanupFilters fromJson(LibraryCleanupQueue queue, Object? json) {
    final defaults = LibraryCleanupFilters.defaults(queue);
    if (json is! Map) {
      return defaults;
    }
    final minSize = json['minSize'];
    final hideFaces = json['hideFaces'];
    return defaults.copyWith(
      strictness: _decode(CleanupStrictness.fromJson, json['strictness']),
      reason: _decode(CleanupBlurReason.fromJson, json['reason']),
      hideFaces: hideFaces is bool ? hideFaces : null,
      type: _decode(CleanupAssetTypeFilter.fromJson, json['type']),
      minSize: minSize is int && minSize >= 0 ? minSize : null,
    );
  }

  static T? _decode<T>(T? Function(dynamic) decode, Object? value) {
    try {
      return value is String ? decode(value) : null;
    } catch (_) {
      return null;
    }
  }

  @override
  bool operator ==(Object other) =>
      other is LibraryCleanupFilters &&
      other.queue == queue &&
      other.strictness == strictness &&
      other.reason == reason &&
      other.hideFaces == hideFaces &&
      other.type == type &&
      other.minSize == minSize;

  @override
  int get hashCode => Object.hash(queue, strictness, reason, hideFaces, type, minSize);
}
