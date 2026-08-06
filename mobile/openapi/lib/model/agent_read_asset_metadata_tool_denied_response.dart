//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

class AgentReadAssetMetadataToolDeniedResponse {
  /// Returns a new [AgentReadAssetMetadataToolDeniedResponse] instance.
  AgentReadAssetMetadataToolDeniedResponse({
    required this.reason,
    required this.status,
    required this.toolCall,
  });

  String reason;

  AgentReadAssetMetadataToolDeniedResponseStatusEnum status;

  AgentToolCallResponseDto toolCall;

  @override
  bool operator ==(Object other) => identical(this, other) || other is AgentReadAssetMetadataToolDeniedResponse &&
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
  String toString() => 'AgentReadAssetMetadataToolDeniedResponse[reason=$reason, status=$status, toolCall=$toolCall]';

  Map<String, dynamic> toJson() {
    final json = <String, dynamic>{};
      json[r'reason'] = this.reason;
      json[r'status'] = this.status;
      json[r'toolCall'] = this.toolCall;
    return json;
  }

  /// Returns a new [AgentReadAssetMetadataToolDeniedResponse] instance and imports its values from
  /// [value] if it's a [Map], null otherwise.
  // ignore: prefer_constructors_over_static_methods
  static AgentReadAssetMetadataToolDeniedResponse? fromJson(dynamic value) {
    upgradeDto(value, "AgentReadAssetMetadataToolDeniedResponse");
    if (value is Map) {
      final json = value.cast<String, dynamic>();

      return AgentReadAssetMetadataToolDeniedResponse(
        reason: mapValueOfType<String>(json, r'reason')!,
        status: AgentReadAssetMetadataToolDeniedResponseStatusEnum.fromJson(json[r'status'])!,
        toolCall: AgentToolCallResponseDto.fromJson(json[r'toolCall'])!,
      );
    }
    return null;
  }

  static List<AgentReadAssetMetadataToolDeniedResponse> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <AgentReadAssetMetadataToolDeniedResponse>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = AgentReadAssetMetadataToolDeniedResponse.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }

  static Map<String, AgentReadAssetMetadataToolDeniedResponse> mapFromJson(dynamic json) {
    final map = <String, AgentReadAssetMetadataToolDeniedResponse>{};
    if (json is Map && json.isNotEmpty) {
      json = json.cast<String, dynamic>(); // ignore: parameter_assignments
      for (final entry in json.entries) {
        final value = AgentReadAssetMetadataToolDeniedResponse.fromJson(entry.value);
        if (value != null) {
          map[entry.key] = value;
        }
      }
    }
    return map;
  }

  // maps a json object with a list of AgentReadAssetMetadataToolDeniedResponse-objects as value to a dart map
  static Map<String, List<AgentReadAssetMetadataToolDeniedResponse>> mapListFromJson(dynamic json, {bool growable = false,}) {
    final map = <String, List<AgentReadAssetMetadataToolDeniedResponse>>{};
    if (json is Map && json.isNotEmpty) {
      // ignore: parameter_assignments
      json = json.cast<String, dynamic>();
      for (final entry in json.entries) {
        map[entry.key] = AgentReadAssetMetadataToolDeniedResponse.listFromJson(entry.value, growable: growable,);
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


enum AgentReadAssetMetadataToolDeniedResponseStatusEnum {
  denied._(r'denied'),
  ;

  /// Instantiate a new enum with the provided value.
  const AgentReadAssetMetadataToolDeniedResponseStatusEnum._(this._value);

  /// The underlying value of this enum member.
  final String _value;

  @override
  String toString() => _value;

  /// Encodes this enum as a value suitable for JSON.
  String toJson() => _value;

  /// Returns the instance of [AgentReadAssetMetadataToolDeniedResponseStatusEnum] that was successfully decoded
  /// from the passed [value] on success, null otherwise.
  static AgentReadAssetMetadataToolDeniedResponseStatusEnum? fromJson(dynamic value) => AgentReadAssetMetadataToolDeniedResponseStatusEnumTypeTransformer().decode(value);

  /// Returns a [List] containing instances of [AgentReadAssetMetadataToolDeniedResponseStatusEnum]
  /// that were successfully decoded from the passed [JSON][json].
  static List<AgentReadAssetMetadataToolDeniedResponseStatusEnum> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <AgentReadAssetMetadataToolDeniedResponseStatusEnum>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = AgentReadAssetMetadataToolDeniedResponseStatusEnum.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }
}

/// Transformation class that can [encode] an instance of [AgentReadAssetMetadataToolDeniedResponseStatusEnum] to String,
/// and [decode] dynamic data back to [AgentReadAssetMetadataToolDeniedResponseStatusEnum].
class AgentReadAssetMetadataToolDeniedResponseStatusEnumTypeTransformer {
  factory AgentReadAssetMetadataToolDeniedResponseStatusEnumTypeTransformer() => _instance ??= const AgentReadAssetMetadataToolDeniedResponseStatusEnumTypeTransformer._();

  const AgentReadAssetMetadataToolDeniedResponseStatusEnumTypeTransformer._();

  String encode(AgentReadAssetMetadataToolDeniedResponseStatusEnum data) => data._value;

  /// Returns the instance of [AgentReadAssetMetadataToolDeniedResponseStatusEnum] that was successfully decoded
  /// from the passed [data] value on success, null otherwise.
  ///
  /// If [allowNull] is true and the [dynamic value][data] cannot be decoded successfully,
  /// then null is returned. However, if [allowNull] is false and the [dynamic value][data]
  /// cannot be decoded successfully, then an [UnimplementedError] is thrown.
  ///
  /// The [allowNull] is very handy when an API changes and a new enum value is added or removed,
  /// and users are still using an old app with the old code.
  AgentReadAssetMetadataToolDeniedResponseStatusEnum? decode(dynamic data, {bool allowNull = true}) {
    if (data is AgentReadAssetMetadataToolDeniedResponseStatusEnum) {
      return data;
    }
    if (data != null) {
      switch (data) {
        case r'denied': return AgentReadAssetMetadataToolDeniedResponseStatusEnum.denied;
        default:
          if (!allowNull) {
            throw ArgumentError('Unknown enum value to decode: $data');
          }
      }
    }
    return null;
  }

  /// The singleton instance of this transformer.
  static AgentReadAssetMetadataToolDeniedResponseStatusEnumTypeTransformer? _instance;
}


