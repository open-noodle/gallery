//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

class SyncSharedSpaceMemberV1 {
  /// Returns a new [SyncSharedSpaceMemberV1] instance.
  SyncSharedSpaceMemberV1({
    required this.joinedAt,
    required this.role,
    required this.showInTimeline,
    required this.spaceId,
    required this.userId,
  });

  /// When the user joined the space
  DateTime joinedAt;

  /// Member role
  String role;

  /// Whether the space contributes to the user timeline
  bool showInTimeline;

  /// Shared space ID
  String spaceId;

  /// User ID
  String userId;

  @override
  bool operator ==(Object other) => identical(this, other) || other is SyncSharedSpaceMemberV1 &&
    other.joinedAt == joinedAt &&
    other.role == role &&
    other.showInTimeline == showInTimeline &&
    other.spaceId == spaceId &&
    other.userId == userId;

  @override
  int get hashCode =>
    // ignore: unnecessary_parenthesis
    (joinedAt.hashCode) +
    (role.hashCode) +
    (showInTimeline.hashCode) +
    (spaceId.hashCode) +
    (userId.hashCode);

  @override
  String toString() => 'SyncSharedSpaceMemberV1[joinedAt=$joinedAt, role=$role, showInTimeline=$showInTimeline, spaceId=$spaceId, userId=$userId]';

  Map<String, dynamic> toJson() {
    final json = <String, dynamic>{};
      json[r'joinedAt'] = this.joinedAt.toUtc().toIso8601String();
      json[r'role'] = this.role;
      json[r'showInTimeline'] = this.showInTimeline;
      json[r'spaceId'] = this.spaceId;
      json[r'userId'] = this.userId;
    return json;
  }

  /// Returns a new [SyncSharedSpaceMemberV1] instance and imports its values from
  /// [value] if it's a [Map], null otherwise.
  // ignore: prefer_constructors_over_static_methods
  static SyncSharedSpaceMemberV1? fromJson(dynamic value) {
    upgradeDto(value, "SyncSharedSpaceMemberV1");
    if (value is Map) {
      final json = value.cast<String, dynamic>();

      return SyncSharedSpaceMemberV1(
        joinedAt: mapDateTime(json, r'joinedAt', r'')!,
        role: mapValueOfType<String>(json, r'role')!,
        showInTimeline: mapValueOfType<bool>(json, r'showInTimeline')!,
        spaceId: mapValueOfType<String>(json, r'spaceId')!,
        userId: mapValueOfType<String>(json, r'userId')!,
      );
    }
    return null;
  }

  static List<SyncSharedSpaceMemberV1> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <SyncSharedSpaceMemberV1>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = SyncSharedSpaceMemberV1.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }

  static Map<String, SyncSharedSpaceMemberV1> mapFromJson(dynamic json) {
    final map = <String, SyncSharedSpaceMemberV1>{};
    if (json is Map && json.isNotEmpty) {
      json = json.cast<String, dynamic>(); // ignore: parameter_assignments
      for (final entry in json.entries) {
        final value = SyncSharedSpaceMemberV1.fromJson(entry.value);
        if (value != null) {
          map[entry.key] = value;
        }
      }
    }
    return map;
  }

  // maps a json object with a list of SyncSharedSpaceMemberV1-objects as value to a dart map
  static Map<String, List<SyncSharedSpaceMemberV1>> mapListFromJson(dynamic json, {bool growable = false,}) {
    final map = <String, List<SyncSharedSpaceMemberV1>>{};
    if (json is Map && json.isNotEmpty) {
      // ignore: parameter_assignments
      json = json.cast<String, dynamic>();
      for (final entry in json.entries) {
        map[entry.key] = SyncSharedSpaceMemberV1.listFromJson(entry.value, growable: growable,);
      }
    }
    return map;
  }

  /// The list of required keys that must be present in a JSON.
  static const requiredKeys = <String>{
    'joinedAt',
    'role',
    'showInTimeline',
    'spaceId',
    'userId',
  };
}

