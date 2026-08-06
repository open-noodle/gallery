//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

class AgentSearchPeopleToolDeniedResponse {
  /// Returns a new [AgentSearchPeopleToolDeniedResponse] instance.
  AgentSearchPeopleToolDeniedResponse({
    required this.reason,
    required this.status,
    required this.toolCall,
  });

  String reason;

  AgentSearchPeopleToolDeniedResponseStatusEnum status;

  AgentToolCallResponseDto toolCall;

  @override
  bool operator ==(Object other) => identical(this, other) || other is AgentSearchPeopleToolDeniedResponse &&
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
  String toString() => 'AgentSearchPeopleToolDeniedResponse[reason=$reason, status=$status, toolCall=$toolCall]';

  Map<String, dynamic> toJson() {
    final json = <String, dynamic>{};
      json[r'reason'] = this.reason;
      json[r'status'] = this.status;
      json[r'toolCall'] = this.toolCall;
    return json;
  }

  /// Returns a new [AgentSearchPeopleToolDeniedResponse] instance and imports its values from
  /// [value] if it's a [Map], null otherwise.
  // ignore: prefer_constructors_over_static_methods
  static AgentSearchPeopleToolDeniedResponse? fromJson(dynamic value) {
    upgradeDto(value, "AgentSearchPeopleToolDeniedResponse");
    if (value is Map) {
      final json = value.cast<String, dynamic>();

      return AgentSearchPeopleToolDeniedResponse(
        reason: mapValueOfType<String>(json, r'reason')!,
        status: AgentSearchPeopleToolDeniedResponseStatusEnum.fromJson(json[r'status'])!,
        toolCall: AgentToolCallResponseDto.fromJson(json[r'toolCall'])!,
      );
    }
    return null;
  }

  static List<AgentSearchPeopleToolDeniedResponse> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <AgentSearchPeopleToolDeniedResponse>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = AgentSearchPeopleToolDeniedResponse.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }

  static Map<String, AgentSearchPeopleToolDeniedResponse> mapFromJson(dynamic json) {
    final map = <String, AgentSearchPeopleToolDeniedResponse>{};
    if (json is Map && json.isNotEmpty) {
      json = json.cast<String, dynamic>(); // ignore: parameter_assignments
      for (final entry in json.entries) {
        final value = AgentSearchPeopleToolDeniedResponse.fromJson(entry.value);
        if (value != null) {
          map[entry.key] = value;
        }
      }
    }
    return map;
  }

  // maps a json object with a list of AgentSearchPeopleToolDeniedResponse-objects as value to a dart map
  static Map<String, List<AgentSearchPeopleToolDeniedResponse>> mapListFromJson(dynamic json, {bool growable = false,}) {
    final map = <String, List<AgentSearchPeopleToolDeniedResponse>>{};
    if (json is Map && json.isNotEmpty) {
      // ignore: parameter_assignments
      json = json.cast<String, dynamic>();
      for (final entry in json.entries) {
        map[entry.key] = AgentSearchPeopleToolDeniedResponse.listFromJson(entry.value, growable: growable,);
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


class AgentSearchPeopleToolDeniedResponseStatusEnum {
  /// Instantiate a new enum with the provided [value].
  const AgentSearchPeopleToolDeniedResponseStatusEnum._(this.value);

  /// The underlying value of this enum member.
  final String value;

  @override
  String toString() => value;

  String toJson() => value;

  static const denied = AgentSearchPeopleToolDeniedResponseStatusEnum._(r'denied');

  /// List of all possible values in this [enum][AgentSearchPeopleToolDeniedResponseStatusEnum].
  static const values = <AgentSearchPeopleToolDeniedResponseStatusEnum>[
    denied,
  ];

  static AgentSearchPeopleToolDeniedResponseStatusEnum? fromJson(dynamic value) => AgentSearchPeopleToolDeniedResponseStatusEnumTypeTransformer().decode(value);

  static List<AgentSearchPeopleToolDeniedResponseStatusEnum> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <AgentSearchPeopleToolDeniedResponseStatusEnum>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = AgentSearchPeopleToolDeniedResponseStatusEnum.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }
}

/// Transformation class that can [encode] an instance of [AgentSearchPeopleToolDeniedResponseStatusEnum] to String,
/// and [decode] dynamic data back to [AgentSearchPeopleToolDeniedResponseStatusEnum].
class AgentSearchPeopleToolDeniedResponseStatusEnumTypeTransformer {
  factory AgentSearchPeopleToolDeniedResponseStatusEnumTypeTransformer() => _instance ??= const AgentSearchPeopleToolDeniedResponseStatusEnumTypeTransformer._();

  const AgentSearchPeopleToolDeniedResponseStatusEnumTypeTransformer._();

  String encode(AgentSearchPeopleToolDeniedResponseStatusEnum data) => data.value;

  /// Decodes a [dynamic value][data] to a AgentSearchPeopleToolDeniedResponseStatusEnum.
  ///
  /// If [allowNull] is true and the [dynamic value][data] cannot be decoded successfully,
  /// then null is returned. However, if [allowNull] is false and the [dynamic value][data]
  /// cannot be decoded successfully, then an [UnimplementedError] is thrown.
  ///
  /// The [allowNull] is very handy when an API changes and a new enum value is added or removed,
  /// and users are still using an old app with the old code.
  AgentSearchPeopleToolDeniedResponseStatusEnum? decode(dynamic data, {bool allowNull = true}) {
    if (data != null) {
      switch (data) {
        case r'denied': return AgentSearchPeopleToolDeniedResponseStatusEnum.denied;
        default:
          if (!allowNull) {
            throw ArgumentError('Unknown enum value to decode: $data');
          }
      }
    }
    return null;
  }

  /// Singleton [AgentSearchPeopleToolDeniedResponseStatusEnumTypeTransformer] instance.
  static AgentSearchPeopleToolDeniedResponseStatusEnumTypeTransformer? _instance;
}


