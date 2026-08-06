//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

class AgentListDuplicateGroupsToolSuccessResponse {
  /// Returns a new [AgentListDuplicateGroupsToolSuccessResponse] instance.
  AgentListDuplicateGroupsToolSuccessResponse({
    this.groups = const [],
    required this.resultSize,
    required this.status,
    required this.toolCall,
  });

  List<AgentDuplicateGroup> groups;

  AgentToolResultSize resultSize;

  AgentListDuplicateGroupsToolSuccessResponseStatusEnum status;

  AgentToolCallResponseDto toolCall;

  @override
  bool operator ==(Object other) => identical(this, other) || other is AgentListDuplicateGroupsToolSuccessResponse &&
    _deepEquality.equals(other.groups, groups) &&
    other.resultSize == resultSize &&
    other.status == status &&
    other.toolCall == toolCall;

  @override
  int get hashCode =>
    // ignore: unnecessary_parenthesis
    (groups.hashCode) +
    (resultSize.hashCode) +
    (status.hashCode) +
    (toolCall.hashCode);

  @override
  String toString() => 'AgentListDuplicateGroupsToolSuccessResponse[groups=$groups, resultSize=$resultSize, status=$status, toolCall=$toolCall]';

  Map<String, dynamic> toJson() {
    final json = <String, dynamic>{};
      json[r'groups'] = this.groups;
      json[r'resultSize'] = this.resultSize;
      json[r'status'] = this.status;
      json[r'toolCall'] = this.toolCall;
    return json;
  }

  /// Returns a new [AgentListDuplicateGroupsToolSuccessResponse] instance and imports its values from
  /// [value] if it's a [Map], null otherwise.
  // ignore: prefer_constructors_over_static_methods
  static AgentListDuplicateGroupsToolSuccessResponse? fromJson(dynamic value) {
    upgradeDto(value, "AgentListDuplicateGroupsToolSuccessResponse");
    if (value is Map) {
      final json = value.cast<String, dynamic>();

      return AgentListDuplicateGroupsToolSuccessResponse(
        groups: AgentDuplicateGroup.listFromJson(json[r'groups']),
        resultSize: AgentToolResultSize.fromJson(json[r'resultSize'])!,
        status: AgentListDuplicateGroupsToolSuccessResponseStatusEnum.fromJson(json[r'status'])!,
        toolCall: AgentToolCallResponseDto.fromJson(json[r'toolCall'])!,
      );
    }
    return null;
  }

  static List<AgentListDuplicateGroupsToolSuccessResponse> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <AgentListDuplicateGroupsToolSuccessResponse>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = AgentListDuplicateGroupsToolSuccessResponse.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }

  static Map<String, AgentListDuplicateGroupsToolSuccessResponse> mapFromJson(dynamic json) {
    final map = <String, AgentListDuplicateGroupsToolSuccessResponse>{};
    if (json is Map && json.isNotEmpty) {
      json = json.cast<String, dynamic>(); // ignore: parameter_assignments
      for (final entry in json.entries) {
        final value = AgentListDuplicateGroupsToolSuccessResponse.fromJson(entry.value);
        if (value != null) {
          map[entry.key] = value;
        }
      }
    }
    return map;
  }

  // maps a json object with a list of AgentListDuplicateGroupsToolSuccessResponse-objects as value to a dart map
  static Map<String, List<AgentListDuplicateGroupsToolSuccessResponse>> mapListFromJson(dynamic json, {bool growable = false,}) {
    final map = <String, List<AgentListDuplicateGroupsToolSuccessResponse>>{};
    if (json is Map && json.isNotEmpty) {
      // ignore: parameter_assignments
      json = json.cast<String, dynamic>();
      for (final entry in json.entries) {
        map[entry.key] = AgentListDuplicateGroupsToolSuccessResponse.listFromJson(entry.value, growable: growable,);
      }
    }
    return map;
  }

  /// The list of required keys that must be present in a JSON.
  static const requiredKeys = <String>{
    'groups',
    'resultSize',
    'status',
    'toolCall',
  };
}


class AgentListDuplicateGroupsToolSuccessResponseStatusEnum {
  /// Instantiate a new enum with the provided [value].
  const AgentListDuplicateGroupsToolSuccessResponseStatusEnum._(this.value);

  /// The underlying value of this enum member.
  final String value;

  @override
  String toString() => value;

  String toJson() => value;

  static const success = AgentListDuplicateGroupsToolSuccessResponseStatusEnum._(r'success');

  /// List of all possible values in this [enum][AgentListDuplicateGroupsToolSuccessResponseStatusEnum].
  static const values = <AgentListDuplicateGroupsToolSuccessResponseStatusEnum>[
    success,
  ];

  static AgentListDuplicateGroupsToolSuccessResponseStatusEnum? fromJson(dynamic value) => AgentListDuplicateGroupsToolSuccessResponseStatusEnumTypeTransformer().decode(value);

  static List<AgentListDuplicateGroupsToolSuccessResponseStatusEnum> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <AgentListDuplicateGroupsToolSuccessResponseStatusEnum>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = AgentListDuplicateGroupsToolSuccessResponseStatusEnum.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }
}

/// Transformation class that can [encode] an instance of [AgentListDuplicateGroupsToolSuccessResponseStatusEnum] to String,
/// and [decode] dynamic data back to [AgentListDuplicateGroupsToolSuccessResponseStatusEnum].
class AgentListDuplicateGroupsToolSuccessResponseStatusEnumTypeTransformer {
  factory AgentListDuplicateGroupsToolSuccessResponseStatusEnumTypeTransformer() => _instance ??= const AgentListDuplicateGroupsToolSuccessResponseStatusEnumTypeTransformer._();

  const AgentListDuplicateGroupsToolSuccessResponseStatusEnumTypeTransformer._();

  String encode(AgentListDuplicateGroupsToolSuccessResponseStatusEnum data) => data.value;

  /// Decodes a [dynamic value][data] to a AgentListDuplicateGroupsToolSuccessResponseStatusEnum.
  ///
  /// If [allowNull] is true and the [dynamic value][data] cannot be decoded successfully,
  /// then null is returned. However, if [allowNull] is false and the [dynamic value][data]
  /// cannot be decoded successfully, then an [UnimplementedError] is thrown.
  ///
  /// The [allowNull] is very handy when an API changes and a new enum value is added or removed,
  /// and users are still using an old app with the old code.
  AgentListDuplicateGroupsToolSuccessResponseStatusEnum? decode(dynamic data, {bool allowNull = true}) {
    if (data != null) {
      switch (data) {
        case r'success': return AgentListDuplicateGroupsToolSuccessResponseStatusEnum.success;
        default:
          if (!allowNull) {
            throw ArgumentError('Unknown enum value to decode: $data');
          }
      }
    }
    return null;
  }

  /// Singleton [AgentListDuplicateGroupsToolSuccessResponseStatusEnumTypeTransformer] instance.
  static AgentListDuplicateGroupsToolSuccessResponseStatusEnumTypeTransformer? _instance;
}


