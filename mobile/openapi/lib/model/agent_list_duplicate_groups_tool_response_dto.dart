//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

class AgentListDuplicateGroupsToolResponseDto {
  /// Returns a new [AgentListDuplicateGroupsToolResponseDto] instance.
  AgentListDuplicateGroupsToolResponseDto({
    required this.status,
    required this.toolCall,
    required this.reason,
    this.groups = const [],
    required this.resultSize,
  });

  AgentListDuplicateGroupsToolResponseDtoStatusEnum status;

  AgentToolCallResponseDto toolCall;

  String reason;

  List<AgentDuplicateGroup> groups;

  AgentToolResultSize resultSize;

  @override
  bool operator ==(Object other) => identical(this, other) || other is AgentListDuplicateGroupsToolResponseDto &&
    other.status == status &&
    other.toolCall == toolCall &&
    other.reason == reason &&
    _deepEquality.equals(other.groups, groups) &&
    other.resultSize == resultSize;

  @override
  int get hashCode =>
    // ignore: unnecessary_parenthesis
    (status.hashCode) +
    (toolCall.hashCode) +
    (reason.hashCode) +
    (groups.hashCode) +
    (resultSize.hashCode);

  @override
  String toString() => 'AgentListDuplicateGroupsToolResponseDto[status=$status, toolCall=$toolCall, reason=$reason, groups=$groups, resultSize=$resultSize]';

  Map<String, dynamic> toJson() {
    final json = <String, dynamic>{};
      json[r'status'] = this.status;
      json[r'toolCall'] = this.toolCall;
      json[r'reason'] = this.reason;
      json[r'groups'] = this.groups;
      json[r'resultSize'] = this.resultSize;
    return json;
  }

  /// Returns a new [AgentListDuplicateGroupsToolResponseDto] instance and imports its values from
  /// [value] if it's a [Map], null otherwise.
  // ignore: prefer_constructors_over_static_methods
  static AgentListDuplicateGroupsToolResponseDto? fromJson(dynamic value) {
    upgradeDto(value, "AgentListDuplicateGroupsToolResponseDto");
    if (value is Map) {
      final json = value.cast<String, dynamic>();

      return AgentListDuplicateGroupsToolResponseDto(
        status: AgentListDuplicateGroupsToolResponseDtoStatusEnum.fromJson(json[r'status'])!,
        toolCall: AgentToolCallResponseDto.fromJson(json[r'toolCall'])!,
        reason: mapValueOfType<String>(json, r'reason')!,
        groups: AgentDuplicateGroup.listFromJson(json[r'groups']),
        resultSize: AgentToolResultSize.fromJson(json[r'resultSize'])!,
      );
    }
    return null;
  }

  static List<AgentListDuplicateGroupsToolResponseDto> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <AgentListDuplicateGroupsToolResponseDto>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = AgentListDuplicateGroupsToolResponseDto.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }

  static Map<String, AgentListDuplicateGroupsToolResponseDto> mapFromJson(dynamic json) {
    final map = <String, AgentListDuplicateGroupsToolResponseDto>{};
    if (json is Map && json.isNotEmpty) {
      json = json.cast<String, dynamic>(); // ignore: parameter_assignments
      for (final entry in json.entries) {
        final value = AgentListDuplicateGroupsToolResponseDto.fromJson(entry.value);
        if (value != null) {
          map[entry.key] = value;
        }
      }
    }
    return map;
  }

  // maps a json object with a list of AgentListDuplicateGroupsToolResponseDto-objects as value to a dart map
  static Map<String, List<AgentListDuplicateGroupsToolResponseDto>> mapListFromJson(dynamic json, {bool growable = false,}) {
    final map = <String, List<AgentListDuplicateGroupsToolResponseDto>>{};
    if (json is Map && json.isNotEmpty) {
      // ignore: parameter_assignments
      json = json.cast<String, dynamic>();
      for (final entry in json.entries) {
        map[entry.key] = AgentListDuplicateGroupsToolResponseDto.listFromJson(entry.value, growable: growable,);
      }
    }
    return map;
  }

  /// The list of required keys that must be present in a JSON.
  static const requiredKeys = <String>{
    'status',
    'toolCall',
    'reason',
    'groups',
    'resultSize',
  };
}


class AgentListDuplicateGroupsToolResponseDtoStatusEnum {
  /// Instantiate a new enum with the provided [value].
  const AgentListDuplicateGroupsToolResponseDtoStatusEnum._(this.value);

  /// The underlying value of this enum member.
  final String value;

  @override
  String toString() => value;

  String toJson() => value;

  static const success = AgentListDuplicateGroupsToolResponseDtoStatusEnum._(r'success');

  /// List of all possible values in this [enum][AgentListDuplicateGroupsToolResponseDtoStatusEnum].
  static const values = <AgentListDuplicateGroupsToolResponseDtoStatusEnum>[
    success,
  ];

  static AgentListDuplicateGroupsToolResponseDtoStatusEnum? fromJson(dynamic value) => AgentListDuplicateGroupsToolResponseDtoStatusEnumTypeTransformer().decode(value);

  static List<AgentListDuplicateGroupsToolResponseDtoStatusEnum> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <AgentListDuplicateGroupsToolResponseDtoStatusEnum>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = AgentListDuplicateGroupsToolResponseDtoStatusEnum.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }
}

/// Transformation class that can [encode] an instance of [AgentListDuplicateGroupsToolResponseDtoStatusEnum] to String,
/// and [decode] dynamic data back to [AgentListDuplicateGroupsToolResponseDtoStatusEnum].
class AgentListDuplicateGroupsToolResponseDtoStatusEnumTypeTransformer {
  factory AgentListDuplicateGroupsToolResponseDtoStatusEnumTypeTransformer() => _instance ??= const AgentListDuplicateGroupsToolResponseDtoStatusEnumTypeTransformer._();

  const AgentListDuplicateGroupsToolResponseDtoStatusEnumTypeTransformer._();

  String encode(AgentListDuplicateGroupsToolResponseDtoStatusEnum data) => data.value;

  /// Decodes a [dynamic value][data] to a AgentListDuplicateGroupsToolResponseDtoStatusEnum.
  ///
  /// If [allowNull] is true and the [dynamic value][data] cannot be decoded successfully,
  /// then null is returned. However, if [allowNull] is false and the [dynamic value][data]
  /// cannot be decoded successfully, then an [UnimplementedError] is thrown.
  ///
  /// The [allowNull] is very handy when an API changes and a new enum value is added or removed,
  /// and users are still using an old app with the old code.
  AgentListDuplicateGroupsToolResponseDtoStatusEnum? decode(dynamic data, {bool allowNull = true}) {
    if (data != null) {
      switch (data) {
        case r'success': return AgentListDuplicateGroupsToolResponseDtoStatusEnum.success;
        default:
          if (!allowNull) {
            throw ArgumentError('Unknown enum value to decode: $data');
          }
      }
    }
    return null;
  }

  /// Singleton [AgentListDuplicateGroupsToolResponseDtoStatusEnumTypeTransformer] instance.
  static AgentListDuplicateGroupsToolResponseDtoStatusEnumTypeTransformer? _instance;
}


