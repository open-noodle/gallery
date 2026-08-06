//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

class AgentReadAlbumToolDeniedResponse {
  /// Returns a new [AgentReadAlbumToolDeniedResponse] instance.
  AgentReadAlbumToolDeniedResponse({
    required this.reason,
    required this.status,
    required this.toolCall,
  });

  String reason;

  AgentReadAlbumToolDeniedResponseStatusEnum status;

  AgentToolCallResponseDto toolCall;

  @override
  bool operator ==(Object other) => identical(this, other) || other is AgentReadAlbumToolDeniedResponse &&
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
  String toString() => 'AgentReadAlbumToolDeniedResponse[reason=$reason, status=$status, toolCall=$toolCall]';

  Map<String, dynamic> toJson() {
    final json = <String, dynamic>{};
      json[r'reason'] = this.reason;
      json[r'status'] = this.status;
      json[r'toolCall'] = this.toolCall;
    return json;
  }

  /// Returns a new [AgentReadAlbumToolDeniedResponse] instance and imports its values from
  /// [value] if it's a [Map], null otherwise.
  // ignore: prefer_constructors_over_static_methods
  static AgentReadAlbumToolDeniedResponse? fromJson(dynamic value) {
    upgradeDto(value, "AgentReadAlbumToolDeniedResponse");
    if (value is Map) {
      final json = value.cast<String, dynamic>();

      return AgentReadAlbumToolDeniedResponse(
        reason: mapValueOfType<String>(json, r'reason')!,
        status: AgentReadAlbumToolDeniedResponseStatusEnum.fromJson(json[r'status'])!,
        toolCall: AgentToolCallResponseDto.fromJson(json[r'toolCall'])!,
      );
    }
    return null;
  }

  static List<AgentReadAlbumToolDeniedResponse> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <AgentReadAlbumToolDeniedResponse>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = AgentReadAlbumToolDeniedResponse.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }

  static Map<String, AgentReadAlbumToolDeniedResponse> mapFromJson(dynamic json) {
    final map = <String, AgentReadAlbumToolDeniedResponse>{};
    if (json is Map && json.isNotEmpty) {
      json = json.cast<String, dynamic>(); // ignore: parameter_assignments
      for (final entry in json.entries) {
        final value = AgentReadAlbumToolDeniedResponse.fromJson(entry.value);
        if (value != null) {
          map[entry.key] = value;
        }
      }
    }
    return map;
  }

  // maps a json object with a list of AgentReadAlbumToolDeniedResponse-objects as value to a dart map
  static Map<String, List<AgentReadAlbumToolDeniedResponse>> mapListFromJson(dynamic json, {bool growable = false,}) {
    final map = <String, List<AgentReadAlbumToolDeniedResponse>>{};
    if (json is Map && json.isNotEmpty) {
      // ignore: parameter_assignments
      json = json.cast<String, dynamic>();
      for (final entry in json.entries) {
        map[entry.key] = AgentReadAlbumToolDeniedResponse.listFromJson(entry.value, growable: growable,);
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


class AgentReadAlbumToolDeniedResponseStatusEnum {
  /// Instantiate a new enum with the provided [value].
  const AgentReadAlbumToolDeniedResponseStatusEnum._(this.value);

  /// The underlying value of this enum member.
  final String value;

  @override
  String toString() => value;

  String toJson() => value;

  static const denied = AgentReadAlbumToolDeniedResponseStatusEnum._(r'denied');

  /// List of all possible values in this [enum][AgentReadAlbumToolDeniedResponseStatusEnum].
  static const values = <AgentReadAlbumToolDeniedResponseStatusEnum>[
    denied,
  ];

  static AgentReadAlbumToolDeniedResponseStatusEnum? fromJson(dynamic value) => AgentReadAlbumToolDeniedResponseStatusEnumTypeTransformer().decode(value);

  static List<AgentReadAlbumToolDeniedResponseStatusEnum> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <AgentReadAlbumToolDeniedResponseStatusEnum>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = AgentReadAlbumToolDeniedResponseStatusEnum.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }
}

/// Transformation class that can [encode] an instance of [AgentReadAlbumToolDeniedResponseStatusEnum] to String,
/// and [decode] dynamic data back to [AgentReadAlbumToolDeniedResponseStatusEnum].
class AgentReadAlbumToolDeniedResponseStatusEnumTypeTransformer {
  factory AgentReadAlbumToolDeniedResponseStatusEnumTypeTransformer() => _instance ??= const AgentReadAlbumToolDeniedResponseStatusEnumTypeTransformer._();

  const AgentReadAlbumToolDeniedResponseStatusEnumTypeTransformer._();

  String encode(AgentReadAlbumToolDeniedResponseStatusEnum data) => data.value;

  /// Decodes a [dynamic value][data] to a AgentReadAlbumToolDeniedResponseStatusEnum.
  ///
  /// If [allowNull] is true and the [dynamic value][data] cannot be decoded successfully,
  /// then null is returned. However, if [allowNull] is false and the [dynamic value][data]
  /// cannot be decoded successfully, then an [UnimplementedError] is thrown.
  ///
  /// The [allowNull] is very handy when an API changes and a new enum value is added or removed,
  /// and users are still using an old app with the old code.
  AgentReadAlbumToolDeniedResponseStatusEnum? decode(dynamic data, {bool allowNull = true}) {
    if (data != null) {
      switch (data) {
        case r'denied': return AgentReadAlbumToolDeniedResponseStatusEnum.denied;
        default:
          if (!allowNull) {
            throw ArgumentError('Unknown enum value to decode: $data');
          }
      }
    }
    return null;
  }

  /// Singleton [AgentReadAlbumToolDeniedResponseStatusEnumTypeTransformer] instance.
  static AgentReadAlbumToolDeniedResponseStatusEnumTypeTransformer? _instance;
}


