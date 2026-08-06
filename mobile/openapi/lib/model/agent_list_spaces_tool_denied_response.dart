//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

class AgentListSpacesToolDeniedResponse {
  /// Returns a new [AgentListSpacesToolDeniedResponse] instance.
  AgentListSpacesToolDeniedResponse({
    required this.reason,
    required this.status,
    required this.toolCall,
  });

  String reason;

  AgentListSpacesToolDeniedResponseStatusEnum status;

  AgentToolCallResponseDto toolCall;

  @override
  bool operator ==(Object other) => identical(this, other) || other is AgentListSpacesToolDeniedResponse &&
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
  String toString() => 'AgentListSpacesToolDeniedResponse[reason=$reason, status=$status, toolCall=$toolCall]';

  Map<String, dynamic> toJson() {
    final json = <String, dynamic>{};
      json[r'reason'] = this.reason;
      json[r'status'] = this.status;
      json[r'toolCall'] = this.toolCall;
    return json;
  }

  /// Returns a new [AgentListSpacesToolDeniedResponse] instance and imports its values from
  /// [value] if it's a [Map], null otherwise.
  // ignore: prefer_constructors_over_static_methods
  static AgentListSpacesToolDeniedResponse? fromJson(dynamic value) {
    upgradeDto(value, "AgentListSpacesToolDeniedResponse");
    if (value is Map) {
      final json = value.cast<String, dynamic>();

      return AgentListSpacesToolDeniedResponse(
        reason: mapValueOfType<String>(json, r'reason')!,
        status: AgentListSpacesToolDeniedResponseStatusEnum.fromJson(json[r'status'])!,
        toolCall: AgentToolCallResponseDto.fromJson(json[r'toolCall'])!,
      );
    }
    return null;
  }

  static List<AgentListSpacesToolDeniedResponse> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <AgentListSpacesToolDeniedResponse>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = AgentListSpacesToolDeniedResponse.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }

  static Map<String, AgentListSpacesToolDeniedResponse> mapFromJson(dynamic json) {
    final map = <String, AgentListSpacesToolDeniedResponse>{};
    if (json is Map && json.isNotEmpty) {
      json = json.cast<String, dynamic>(); // ignore: parameter_assignments
      for (final entry in json.entries) {
        final value = AgentListSpacesToolDeniedResponse.fromJson(entry.value);
        if (value != null) {
          map[entry.key] = value;
        }
      }
    }
    return map;
  }

  // maps a json object with a list of AgentListSpacesToolDeniedResponse-objects as value to a dart map
  static Map<String, List<AgentListSpacesToolDeniedResponse>> mapListFromJson(dynamic json, {bool growable = false,}) {
    final map = <String, List<AgentListSpacesToolDeniedResponse>>{};
    if (json is Map && json.isNotEmpty) {
      // ignore: parameter_assignments
      json = json.cast<String, dynamic>();
      for (final entry in json.entries) {
        map[entry.key] = AgentListSpacesToolDeniedResponse.listFromJson(entry.value, growable: growable,);
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


class AgentListSpacesToolDeniedResponseStatusEnum {
  /// Instantiate a new enum with the provided [value].
  const AgentListSpacesToolDeniedResponseStatusEnum._(this.value);

  /// The underlying value of this enum member.
  final String value;

  @override
  String toString() => value;

  String toJson() => value;

  static const denied = AgentListSpacesToolDeniedResponseStatusEnum._(r'denied');

  /// List of all possible values in this [enum][AgentListSpacesToolDeniedResponseStatusEnum].
  static const values = <AgentListSpacesToolDeniedResponseStatusEnum>[
    denied,
  ];

  static AgentListSpacesToolDeniedResponseStatusEnum? fromJson(dynamic value) => AgentListSpacesToolDeniedResponseStatusEnumTypeTransformer().decode(value);

  static List<AgentListSpacesToolDeniedResponseStatusEnum> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <AgentListSpacesToolDeniedResponseStatusEnum>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = AgentListSpacesToolDeniedResponseStatusEnum.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }
}

/// Transformation class that can [encode] an instance of [AgentListSpacesToolDeniedResponseStatusEnum] to String,
/// and [decode] dynamic data back to [AgentListSpacesToolDeniedResponseStatusEnum].
class AgentListSpacesToolDeniedResponseStatusEnumTypeTransformer {
  factory AgentListSpacesToolDeniedResponseStatusEnumTypeTransformer() => _instance ??= const AgentListSpacesToolDeniedResponseStatusEnumTypeTransformer._();

  const AgentListSpacesToolDeniedResponseStatusEnumTypeTransformer._();

  String encode(AgentListSpacesToolDeniedResponseStatusEnum data) => data.value;

  /// Decodes a [dynamic value][data] to a AgentListSpacesToolDeniedResponseStatusEnum.
  ///
  /// If [allowNull] is true and the [dynamic value][data] cannot be decoded successfully,
  /// then null is returned. However, if [allowNull] is false and the [dynamic value][data]
  /// cannot be decoded successfully, then an [UnimplementedError] is thrown.
  ///
  /// The [allowNull] is very handy when an API changes and a new enum value is added or removed,
  /// and users are still using an old app with the old code.
  AgentListSpacesToolDeniedResponseStatusEnum? decode(dynamic data, {bool allowNull = true}) {
    if (data != null) {
      switch (data) {
        case r'denied': return AgentListSpacesToolDeniedResponseStatusEnum.denied;
        default:
          if (!allowNull) {
            throw ArgumentError('Unknown enum value to decode: $data');
          }
      }
    }
    return null;
  }

  /// Singleton [AgentListSpacesToolDeniedResponseStatusEnumTypeTransformer] instance.
  static AgentListSpacesToolDeniedResponseStatusEnumTypeTransformer? _instance;
}


