//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

class UserGroupResponseDto {
  /// Returns a new [UserGroupResponseDto] instance.
  UserGroupResponseDto({
    this.color,
    required this.createdAt,
    required this.id,
    this.members = const [],
    required this.name,
    required this.origin,
  });

  /// Group color
  UserAvatarColor? color;

  /// Creation date
  String createdAt;

  /// Group ID
  String id;

  /// Members
  List<UserGroupMemberResponseDto> members;

  /// Group name
  String name;

  /// Group origin (manual or oidc)
  String origin;

  @override
  bool operator ==(Object other) => identical(this, other) || other is UserGroupResponseDto &&
    other.color == color &&
    other.createdAt == createdAt &&
    other.id == id &&
    _deepEquality.equals(other.members, members) &&
    other.name == name &&
    other.origin == origin;

  @override
  int get hashCode =>
    // ignore: unnecessary_parenthesis
    (color == null ? 0 : color!.hashCode) +
    (createdAt.hashCode) +
    (id.hashCode) +
    (members.hashCode) +
    (name.hashCode) +
    (origin.hashCode);

  @override
  String toString() => 'UserGroupResponseDto[color=$color, createdAt=$createdAt, id=$id, members=$members, name=$name, origin=$origin]';

  Map<String, dynamic> toJson() {
    final json = <String, dynamic>{};
    if (this.color != null) {
      json[r'color'] = this.color;
    } else {
    //  json[r'color'] = null;
    }
      json[r'createdAt'] = this.createdAt;
      json[r'id'] = this.id;
      json[r'members'] = this.members;
      json[r'name'] = this.name;
      json[r'origin'] = this.origin;
    return json;
  }

  /// Returns a new [UserGroupResponseDto] instance and imports its values from
  /// [value] if it's a [Map], null otherwise.
  // ignore: prefer_constructors_over_static_methods
  static UserGroupResponseDto? fromJson(dynamic value) {
    upgradeDto(value, "UserGroupResponseDto");
    if (value is Map) {
      final json = value.cast<String, dynamic>();

      return UserGroupResponseDto(
        color: UserAvatarColor.fromJson(json[r'color']),
        createdAt: mapValueOfType<String>(json, r'createdAt')!,
        id: mapValueOfType<String>(json, r'id')!,
        members: UserGroupMemberResponseDto.listFromJson(json[r'members']),
        name: mapValueOfType<String>(json, r'name')!,
        origin: mapValueOfType<String>(json, r'origin')!,
      );
    }
    return null;
  }

  static List<UserGroupResponseDto> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <UserGroupResponseDto>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = UserGroupResponseDto.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }

  static Map<String, UserGroupResponseDto> mapFromJson(dynamic json) {
    final map = <String, UserGroupResponseDto>{};
    if (json is Map && json.isNotEmpty) {
      json = json.cast<String, dynamic>(); // ignore: parameter_assignments
      for (final entry in json.entries) {
        final value = UserGroupResponseDto.fromJson(entry.value);
        if (value != null) {
          map[entry.key] = value;
        }
      }
    }
    return map;
  }

  // maps a json object with a list of UserGroupResponseDto-objects as value to a dart map
  static Map<String, List<UserGroupResponseDto>> mapListFromJson(dynamic json, {bool growable = false,}) {
    final map = <String, List<UserGroupResponseDto>>{};
    if (json is Map && json.isNotEmpty) {
      // ignore: parameter_assignments
      json = json.cast<String, dynamic>();
      for (final entry in json.entries) {
        map[entry.key] = UserGroupResponseDto.listFromJson(entry.value, growable: growable,);
      }
    }
    return map;
  }

  /// The list of required keys that must be present in a JSON.
  static const requiredKeys = <String>{
    'createdAt',
    'id',
    'members',
    'name',
    'origin',
  };
}

