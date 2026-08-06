//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

class AgentSearchUsersToolResponseDto {
  /// Returns a new [AgentSearchUsersToolResponseDto] instance.
  AgentSearchUsersToolResponseDto({
    required this.status,
    required this.toolCall,
    required this.reason,
    required this.resultSize,
    this.users = const [],
  });

  AgentSearchUsersToolResponseDtoStatusEnum status;

  AgentToolCallResponseDto toolCall;

  String reason;

  AgentToolResultSize resultSize;

  List<AgentUserLookupResult> users;

  @override
  bool operator ==(Object other) => identical(this, other) || other is AgentSearchUsersToolResponseDto &&
    other.status == status &&
    other.toolCall == toolCall &&
    other.reason == reason &&
    other.resultSize == resultSize &&
    _deepEquality.equals(other.users, users);

  @override
  int get hashCode =>
    // ignore: unnecessary_parenthesis
    (status.hashCode) +
    (toolCall.hashCode) +
    (reason.hashCode) +
    (resultSize.hashCode) +
    (users.hashCode);

  @override
  String toString() => 'AgentSearchUsersToolResponseDto[status=$status, toolCall=$toolCall, reason=$reason, resultSize=$resultSize, users=$users]';

  Map<String, dynamic> toJson() {
    final json = <String, dynamic>{};
      json[r'status'] = this.status;
      json[r'toolCall'] = this.toolCall;
      json[r'reason'] = this.reason;
      json[r'resultSize'] = this.resultSize;
      json[r'users'] = this.users;
    return json;
  }

  /// Returns a new [AgentSearchUsersToolResponseDto] instance and imports its values from
  /// [value] if it's a [Map], null otherwise.
  // ignore: prefer_constructors_over_static_methods
  static AgentSearchUsersToolResponseDto? fromJson(dynamic value) {
    upgradeDto(value, "AgentSearchUsersToolResponseDto");
    if (value is Map) {
      final json = value.cast<String, dynamic>();

      return AgentSearchUsersToolResponseDto(
        status: AgentSearchUsersToolResponseDtoStatusEnum.fromJson(json[r'status'])!,
        toolCall: AgentToolCallResponseDto.fromJson(json[r'toolCall'])!,
        reason: mapValueOfType<String>(json, r'reason')!,
        resultSize: AgentToolResultSize.fromJson(json[r'resultSize'])!,
        users: AgentUserLookupResult.listFromJson(json[r'users']),
      );
    }
    return null;
  }

  static List<AgentSearchUsersToolResponseDto> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <AgentSearchUsersToolResponseDto>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = AgentSearchUsersToolResponseDto.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }

  static Map<String, AgentSearchUsersToolResponseDto> mapFromJson(dynamic json) {
    final map = <String, AgentSearchUsersToolResponseDto>{};
    if (json is Map && json.isNotEmpty) {
      json = json.cast<String, dynamic>(); // ignore: parameter_assignments
      for (final entry in json.entries) {
        final value = AgentSearchUsersToolResponseDto.fromJson(entry.value);
        if (value != null) {
          map[entry.key] = value;
        }
      }
    }
    return map;
  }

  // maps a json object with a list of AgentSearchUsersToolResponseDto-objects as value to a dart map
  static Map<String, List<AgentSearchUsersToolResponseDto>> mapListFromJson(dynamic json, {bool growable = false,}) {
    final map = <String, List<AgentSearchUsersToolResponseDto>>{};
    if (json is Map && json.isNotEmpty) {
      // ignore: parameter_assignments
      json = json.cast<String, dynamic>();
      for (final entry in json.entries) {
        map[entry.key] = AgentSearchUsersToolResponseDto.listFromJson(entry.value, growable: growable,);
      }
    }
    return map;
  }

  /// The list of required keys that must be present in a JSON.
  static const requiredKeys = <String>{
    'status',
    'toolCall',
    'reason',
    'resultSize',
    'users',
  };
}


class AgentSearchUsersToolResponseDtoStatusEnum {
  /// Instantiate a new enum with the provided [value].
  const AgentSearchUsersToolResponseDtoStatusEnum._(this.value);

  /// The underlying value of this enum member.
  final String value;

  @override
  String toString() => value;

  String toJson() => value;

  static const success = AgentSearchUsersToolResponseDtoStatusEnum._(r'success');

  /// List of all possible values in this [enum][AgentSearchUsersToolResponseDtoStatusEnum].
  static const values = <AgentSearchUsersToolResponseDtoStatusEnum>[
    success,
  ];

  static AgentSearchUsersToolResponseDtoStatusEnum? fromJson(dynamic value) => AgentSearchUsersToolResponseDtoStatusEnumTypeTransformer().decode(value);

  static List<AgentSearchUsersToolResponseDtoStatusEnum> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <AgentSearchUsersToolResponseDtoStatusEnum>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = AgentSearchUsersToolResponseDtoStatusEnum.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }
}

/// Transformation class that can [encode] an instance of [AgentSearchUsersToolResponseDtoStatusEnum] to String,
/// and [decode] dynamic data back to [AgentSearchUsersToolResponseDtoStatusEnum].
class AgentSearchUsersToolResponseDtoStatusEnumTypeTransformer {
  factory AgentSearchUsersToolResponseDtoStatusEnumTypeTransformer() => _instance ??= const AgentSearchUsersToolResponseDtoStatusEnumTypeTransformer._();

  const AgentSearchUsersToolResponseDtoStatusEnumTypeTransformer._();

  String encode(AgentSearchUsersToolResponseDtoStatusEnum data) => data.value;

  /// Decodes a [dynamic value][data] to a AgentSearchUsersToolResponseDtoStatusEnum.
  ///
  /// If [allowNull] is true and the [dynamic value][data] cannot be decoded successfully,
  /// then null is returned. However, if [allowNull] is false and the [dynamic value][data]
  /// cannot be decoded successfully, then an [UnimplementedError] is thrown.
  ///
  /// The [allowNull] is very handy when an API changes and a new enum value is added or removed,
  /// and users are still using an old app with the old code.
  AgentSearchUsersToolResponseDtoStatusEnum? decode(dynamic data, {bool allowNull = true}) {
    if (data != null) {
      switch (data) {
        case r'success': return AgentSearchUsersToolResponseDtoStatusEnum.success;
        default:
          if (!allowNull) {
            throw ArgumentError('Unknown enum value to decode: $data');
          }
      }
    }
    return null;
  }

  /// Singleton [AgentSearchUsersToolResponseDtoStatusEnumTypeTransformer] instance.
  static AgentSearchUsersToolResponseDtoStatusEnumTypeTransformer? _instance;
}


