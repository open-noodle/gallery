//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

class AgentUserLookupResult {
  /// Returns a new [AgentUserLookupResult] instance.
  AgentUserLookupResult({
    required this.avatarColor,
    required this.email,
    required this.name,
    required this.profileImagePath,
    required this.userId,
  });

  String? avatarColor;

  String? email;

  String name;

  String? profileImagePath;

  String userId;

  @override
  bool operator ==(Object other) => identical(this, other) || other is AgentUserLookupResult &&
    other.avatarColor == avatarColor &&
    other.email == email &&
    other.name == name &&
    other.profileImagePath == profileImagePath &&
    other.userId == userId;

  @override
  int get hashCode =>
    // ignore: unnecessary_parenthesis
    (avatarColor == null ? 0 : avatarColor!.hashCode) +
    (email == null ? 0 : email!.hashCode) +
    (name.hashCode) +
    (profileImagePath == null ? 0 : profileImagePath!.hashCode) +
    (userId.hashCode);

  @override
  String toString() => 'AgentUserLookupResult[avatarColor=$avatarColor, email=$email, name=$name, profileImagePath=$profileImagePath, userId=$userId]';

  Map<String, dynamic> toJson() {
    final json = <String, dynamic>{};
    if (this.avatarColor != null) {
      json[r'avatarColor'] = this.avatarColor;
    } else {
    //  json[r'avatarColor'] = null;
    }
    if (this.email != null) {
      json[r'email'] = this.email;
    } else {
    //  json[r'email'] = null;
    }
      json[r'name'] = this.name;
    if (this.profileImagePath != null) {
      json[r'profileImagePath'] = this.profileImagePath;
    } else {
    //  json[r'profileImagePath'] = null;
    }
      json[r'userId'] = this.userId;
    return json;
  }

  /// Returns a new [AgentUserLookupResult] instance and imports its values from
  /// [value] if it's a [Map], null otherwise.
  // ignore: prefer_constructors_over_static_methods
  static AgentUserLookupResult? fromJson(dynamic value) {
    upgradeDto(value, "AgentUserLookupResult");
    if (value is Map) {
      final json = value.cast<String, dynamic>();

      return AgentUserLookupResult(
        avatarColor: mapValueOfType<String>(json, r'avatarColor'),
        email: mapValueOfType<String>(json, r'email'),
        name: mapValueOfType<String>(json, r'name')!,
        profileImagePath: mapValueOfType<String>(json, r'profileImagePath'),
        userId: mapValueOfType<String>(json, r'userId')!,
      );
    }
    return null;
  }

  static List<AgentUserLookupResult> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <AgentUserLookupResult>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = AgentUserLookupResult.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }

  static Map<String, AgentUserLookupResult> mapFromJson(dynamic json) {
    final map = <String, AgentUserLookupResult>{};
    if (json is Map && json.isNotEmpty) {
      json = json.cast<String, dynamic>(); // ignore: parameter_assignments
      for (final entry in json.entries) {
        final value = AgentUserLookupResult.fromJson(entry.value);
        if (value != null) {
          map[entry.key] = value;
        }
      }
    }
    return map;
  }

  // maps a json object with a list of AgentUserLookupResult-objects as value to a dart map
  static Map<String, List<AgentUserLookupResult>> mapListFromJson(dynamic json, {bool growable = false,}) {
    final map = <String, List<AgentUserLookupResult>>{};
    if (json is Map && json.isNotEmpty) {
      // ignore: parameter_assignments
      json = json.cast<String, dynamic>();
      for (final entry in json.entries) {
        map[entry.key] = AgentUserLookupResult.listFromJson(entry.value, growable: growable,);
      }
    }
    return map;
  }

  /// The list of required keys that must be present in a JSON.
  static const requiredKeys = <String>{
    'avatarColor',
    'email',
    'name',
    'profileImagePath',
    'userId',
  };
}

