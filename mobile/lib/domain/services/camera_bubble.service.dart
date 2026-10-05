import 'dart:async';
import 'dart:convert';

import 'package:immich_mobile/domain/models/collection_target.dart';
import 'package:immich_mobile/domain/models/store.model.dart';
import 'package:immich_mobile/entities/store.entity.dart';
import 'package:immich_mobile/platform/camera_bubble_api.g.dart';
import 'package:logging/logging.dart';

/// What a photo is filed into.
///
/// No `spaceAlbum` case: an album linked into a space is an ordinary album, and assets go in
/// through the album either way. Filing to the space pool instead would pin them independently.
enum CameraBubbleTargetKind { space, album }

/// A destination, flattened for the platform channel, SharedPreferences and the session log.
class CameraBubbleTarget {
  const CameraBubbleTarget({required this.kind, required this.id, required this.name});

  final CameraBubbleTargetKind kind;
  final String id;
  final String name;

  /// JSON, not a delimiter: album names are user-typed, so any separator is a guess.
  String get encoded => jsonEncode([kind.name, id, name]);

  static CameraBubbleTarget? decode(String raw) {
    try {
      final parts = (jsonDecode(raw) as List).cast<String>();
      if (parts.length < 3) {
        return null;
      }
      final kind = CameraBubbleTargetKind.values.where((k) => k.name == parts[0]).firstOrNull;
      if (kind == null) {
        return null;
      }
      return CameraBubbleTarget(kind: kind, id: parts[1], name: parts[2]);
    } catch (_) {
      return null;
    }
  }

  factory CameraBubbleTarget.fromCollection(CollectionTarget target) => switch (target) {
    AlbumTarget(:final album) => CameraBubbleTarget(kind: CameraBubbleTargetKind.album, id: album.id, name: album.name),
    SpacePoolTarget(:final space) => CameraBubbleTarget(
      kind: CameraBubbleTargetKind.space,
      id: space.id,
      name: space.name,
    ),
    // Treated as a plain album, per the note on [CameraBubbleTargetKind].
    SpaceAlbumTarget(:final album) => CameraBubbleTarget(
      kind: CameraBubbleTargetKind.album,
      id: album.id,
      name: album.name,
    ),
  };

  @override
  bool operator ==(Object other) => other is CameraBubbleTarget && other.encoded == encoded;

  @override
  int get hashCode => encoded.hashCode;
}

/// One window during which a fixed set of destinations was selected.
///
/// Attribution is by capture time, not upload time: a photo can upload hours later, after the
/// selection changed or the bubble was switched off.
class CameraBubbleSession {
  final List<String> targetIds;
  final DateTime from;
  final DateTime? to;

  const CameraBubbleSession({required this.targetIds, required this.from, this.to});

  bool contains(DateTime at) => !at.isBefore(from) && (to == null || !at.isAfter(to!));

  Map<String, dynamic> toMap() => {
    'targetIds': targetIds,
    'from': from.millisecondsSinceEpoch,
    'to': to?.millisecondsSinceEpoch,
  };

  factory CameraBubbleSession.fromMap(Map<String, dynamic> map) => CameraBubbleSession(
    targetIds: (map['targetIds'] as List).cast<String>(),
    from: DateTime.fromMillisecondsSinceEpoch(map['from'] as int),
    to: map['to'] == null ? null : DateTime.fromMillisecondsSinceEpoch(map['to'] as int),
  );
}

/// The session log, as static functions over [Store].
///
/// Cache-free on purpose: two engines touch this (the app's and the picker's), so an in-memory
/// copy would go stale the moment the other wrote.
abstract final class CameraBubbleSessions {
  static final Logger _log = Logger('CameraBubbleSessions');

  /// Long enough for a phone offline over a weekend, short enough to stay bounded.
  static const Duration retention = Duration(days: 7);

  static List<String> currentSelectionEncoded() {
    final raw = Store.tryGet(StoreKey.cameraBubbleSelection);
    if (raw == null || raw.isEmpty) {
      return const [];
    }
    return (jsonDecode(raw) as List).cast<String>();
  }

  static List<CameraBubbleTarget> currentSelection() =>
      currentSelectionEncoded().map(CameraBubbleTarget.decode).nonNulls.toList();

  /// Close the open window and open the next in one read-modify-write, so no read can land
  /// between the two and leave a window open for good.
  static Future<void> replaceSelection(List<CameraBubbleTarget> targets) async {
    final encoded = targets.map((t) => t.encoded).toList();
    final now = DateTime.now();

    await _write([
      for (final s in _read()) s.to == null ? CameraBubbleSession(targetIds: s.targetIds, from: s.from, to: now) : s,
      if (encoded.isNotEmpty) CameraBubbleSession(targetIds: encoded, from: now),
    ]);
    await Store.put(StoreKey.cameraBubbleSelection, jsonEncode(encoded));
  }

  /// Newest-first: windows can overlap, and the most recent selection is the one meant.
  static List<CameraBubbleTarget> targetsForCaptureTime(DateTime capturedAt) {
    for (final session in _read().reversed) {
      if (session.contains(capturedAt)) {
        return session.targetIds.map(CameraBubbleTarget.decode).nonNulls.toList();
      }
    }
    return const [];
  }

  /// The overlay's view of a target. Colour from the name, so no thumbnail loading is needed.
  static OverlayTarget asOverlayTarget(CameraBubbleTarget target) =>
      OverlayTarget(id: target.encoded, name: target.name, colorHex: _paletteFor(target.name));

  static const _palette = ['#F4845F', '#3C7F9B', '#6B5BD6', '#2F9E63', '#C9184A', '#D98324'];

  static String _paletteFor(String name) => _palette[name.hashCode.abs() % _palette.length];

  static List<CameraBubbleSession> _read() {
    final raw = Store.tryGet(StoreKey.cameraBubbleSessions);
    if (raw == null || raw.isEmpty) {
      return [];
    }
    try {
      return (jsonDecode(raw) as List).map((e) => CameraBubbleSession.fromMap(e as Map<String, dynamic>)).toList();
    } catch (error) {
      _log.warning('Could not decode the session log, starting fresh: $error');
      return [];
    }
  }

  static Future<void> _write(List<CameraBubbleSession> sessions) async {
    final cutoff = DateTime.now().subtract(retention);
    final kept = sessions.where((s) => s.to == null || s.to!.isAfter(cutoff)).toList();
    await Store.put(StoreKey.cameraBubbleSessions, jsonEncode(kept.map((s) => s.toMap()).toList()));
  }
}

/// App-side half: the bridge to the overlay. Session state lives in [CameraBubbleSessions].
class CameraBubbleService {
  final CameraBubbleHostApi _host;

  CameraBubbleService({CameraBubbleHostApi? host}) : _host = host ?? CameraBubbleHostApi();

  Future<bool> get isOverlayPermissionGranted => _host.isOverlayPermissionGranted();
  Future<void> requestOverlayPermission() => _host.requestOverlayPermission();
  Future<bool> get isUsageAccessGranted => _host.isUsageAccessGranted();
  Future<void> requestUsageAccess() => _host.requestUsageAccess();

  /// Whether the bubble service is running; the settings switch shows this.
  Future<bool> get isRunning => _host.isRunning();

  Future<void> start({
    required List<OverlayTarget> targets,
    required String notificationTitle,
    required String notificationBody,
  }) async {
    await _host.start(targets, CameraBubbleSessions.currentSelectionEncoded(), notificationTitle, notificationBody);
  }

  Future<void> stop() async {
    await _host.stop();
    await CameraBubbleSessions.replaceSelection(const []);
  }
}
