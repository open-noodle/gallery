//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

class SharedSpaceMemberResponseDto {
  /// Returns a new [SharedSpaceMemberResponseDto] instance.
  SharedSpaceMemberResponseDto({
    required this.email,
    required this.joinedAt,
    required this.name,
    this.profileImagePath,
    required this.role,
    required this.userId,
  });

  /// User email
  String email;

  /// Join date
  String joinedAt;

  /// User name
  String name;

  /// Profile image path
  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  String? profileImagePath;

  /// Member role
  SharedSpaceMemberResponseDtoRoleEnum role;

  /// User ID
  String userId;

  @override
  bool operator ==(Object other) => identical(this, other) || other is SharedSpaceMemberResponseDto &&
    other.email == email &&
    other.joinedAt == joinedAt &&
    other.name == name &&
    other.profileImagePath == profileImagePath &&
    other.role == role &&
    other.userId == userId;

  @override
  int get hashCode =>
    // ignore: unnecessary_parenthesis
    (email.hashCode) +
    (joinedAt.hashCode) +
    (name.hashCode) +
    (profileImagePath == null ? 0 : profileImagePath!.hashCode) +
    (role.hashCode) +
    (userId.hashCode);

  @override
  String toString() => 'SharedSpaceMemberResponseDto[email=$email, joinedAt=$joinedAt, name=$name, profileImagePath=$profileImagePath, role=$role, userId=$userId]';

  Map<String, dynamic> toJson() {
    final json = <String, dynamic>{};
      json[r'email'] = this.email;
      json[r'joinedAt'] = this.joinedAt;
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

  /// Returns a new [SharedSpaceMemberResponseDto] instance and imports its values from
  /// [value] if it's a [Map], null otherwise.
  // ignore: prefer_constructors_over_static_methods
  static SharedSpaceMemberResponseDto? fromJson(dynamic value) {
    upgradeDto(value, "SharedSpaceMemberResponseDto");
    if (value is Map) {
      final json = value.cast<String, dynamic>();

      return SharedSpaceMemberResponseDto(
        email: mapValueOfType<String>(json, r'email')!,
        joinedAt: mapValueOfType<String>(json, r'joinedAt')!,
        name: mapValueOfType<String>(json, r'name')!,
        profileImagePath: mapValueOfType<String>(json, r'profileImagePath'),
        role: SharedSpaceMemberResponseDtoRoleEnum.fromJson(json[r'role'])!,
        userId: mapValueOfType<String>(json, r'userId')!,
      );
    }
    return null;
  }

  static List<SharedSpaceMemberResponseDto> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <SharedSpaceMemberResponseDto>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = SharedSpaceMemberResponseDto.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }

  static Map<String, SharedSpaceMemberResponseDto> mapFromJson(dynamic json) {
    final map = <String, SharedSpaceMemberResponseDto>{};
    if (json is Map && json.isNotEmpty) {
      json = json.cast<String, dynamic>(); // ignore: parameter_assignments
      for (final entry in json.entries) {
        final value = SharedSpaceMemberResponseDto.fromJson(entry.value);
        if (value != null) {
          map[entry.key] = value;
        }
      }
    }
    return map;
  }

  // maps a json object with a list of SharedSpaceMemberResponseDto-objects as value to a dart map
  static Map<String, List<SharedSpaceMemberResponseDto>> mapListFromJson(dynamic json, {bool growable = false,}) {
    final map = <String, List<SharedSpaceMemberResponseDto>>{};
    if (json is Map && json.isNotEmpty) {
      // ignore: parameter_assignments
      json = json.cast<String, dynamic>();
      for (final entry in json.entries) {
        map[entry.key] = SharedSpaceMemberResponseDto.listFromJson(entry.value, growable: growable,);
      }
    }
    return map;
  }

  /// The list of required keys that must be present in a JSON.
  static const requiredKeys = <String>{
    'email',
    'joinedAt',
    'name',
    'role',
    'userId',
  };
}

/// Member role
class SharedSpaceMemberResponseDtoRoleEnum {
  /// Instantiate a new enum with the provided [value].
  const SharedSpaceMemberResponseDtoRoleEnum._(this.value);

  /// The underlying value of this enum member.
  final String value;

  @override
  String toString() => value;

  String toJson() => value;

  static const owner = SharedSpaceMemberResponseDtoRoleEnum._(r'owner');
  static const editor = SharedSpaceMemberResponseDtoRoleEnum._(r'editor');
  static const viewer = SharedSpaceMemberResponseDtoRoleEnum._(r'viewer');

  /// List of all possible values in this [enum][SharedSpaceMemberResponseDtoRoleEnum].
  static const values = <SharedSpaceMemberResponseDtoRoleEnum>[
    owner,
    editor,
    viewer,
  ];

  static SharedSpaceMemberResponseDtoRoleEnum? fromJson(dynamic value) => SharedSpaceMemberResponseDtoRoleEnumTypeTransformer().decode(value);

  static List<SharedSpaceMemberResponseDtoRoleEnum> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <SharedSpaceMemberResponseDtoRoleEnum>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = SharedSpaceMemberResponseDtoRoleEnum.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }
}

/// Transformation class that can [encode] an instance of [SharedSpaceMemberResponseDtoRoleEnum] to String,
/// and [decode] dynamic data back to [SharedSpaceMemberResponseDtoRoleEnum].
class SharedSpaceMemberResponseDtoRoleEnumTypeTransformer {
  factory SharedSpaceMemberResponseDtoRoleEnumTypeTransformer() => _instance ??= const SharedSpaceMemberResponseDtoRoleEnumTypeTransformer._();

  const SharedSpaceMemberResponseDtoRoleEnumTypeTransformer._();

  String encode(SharedSpaceMemberResponseDtoRoleEnum data) => data.value;

  /// Decodes a [dynamic value][data] to a SharedSpaceMemberResponseDtoRoleEnum.
  ///
  /// If [allowNull] is true and the [dynamic value][data] cannot be decoded successfully,
  /// then null is returned. However, if [allowNull] is false and the [dynamic value][data]
  /// cannot be decoded successfully, then an [UnimplementedError] is thrown.
  ///
  /// The [allowNull] is very handy when an API changes and a new enum value is added or removed,
  /// and users are still using an old app with the old code.
  SharedSpaceMemberResponseDtoRoleEnum? decode(dynamic data, {bool allowNull = true}) {
    if (data != null) {
      switch (data) {
        case r'owner': return SharedSpaceMemberResponseDtoRoleEnum.owner;
        case r'editor': return SharedSpaceMemberResponseDtoRoleEnum.editor;
        case r'viewer': return SharedSpaceMemberResponseDtoRoleEnum.viewer;
        default:
          if (!allowNull) {
            throw ArgumentError('Unknown enum value to decode: $data');
          }
      }
    }
    return null;
  }

  /// Singleton [SharedSpaceMemberResponseDtoRoleEnumTypeTransformer] instance.
  static SharedSpaceMemberResponseDtoRoleEnumTypeTransformer? _instance;
}


