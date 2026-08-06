//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

class AgentOperationPlanToolResponseDto {
  /// Returns a new [AgentOperationPlanToolResponseDto] instance.
  AgentOperationPlanToolResponseDto({
    required this.plan,
    required this.status,
    required this.summary,
    required this.toolCall,
  });

  AgentOperationPlanResponseDto? plan;

  AgentOperationPlanToolResponseDtoStatusEnum status;

  String summary;

  AgentToolCallResponseDto? toolCall;

  @override
  bool operator ==(Object other) => identical(this, other) || other is AgentOperationPlanToolResponseDto &&
    other.plan == plan &&
    other.status == status &&
    other.summary == summary &&
    other.toolCall == toolCall;

  @override
  int get hashCode =>
    // ignore: unnecessary_parenthesis
    (plan == null ? 0 : plan!.hashCode) +
    (status.hashCode) +
    (summary.hashCode) +
    (toolCall == null ? 0 : toolCall!.hashCode);

  @override
  String toString() => 'AgentOperationPlanToolResponseDto[plan=$plan, status=$status, summary=$summary, toolCall=$toolCall]';

  Map<String, dynamic> toJson() {
    final json = <String, dynamic>{};
    if (this.plan != null) {
      json[r'plan'] = this.plan;
    } else {
    //  json[r'plan'] = null;
    }
      json[r'status'] = this.status;
      json[r'summary'] = this.summary;
    if (this.toolCall != null) {
      json[r'toolCall'] = this.toolCall;
    } else {
    //  json[r'toolCall'] = null;
    }
    return json;
  }

  /// Returns a new [AgentOperationPlanToolResponseDto] instance and imports its values from
  /// [value] if it's a [Map], null otherwise.
  // ignore: prefer_constructors_over_static_methods
  static AgentOperationPlanToolResponseDto? fromJson(dynamic value) {
    upgradeDto(value, "AgentOperationPlanToolResponseDto");
    if (value is Map) {
      final json = value.cast<String, dynamic>();

      return AgentOperationPlanToolResponseDto(
        plan: AgentOperationPlanResponseDto.fromJson(json[r'plan']),
        status: AgentOperationPlanToolResponseDtoStatusEnum.fromJson(json[r'status'])!,
        summary: mapValueOfType<String>(json, r'summary')!,
        toolCall: AgentToolCallResponseDto.fromJson(json[r'toolCall']),
      );
    }
    return null;
  }

  static List<AgentOperationPlanToolResponseDto> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <AgentOperationPlanToolResponseDto>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = AgentOperationPlanToolResponseDto.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }

  static Map<String, AgentOperationPlanToolResponseDto> mapFromJson(dynamic json) {
    final map = <String, AgentOperationPlanToolResponseDto>{};
    if (json is Map && json.isNotEmpty) {
      json = json.cast<String, dynamic>(); // ignore: parameter_assignments
      for (final entry in json.entries) {
        final value = AgentOperationPlanToolResponseDto.fromJson(entry.value);
        if (value != null) {
          map[entry.key] = value;
        }
      }
    }
    return map;
  }

  // maps a json object with a list of AgentOperationPlanToolResponseDto-objects as value to a dart map
  static Map<String, List<AgentOperationPlanToolResponseDto>> mapListFromJson(dynamic json, {bool growable = false,}) {
    final map = <String, List<AgentOperationPlanToolResponseDto>>{};
    if (json is Map && json.isNotEmpty) {
      // ignore: parameter_assignments
      json = json.cast<String, dynamic>();
      for (final entry in json.entries) {
        map[entry.key] = AgentOperationPlanToolResponseDto.listFromJson(entry.value, growable: growable,);
      }
    }
    return map;
  }

  /// The list of required keys that must be present in a JSON.
  static const requiredKeys = <String>{
    'plan',
    'status',
    'summary',
    'toolCall',
  };
}


class AgentOperationPlanToolResponseDtoStatusEnum {
  /// Instantiate a new enum with the provided [value].
  const AgentOperationPlanToolResponseDtoStatusEnum._(this.value);

  /// The underlying value of this enum member.
  final String value;

  @override
  String toString() => value;

  String toJson() => value;

  static const success = AgentOperationPlanToolResponseDtoStatusEnum._(r'success');

  /// List of all possible values in this [enum][AgentOperationPlanToolResponseDtoStatusEnum].
  static const values = <AgentOperationPlanToolResponseDtoStatusEnum>[
    success,
  ];

  static AgentOperationPlanToolResponseDtoStatusEnum? fromJson(dynamic value) => AgentOperationPlanToolResponseDtoStatusEnumTypeTransformer().decode(value);

  static List<AgentOperationPlanToolResponseDtoStatusEnum> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <AgentOperationPlanToolResponseDtoStatusEnum>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = AgentOperationPlanToolResponseDtoStatusEnum.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }
}

/// Transformation class that can [encode] an instance of [AgentOperationPlanToolResponseDtoStatusEnum] to String,
/// and [decode] dynamic data back to [AgentOperationPlanToolResponseDtoStatusEnum].
class AgentOperationPlanToolResponseDtoStatusEnumTypeTransformer {
  factory AgentOperationPlanToolResponseDtoStatusEnumTypeTransformer() => _instance ??= const AgentOperationPlanToolResponseDtoStatusEnumTypeTransformer._();

  const AgentOperationPlanToolResponseDtoStatusEnumTypeTransformer._();

  String encode(AgentOperationPlanToolResponseDtoStatusEnum data) => data.value;

  /// Decodes a [dynamic value][data] to a AgentOperationPlanToolResponseDtoStatusEnum.
  ///
  /// If [allowNull] is true and the [dynamic value][data] cannot be decoded successfully,
  /// then null is returned. However, if [allowNull] is false and the [dynamic value][data]
  /// cannot be decoded successfully, then an [UnimplementedError] is thrown.
  ///
  /// The [allowNull] is very handy when an API changes and a new enum value is added or removed,
  /// and users are still using an old app with the old code.
  AgentOperationPlanToolResponseDtoStatusEnum? decode(dynamic data, {bool allowNull = true}) {
    if (data != null) {
      switch (data) {
        case r'success': return AgentOperationPlanToolResponseDtoStatusEnum.success;
        default:
          if (!allowNull) {
            throw ArgumentError('Unknown enum value to decode: $data');
          }
      }
    }
    return null;
  }

  /// Singleton [AgentOperationPlanToolResponseDtoStatusEnumTypeTransformer] instance.
  static AgentOperationPlanToolResponseDtoStatusEnumTypeTransformer? _instance;
}


