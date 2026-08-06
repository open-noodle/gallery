//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

class AgentListDuplicateGroupsToolDeniedResponse {
  /// Returns a new [AgentListDuplicateGroupsToolDeniedResponse] instance.
  AgentListDuplicateGroupsToolDeniedResponse({
    required this.reason,
    required this.status,
    required this.toolCall,
  });

  String reason;

  AgentListDuplicateGroupsToolDeniedResponseStatusEnum status;

  AgentToolCallResponseDto toolCall;

  @override
  bool operator ==(Object other) => identical(this, other) || other is AgentListDuplicateGroupsToolDeniedResponse &&
    other.reason == reason &&
    other.status == status &&
    other.toolCall == toolCall;

  @override
  int get hashCode =>
    // ignore: unnecessary_parenthesis
    (reason.hashCode) +
    (status.hashCode) +
    (toolCall.hashCode);

  @override
  String toString() => 'AgentListDuplicateGroupsToolDeniedResponse[reason=$reason, status=$status, toolCall=$toolCall]';

  Map<String, dynamic> toJson() {
    final json = <String, dynamic>{};
      json[r'reason'] = this.reason;
      json[r'status'] = this.status;
      json[r'toolCall'] = this.toolCall;
    return json;
  }

  /// Returns a new [AgentListDuplicateGroupsToolDeniedResponse] instance and imports its values from
  /// [value] if it's a [Map], null otherwise.
  // ignore: prefer_constructors_over_static_methods
  static AgentListDuplicateGroupsToolDeniedResponse? fromJson(dynamic value) {
    upgradeDto(value, "AgentListDuplicateGroupsToolDeniedResponse");
    if (value is Map) {
      final json = value.cast<String, dynamic>();

      return AgentListDuplicateGroupsToolDeniedResponse(
        reason: mapValueOfType<String>(json, r'reason')!,
        status: AgentListDuplicateGroupsToolDeniedResponseStatusEnum.fromJson(json[r'status'])!,
        toolCall: AgentToolCallResponseDto.fromJson(json[r'toolCall'])!,
      );
    }
    return null;
  }

  static List<AgentListDuplicateGroupsToolDeniedResponse> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <AgentListDuplicateGroupsToolDeniedResponse>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = AgentListDuplicateGroupsToolDeniedResponse.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }

  static Map<String, AgentListDuplicateGroupsToolDeniedResponse> mapFromJson(dynamic json) {
    final map = <String, AgentListDuplicateGroupsToolDeniedResponse>{};
    if (json is Map && json.isNotEmpty) {
      json = json.cast<String, dynamic>(); // ignore: parameter_assignments
      for (final entry in json.entries) {
        final value = AgentListDuplicateGroupsToolDeniedResponse.fromJson(entry.value);
        if (value != null) {
          map[entry.key] = value;
        }
      }
    }
    return map;
  }

  // maps a json object with a list of AgentListDuplicateGroupsToolDeniedResponse-objects as value to a dart map
  static Map<String, List<AgentListDuplicateGroupsToolDeniedResponse>> mapListFromJson(dynamic json, {bool growable = false,}) {
    final map = <String, List<AgentListDuplicateGroupsToolDeniedResponse>>{};
    if (json is Map && json.isNotEmpty) {
      // ignore: parameter_assignments
      json = json.cast<String, dynamic>();
      for (final entry in json.entries) {
        map[entry.key] = AgentListDuplicateGroupsToolDeniedResponse.listFromJson(entry.value, growable: growable,);
      }
    }
    return map;
  }

  /// The list of required keys that must be present in a JSON.
  static const requiredKeys = <String>{
    'reason',
    'status',
    'toolCall',
  };
}


class AgentListDuplicateGroupsToolDeniedResponseStatusEnum {
  /// Instantiate a new enum with the provided [value].
  const AgentListDuplicateGroupsToolDeniedResponseStatusEnum._(this.value);

  /// The underlying value of this enum member.
  final String value;

  @override
  String toString() => value;

  String toJson() => value;

  static const denied = AgentListDuplicateGroupsToolDeniedResponseStatusEnum._(r'denied');

  /// List of all possible values in this [enum][AgentListDuplicateGroupsToolDeniedResponseStatusEnum].
  static const values = <AgentListDuplicateGroupsToolDeniedResponseStatusEnum>[
    denied,
  ];

  static AgentListDuplicateGroupsToolDeniedResponseStatusEnum? fromJson(dynamic value) => AgentListDuplicateGroupsToolDeniedResponseStatusEnumTypeTransformer().decode(value);

  static List<AgentListDuplicateGroupsToolDeniedResponseStatusEnum> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <AgentListDuplicateGroupsToolDeniedResponseStatusEnum>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = AgentListDuplicateGroupsToolDeniedResponseStatusEnum.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }
}

/// Transformation class that can [encode] an instance of [AgentListDuplicateGroupsToolDeniedResponseStatusEnum] to String,
/// and [decode] dynamic data back to [AgentListDuplicateGroupsToolDeniedResponseStatusEnum].
class AgentListDuplicateGroupsToolDeniedResponseStatusEnumTypeTransformer {
  factory AgentListDuplicateGroupsToolDeniedResponseStatusEnumTypeTransformer() => _instance ??= const AgentListDuplicateGroupsToolDeniedResponseStatusEnumTypeTransformer._();

  const AgentListDuplicateGroupsToolDeniedResponseStatusEnumTypeTransformer._();

  String encode(AgentListDuplicateGroupsToolDeniedResponseStatusEnum data) => data.value;

  /// Decodes a [dynamic value][data] to a AgentListDuplicateGroupsToolDeniedResponseStatusEnum.
  ///
  /// If [allowNull] is true and the [dynamic value][data] cannot be decoded successfully,
  /// then null is returned. However, if [allowNull] is false and the [dynamic value][data]
  /// cannot be decoded successfully, then an [UnimplementedError] is thrown.
  ///
  /// The [allowNull] is very handy when an API changes and a new enum value is added or removed,
  /// and users are still using an old app with the old code.
  AgentListDuplicateGroupsToolDeniedResponseStatusEnum? decode(dynamic data, {bool allowNull = true}) {
    if (data != null) {
      switch (data) {
        case r'denied': return AgentListDuplicateGroupsToolDeniedResponseStatusEnum.denied;
        default:
          if (!allowNull) {
            throw ArgumentError('Unknown enum value to decode: $data');
          }
      }
    }
    return null;
  }

  /// Singleton [AgentListDuplicateGroupsToolDeniedResponseStatusEnumTypeTransformer] instance.
  static AgentListDuplicateGroupsToolDeniedResponseStatusEnumTypeTransformer? _instance;
}


