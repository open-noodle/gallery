//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

class AgentSearchPeopleToolResponseDto {
  /// Returns a new [AgentSearchPeopleToolResponseDto] instance.
  AgentSearchPeopleToolResponseDto({
    required this.status,
    required this.toolCall,
    required this.reason,
    required this.people,
    required this.resultSize,
  });

  AgentSearchPeopleToolResponseDtoStatusEnum status;

  AgentToolCallResponseDto toolCall;

  String reason;

  AgentSearchPeopleResult people;

  AgentToolResultSize resultSize;

  @override
  bool operator ==(Object other) => identical(this, other) || other is AgentSearchPeopleToolResponseDto &&
    other.status == status &&
    other.toolCall == toolCall &&
    other.reason == reason &&
    other.people == people &&
    other.resultSize == resultSize;

  @override
  int get hashCode =>
    // ignore: unnecessary_parenthesis
    (status.hashCode) +
    (toolCall.hashCode) +
    (reason.hashCode) +
    (people.hashCode) +
    (resultSize.hashCode);

  @override
  String toString() => 'AgentSearchPeopleToolResponseDto[status=$status, toolCall=$toolCall, reason=$reason, people=$people, resultSize=$resultSize]';

  Map<String, dynamic> toJson() {
    final json = <String, dynamic>{};
      json[r'status'] = this.status;
      json[r'toolCall'] = this.toolCall;
      json[r'reason'] = this.reason;
      json[r'people'] = this.people;
      json[r'resultSize'] = this.resultSize;
    return json;
  }

  /// Returns a new [AgentSearchPeopleToolResponseDto] instance and imports its values from
  /// [value] if it's a [Map], null otherwise.
  // ignore: prefer_constructors_over_static_methods
  static AgentSearchPeopleToolResponseDto? fromJson(dynamic value) {
    upgradeDto(value, "AgentSearchPeopleToolResponseDto");
    if (value is Map) {
      final json = value.cast<String, dynamic>();

      return AgentSearchPeopleToolResponseDto(
        status: AgentSearchPeopleToolResponseDtoStatusEnum.fromJson(json[r'status'])!,
        toolCall: AgentToolCallResponseDto.fromJson(json[r'toolCall'])!,
        reason: mapValueOfType<String>(json, r'reason')!,
        people: AgentSearchPeopleResult.fromJson(json[r'people'])!,
        resultSize: AgentToolResultSize.fromJson(json[r'resultSize'])!,
      );
    }
    return null;
  }

  static List<AgentSearchPeopleToolResponseDto> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <AgentSearchPeopleToolResponseDto>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = AgentSearchPeopleToolResponseDto.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }

  static Map<String, AgentSearchPeopleToolResponseDto> mapFromJson(dynamic json) {
    final map = <String, AgentSearchPeopleToolResponseDto>{};
    if (json is Map && json.isNotEmpty) {
      json = json.cast<String, dynamic>(); // ignore: parameter_assignments
      for (final entry in json.entries) {
        final value = AgentSearchPeopleToolResponseDto.fromJson(entry.value);
        if (value != null) {
          map[entry.key] = value;
        }
      }
    }
    return map;
  }

  // maps a json object with a list of AgentSearchPeopleToolResponseDto-objects as value to a dart map
  static Map<String, List<AgentSearchPeopleToolResponseDto>> mapListFromJson(dynamic json, {bool growable = false,}) {
    final map = <String, List<AgentSearchPeopleToolResponseDto>>{};
    if (json is Map && json.isNotEmpty) {
      // ignore: parameter_assignments
      json = json.cast<String, dynamic>();
      for (final entry in json.entries) {
        map[entry.key] = AgentSearchPeopleToolResponseDto.listFromJson(entry.value, growable: growable,);
      }
    }
    return map;
  }

  /// The list of required keys that must be present in a JSON.
  static const requiredKeys = <String>{
    'status',
    'toolCall',
    'reason',
    'people',
    'resultSize',
  };
}


class AgentSearchPeopleToolResponseDtoStatusEnum {
  /// Instantiate a new enum with the provided [value].
  const AgentSearchPeopleToolResponseDtoStatusEnum._(this.value);

  /// The underlying value of this enum member.
  final String value;

  @override
  String toString() => value;

  String toJson() => value;

  static const success = AgentSearchPeopleToolResponseDtoStatusEnum._(r'success');

  /// List of all possible values in this [enum][AgentSearchPeopleToolResponseDtoStatusEnum].
  static const values = <AgentSearchPeopleToolResponseDtoStatusEnum>[
    success,
  ];

  static AgentSearchPeopleToolResponseDtoStatusEnum? fromJson(dynamic value) => AgentSearchPeopleToolResponseDtoStatusEnumTypeTransformer().decode(value);

  static List<AgentSearchPeopleToolResponseDtoStatusEnum> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <AgentSearchPeopleToolResponseDtoStatusEnum>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = AgentSearchPeopleToolResponseDtoStatusEnum.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }
}

/// Transformation class that can [encode] an instance of [AgentSearchPeopleToolResponseDtoStatusEnum] to String,
/// and [decode] dynamic data back to [AgentSearchPeopleToolResponseDtoStatusEnum].
class AgentSearchPeopleToolResponseDtoStatusEnumTypeTransformer {
  factory AgentSearchPeopleToolResponseDtoStatusEnumTypeTransformer() => _instance ??= const AgentSearchPeopleToolResponseDtoStatusEnumTypeTransformer._();

  const AgentSearchPeopleToolResponseDtoStatusEnumTypeTransformer._();

  String encode(AgentSearchPeopleToolResponseDtoStatusEnum data) => data.value;

  /// Decodes a [dynamic value][data] to a AgentSearchPeopleToolResponseDtoStatusEnum.
  ///
  /// If [allowNull] is true and the [dynamic value][data] cannot be decoded successfully,
  /// then null is returned. However, if [allowNull] is false and the [dynamic value][data]
  /// cannot be decoded successfully, then an [UnimplementedError] is thrown.
  ///
  /// The [allowNull] is very handy when an API changes and a new enum value is added or removed,
  /// and users are still using an old app with the old code.
  AgentSearchPeopleToolResponseDtoStatusEnum? decode(dynamic data, {bool allowNull = true}) {
    if (data != null) {
      switch (data) {
        case r'success': return AgentSearchPeopleToolResponseDtoStatusEnum.success;
        default:
          if (!allowNull) {
            throw ArgumentError('Unknown enum value to decode: $data');
          }
      }
    }
    return null;
  }

  /// Singleton [AgentSearchPeopleToolResponseDtoStatusEnumTypeTransformer] instance.
  static AgentSearchPeopleToolResponseDtoStatusEnumTypeTransformer? _instance;
}


