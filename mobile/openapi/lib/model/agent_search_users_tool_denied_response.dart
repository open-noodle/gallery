//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

class AgentSearchUsersToolDeniedResponse {
  /// Returns a new [AgentSearchUsersToolDeniedResponse] instance.
  AgentSearchUsersToolDeniedResponse({
    required this.reason,
    required this.status,
    required this.toolCall,
  });

  String reason;

  AgentSearchUsersToolDeniedResponseStatusEnum status;

  AgentToolCallResponseDto toolCall;

  @override
  bool operator ==(Object other) => identical(this, other) || other is AgentSearchUsersToolDeniedResponse &&
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
  String toString() => 'AgentSearchUsersToolDeniedResponse[reason=$reason, status=$status, toolCall=$toolCall]';

  Map<String, dynamic> toJson() {
    final json = <String, dynamic>{};
      json[r'reason'] = this.reason;
      json[r'status'] = this.status;
      json[r'toolCall'] = this.toolCall;
    return json;
  }

  /// Returns a new [AgentSearchUsersToolDeniedResponse] instance and imports its values from
  /// [value] if it's a [Map], null otherwise.
  // ignore: prefer_constructors_over_static_methods
  static AgentSearchUsersToolDeniedResponse? fromJson(dynamic value) {
    upgradeDto(value, "AgentSearchUsersToolDeniedResponse");
    if (value is Map) {
      final json = value.cast<String, dynamic>();

      return AgentSearchUsersToolDeniedResponse(
        reason: mapValueOfType<String>(json, r'reason')!,
        status: AgentSearchUsersToolDeniedResponseStatusEnum.fromJson(json[r'status'])!,
        toolCall: AgentToolCallResponseDto.fromJson(json[r'toolCall'])!,
      );
    }
    return null;
  }

  static List<AgentSearchUsersToolDeniedResponse> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <AgentSearchUsersToolDeniedResponse>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = AgentSearchUsersToolDeniedResponse.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }

  static Map<String, AgentSearchUsersToolDeniedResponse> mapFromJson(dynamic json) {
    final map = <String, AgentSearchUsersToolDeniedResponse>{};
    if (json is Map && json.isNotEmpty) {
      json = json.cast<String, dynamic>(); // ignore: parameter_assignments
      for (final entry in json.entries) {
        final value = AgentSearchUsersToolDeniedResponse.fromJson(entry.value);
        if (value != null) {
          map[entry.key] = value;
        }
      }
    }
    return map;
  }

  // maps a json object with a list of AgentSearchUsersToolDeniedResponse-objects as value to a dart map
  static Map<String, List<AgentSearchUsersToolDeniedResponse>> mapListFromJson(dynamic json, {bool growable = false,}) {
    final map = <String, List<AgentSearchUsersToolDeniedResponse>>{};
    if (json is Map && json.isNotEmpty) {
      // ignore: parameter_assignments
      json = json.cast<String, dynamic>();
      for (final entry in json.entries) {
        map[entry.key] = AgentSearchUsersToolDeniedResponse.listFromJson(entry.value, growable: growable,);
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


class AgentSearchUsersToolDeniedResponseStatusEnum {
  /// Instantiate a new enum with the provided [value].
  const AgentSearchUsersToolDeniedResponseStatusEnum._(this.value);

  /// The underlying value of this enum member.
  final String value;

  @override
  String toString() => value;

  String toJson() => value;

  static const denied = AgentSearchUsersToolDeniedResponseStatusEnum._(r'denied');

  /// List of all possible values in this [enum][AgentSearchUsersToolDeniedResponseStatusEnum].
  static const values = <AgentSearchUsersToolDeniedResponseStatusEnum>[
    denied,
  ];

  static AgentSearchUsersToolDeniedResponseStatusEnum? fromJson(dynamic value) => AgentSearchUsersToolDeniedResponseStatusEnumTypeTransformer().decode(value);

  static List<AgentSearchUsersToolDeniedResponseStatusEnum> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <AgentSearchUsersToolDeniedResponseStatusEnum>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = AgentSearchUsersToolDeniedResponseStatusEnum.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }
}

/// Transformation class that can [encode] an instance of [AgentSearchUsersToolDeniedResponseStatusEnum] to String,
/// and [decode] dynamic data back to [AgentSearchUsersToolDeniedResponseStatusEnum].
class AgentSearchUsersToolDeniedResponseStatusEnumTypeTransformer {
  factory AgentSearchUsersToolDeniedResponseStatusEnumTypeTransformer() => _instance ??= const AgentSearchUsersToolDeniedResponseStatusEnumTypeTransformer._();

  const AgentSearchUsersToolDeniedResponseStatusEnumTypeTransformer._();

  String encode(AgentSearchUsersToolDeniedResponseStatusEnum data) => data.value;

  /// Decodes a [dynamic value][data] to a AgentSearchUsersToolDeniedResponseStatusEnum.
  ///
  /// If [allowNull] is true and the [dynamic value][data] cannot be decoded successfully,
  /// then null is returned. However, if [allowNull] is false and the [dynamic value][data]
  /// cannot be decoded successfully, then an [UnimplementedError] is thrown.
  ///
  /// The [allowNull] is very handy when an API changes and a new enum value is added or removed,
  /// and users are still using an old app with the old code.
  AgentSearchUsersToolDeniedResponseStatusEnum? decode(dynamic data, {bool allowNull = true}) {
    if (data != null) {
      switch (data) {
        case r'denied': return AgentSearchUsersToolDeniedResponseStatusEnum.denied;
        default:
          if (!allowNull) {
            throw ArgumentError('Unknown enum value to decode: $data');
          }
      }
    }
    return null;
  }

  /// Singleton [AgentSearchUsersToolDeniedResponseStatusEnumTypeTransformer] instance.
  static AgentSearchUsersToolDeniedResponseStatusEnumTypeTransformer? _instance;
}


