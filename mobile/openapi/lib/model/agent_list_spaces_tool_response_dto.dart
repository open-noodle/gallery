//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

class AgentListSpacesToolResponseDto {
  /// Returns a new [AgentListSpacesToolResponseDto] instance.
  AgentListSpacesToolResponseDto({
    required this.status,
    required this.toolCall,
    required this.reason,
    required this.resultSize,
    this.spaces = const [],
  });

  AgentListSpacesToolResponseDtoStatusEnum status;

  AgentToolCallResponseDto toolCall;

  String reason;

  AgentToolResultSize resultSize;

  List<AgentSpaceSummary> spaces;

  @override
  bool operator ==(Object other) => identical(this, other) || other is AgentListSpacesToolResponseDto &&
    other.status == status &&
    other.toolCall == toolCall &&
    other.reason == reason &&
    other.resultSize == resultSize &&
    _deepEquality.equals(other.spaces, spaces);

  @override
  int get hashCode =>
    // ignore: unnecessary_parenthesis
    (status.hashCode) +
    (toolCall.hashCode) +
    (reason.hashCode) +
    (resultSize.hashCode) +
    (spaces.hashCode);

  @override
  String toString() => 'AgentListSpacesToolResponseDto[status=$status, toolCall=$toolCall, reason=$reason, resultSize=$resultSize, spaces=$spaces]';

  Map<String, dynamic> toJson() {
    final json = <String, dynamic>{};
      json[r'status'] = this.status;
      json[r'toolCall'] = this.toolCall;
      json[r'reason'] = this.reason;
      json[r'resultSize'] = this.resultSize;
      json[r'spaces'] = this.spaces;
    return json;
  }

  /// Returns a new [AgentListSpacesToolResponseDto] instance and imports its values from
  /// [value] if it's a [Map], null otherwise.
  // ignore: prefer_constructors_over_static_methods
  static AgentListSpacesToolResponseDto? fromJson(dynamic value) {
    upgradeDto(value, "AgentListSpacesToolResponseDto");
    if (value is Map) {
      final json = value.cast<String, dynamic>();

      return AgentListSpacesToolResponseDto(
        status: AgentListSpacesToolResponseDtoStatusEnum.fromJson(json[r'status'])!,
        toolCall: AgentToolCallResponseDto.fromJson(json[r'toolCall'])!,
        reason: mapValueOfType<String>(json, r'reason')!,
        resultSize: AgentToolResultSize.fromJson(json[r'resultSize'])!,
        spaces: AgentSpaceSummary.listFromJson(json[r'spaces']),
      );
    }
    return null;
  }

  static List<AgentListSpacesToolResponseDto> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <AgentListSpacesToolResponseDto>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = AgentListSpacesToolResponseDto.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }

  static Map<String, AgentListSpacesToolResponseDto> mapFromJson(dynamic json) {
    final map = <String, AgentListSpacesToolResponseDto>{};
    if (json is Map && json.isNotEmpty) {
      json = json.cast<String, dynamic>(); // ignore: parameter_assignments
      for (final entry in json.entries) {
        final value = AgentListSpacesToolResponseDto.fromJson(entry.value);
        if (value != null) {
          map[entry.key] = value;
        }
      }
    }
    return map;
  }

  // maps a json object with a list of AgentListSpacesToolResponseDto-objects as value to a dart map
  static Map<String, List<AgentListSpacesToolResponseDto>> mapListFromJson(dynamic json, {bool growable = false,}) {
    final map = <String, List<AgentListSpacesToolResponseDto>>{};
    if (json is Map && json.isNotEmpty) {
      // ignore: parameter_assignments
      json = json.cast<String, dynamic>();
      for (final entry in json.entries) {
        map[entry.key] = AgentListSpacesToolResponseDto.listFromJson(entry.value, growable: growable,);
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
    'spaces',
  };
}


class AgentListSpacesToolResponseDtoStatusEnum {
  /// Instantiate a new enum with the provided [value].
  const AgentListSpacesToolResponseDtoStatusEnum._(this.value);

  /// The underlying value of this enum member.
  final String value;

  @override
  String toString() => value;

  String toJson() => value;

  static const success = AgentListSpacesToolResponseDtoStatusEnum._(r'success');

  /// List of all possible values in this [enum][AgentListSpacesToolResponseDtoStatusEnum].
  static const values = <AgentListSpacesToolResponseDtoStatusEnum>[
    success,
  ];

  static AgentListSpacesToolResponseDtoStatusEnum? fromJson(dynamic value) => AgentListSpacesToolResponseDtoStatusEnumTypeTransformer().decode(value);

  static List<AgentListSpacesToolResponseDtoStatusEnum> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <AgentListSpacesToolResponseDtoStatusEnum>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = AgentListSpacesToolResponseDtoStatusEnum.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }
}

/// Transformation class that can [encode] an instance of [AgentListSpacesToolResponseDtoStatusEnum] to String,
/// and [decode] dynamic data back to [AgentListSpacesToolResponseDtoStatusEnum].
class AgentListSpacesToolResponseDtoStatusEnumTypeTransformer {
  factory AgentListSpacesToolResponseDtoStatusEnumTypeTransformer() => _instance ??= const AgentListSpacesToolResponseDtoStatusEnumTypeTransformer._();

  const AgentListSpacesToolResponseDtoStatusEnumTypeTransformer._();

  String encode(AgentListSpacesToolResponseDtoStatusEnum data) => data.value;

  /// Decodes a [dynamic value][data] to a AgentListSpacesToolResponseDtoStatusEnum.
  ///
  /// If [allowNull] is true and the [dynamic value][data] cannot be decoded successfully,
  /// then null is returned. However, if [allowNull] is false and the [dynamic value][data]
  /// cannot be decoded successfully, then an [UnimplementedError] is thrown.
  ///
  /// The [allowNull] is very handy when an API changes and a new enum value is added or removed,
  /// and users are still using an old app with the old code.
  AgentListSpacesToolResponseDtoStatusEnum? decode(dynamic data, {bool allowNull = true}) {
    if (data != null) {
      switch (data) {
        case r'success': return AgentListSpacesToolResponseDtoStatusEnum.success;
        default:
          if (!allowNull) {
            throw ArgumentError('Unknown enum value to decode: $data');
          }
      }
    }
    return null;
  }

  /// Singleton [AgentListSpacesToolResponseDtoStatusEnumTypeTransformer] instance.
  static AgentListSpacesToolResponseDtoStatusEnumTypeTransformer? _instance;
}


