//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

class AgentSpaceMemberSummary {
  /// Returns a new [AgentSpaceMemberSummary] instance.
  AgentSpaceMemberSummary({
    required this.avatarColor,
    required this.name,
    required this.profileImagePath,
    required this.role,
    required this.userId,
  });

  String? avatarColor;

  String name;

  String? profileImagePath;

  String role;

  String userId;

  @override
  bool operator ==(Object other) => identical(this, other) || other is AgentSpaceMemberSummary &&
    other.avatarColor == avatarColor &&
    other.name == name &&
    other.profileImagePath == profileImagePath &&
    other.role == role &&
    other.userId == userId;

  @override
  int get hashCode =>
    // ignore: unnecessary_parenthesis
    (avatarColor == null ? 0 : avatarColor!.hashCode) +
    (name.hashCode) +
    (profileImagePath == null ? 0 : profileImagePath!.hashCode) +
    (role.hashCode) +
    (userId.hashCode);

  @override
  String toString() => 'AgentSpaceMemberSummary[avatarColor=$avatarColor, name=$name, profileImagePath=$profileImagePath, role=$role, userId=$userId]';

  Map<String, dynamic> toJson() {
    final json = <String, dynamic>{};
    if (this.avatarColor != null) {
      json[r'avatarColor'] = this.avatarColor;
    } else {
    //  json[r'avatarColor'] = null;
    }
      json[r'name'] = this.name;
    if (this.profileImagePath != null) {
      json[r'profileImagePath'] = this.profileImagePath;
    } else {
    //  json[r'profileImagePath'] = null;
    }
      json[r'role'] = this.role;
      json[r'userId'] = this.userId;
    return json;
  }

  /// Returns a new [AgentSpaceMemberSummary] instance and imports its values from
  /// [value] if it's a [Map], null otherwise.
  // ignore: prefer_constructors_over_static_methods
  static AgentSpaceMemberSummary? fromJson(dynamic value) {
    upgradeDto(value, "AgentSpaceMemberSummary");
    if (value is Map) {
      final json = value.cast<String, dynamic>();

      return AgentSpaceMemberSummary(
        avatarColor: mapValueOfType<String>(json, r'avatarColor'),
        name: mapValueOfType<String>(json, r'name')!,
        profileImagePath: mapValueOfType<String>(json, r'profileImagePath'),
        role: mapValueOfType<String>(json, r'role')!,
        userId: mapValueOfType<String>(json, r'userId')!,
      );
    }
    return null;
  }

  static List<AgentSpaceMemberSummary> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <AgentSpaceMemberSummary>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = AgentSpaceMemberSummary.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }

  static Map<String, AgentSpaceMemberSummary> mapFromJson(dynamic json) {
    final map = <String, AgentSpaceMemberSummary>{};
    if (json is Map && json.isNotEmpty) {
      json = json.cast<String, dynamic>(); // ignore: parameter_assignments
      for (final entry in json.entries) {
        final value = AgentSpaceMemberSummary.fromJson(entry.value);
        if (value != null) {
          map[entry.key] = value;
        }
      }
    }
    return map;
  }

  // maps a json object with a list of AgentSpaceMemberSummary-objects as value to a dart map
  static Map<String, List<AgentSpaceMemberSummary>> mapListFromJson(dynamic json, {bool growable = false,}) {
    final map = <String, List<AgentSpaceMemberSummary>>{};
    if (json is Map && json.isNotEmpty) {
      // ignore: parameter_assignments
      json = json.cast<String, dynamic>();
      for (final entry in json.entries) {
        map[entry.key] = AgentSpaceMemberSummary.listFromJson(entry.value, growable: growable,);
      }
    }
    return map;
  }

  /// The list of required keys that must be present in a JSON.
  static const requiredKeys = <String>{
    'avatarColor',
    'name',
    'profileImagePath',
    'role',
    'userId',
  };
}

