//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

class AgentListAlbumsToolDeniedResponse {
  /// Returns a new [AgentListAlbumsToolDeniedResponse] instance.
  AgentListAlbumsToolDeniedResponse({
    required this.reason,
    required this.status,
    required this.toolCall,
  });

  String reason;

  AgentListAlbumsToolDeniedResponseStatusEnum status;

  AgentToolCallResponseDto toolCall;

  @override
  bool operator ==(Object other) => identical(this, other) || other is AgentListAlbumsToolDeniedResponse &&
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
  String toString() => 'AgentListAlbumsToolDeniedResponse[reason=$reason, status=$status, toolCall=$toolCall]';

  Map<String, dynamic> toJson() {
    final json = <String, dynamic>{};
      json[r'reason'] = this.reason;
      json[r'status'] = this.status;
      json[r'toolCall'] = this.toolCall;
    return json;
  }

  /// Returns a new [AgentListAlbumsToolDeniedResponse] instance and imports its values from
  /// [value] if it's a [Map], null otherwise.
  // ignore: prefer_constructors_over_static_methods
  static AgentListAlbumsToolDeniedResponse? fromJson(dynamic value) {
    upgradeDto(value, "AgentListAlbumsToolDeniedResponse");
    if (value is Map) {
      final json = value.cast<String, dynamic>();

      return AgentListAlbumsToolDeniedResponse(
        reason: mapValueOfType<String>(json, r'reason')!,
        status: AgentListAlbumsToolDeniedResponseStatusEnum.fromJson(json[r'status'])!,
        toolCall: AgentToolCallResponseDto.fromJson(json[r'toolCall'])!,
      );
    }
    return null;
  }

  static List<AgentListAlbumsToolDeniedResponse> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <AgentListAlbumsToolDeniedResponse>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = AgentListAlbumsToolDeniedResponse.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }

  static Map<String, AgentListAlbumsToolDeniedResponse> mapFromJson(dynamic json) {
    final map = <String, AgentListAlbumsToolDeniedResponse>{};
    if (json is Map && json.isNotEmpty) {
      json = json.cast<String, dynamic>(); // ignore: parameter_assignments
      for (final entry in json.entries) {
        final value = AgentListAlbumsToolDeniedResponse.fromJson(entry.value);
        if (value != null) {
          map[entry.key] = value;
        }
      }
    }
    return map;
  }

  // maps a json object with a list of AgentListAlbumsToolDeniedResponse-objects as value to a dart map
  static Map<String, List<AgentListAlbumsToolDeniedResponse>> mapListFromJson(dynamic json, {bool growable = false,}) {
    final map = <String, List<AgentListAlbumsToolDeniedResponse>>{};
    if (json is Map && json.isNotEmpty) {
      // ignore: parameter_assignments
      json = json.cast<String, dynamic>();
      for (final entry in json.entries) {
        map[entry.key] = AgentListAlbumsToolDeniedResponse.listFromJson(entry.value, growable: growable,);
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


class AgentListAlbumsToolDeniedResponseStatusEnum {
  /// Instantiate a new enum with the provided [value].
  const AgentListAlbumsToolDeniedResponseStatusEnum._(this.value);

  /// The underlying value of this enum member.
  final String value;

  @override
  String toString() => value;

  String toJson() => value;

  static const denied = AgentListAlbumsToolDeniedResponseStatusEnum._(r'denied');

  /// List of all possible values in this [enum][AgentListAlbumsToolDeniedResponseStatusEnum].
  static const values = <AgentListAlbumsToolDeniedResponseStatusEnum>[
    denied,
  ];

  static AgentListAlbumsToolDeniedResponseStatusEnum? fromJson(dynamic value) => AgentListAlbumsToolDeniedResponseStatusEnumTypeTransformer().decode(value);

  static List<AgentListAlbumsToolDeniedResponseStatusEnum> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <AgentListAlbumsToolDeniedResponseStatusEnum>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = AgentListAlbumsToolDeniedResponseStatusEnum.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }
}

/// Transformation class that can [encode] an instance of [AgentListAlbumsToolDeniedResponseStatusEnum] to String,
/// and [decode] dynamic data back to [AgentListAlbumsToolDeniedResponseStatusEnum].
class AgentListAlbumsToolDeniedResponseStatusEnumTypeTransformer {
  factory AgentListAlbumsToolDeniedResponseStatusEnumTypeTransformer() => _instance ??= const AgentListAlbumsToolDeniedResponseStatusEnumTypeTransformer._();

  const AgentListAlbumsToolDeniedResponseStatusEnumTypeTransformer._();

  String encode(AgentListAlbumsToolDeniedResponseStatusEnum data) => data.value;

  /// Decodes a [dynamic value][data] to a AgentListAlbumsToolDeniedResponseStatusEnum.
  ///
  /// If [allowNull] is true and the [dynamic value][data] cannot be decoded successfully,
  /// then null is returned. However, if [allowNull] is false and the [dynamic value][data]
  /// cannot be decoded successfully, then an [UnimplementedError] is thrown.
  ///
  /// The [allowNull] is very handy when an API changes and a new enum value is added or removed,
  /// and users are still using an old app with the old code.
  AgentListAlbumsToolDeniedResponseStatusEnum? decode(dynamic data, {bool allowNull = true}) {
    if (data != null) {
      switch (data) {
        case r'denied': return AgentListAlbumsToolDeniedResponseStatusEnum.denied;
        default:
          if (!allowNull) {
            throw ArgumentError('Unknown enum value to decode: $data');
          }
      }
    }
    return null;
  }

  /// Singleton [AgentListAlbumsToolDeniedResponseStatusEnumTypeTransformer] instance.
  static AgentListAlbumsToolDeniedResponseStatusEnumTypeTransformer? _instance;
}


