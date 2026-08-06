//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

class AgentReadSpaceToolSuccessResponse {
  /// Returns a new [AgentReadSpaceToolSuccessResponse] instance.
  AgentReadSpaceToolSuccessResponse({
    required this.resultSize,
    required this.space,
    required this.status,
    required this.toolCall,
  });

  AgentToolResultSize resultSize;

  AgentSpaceDetail space;

  AgentReadSpaceToolSuccessResponseStatusEnum status;

  AgentToolCallResponseDto toolCall;

  @override
  bool operator ==(Object other) => identical(this, other) || other is AgentReadSpaceToolSuccessResponse &&
    other.resultSize == resultSize &&
    other.space == space &&
    other.status == status &&
    other.toolCall == toolCall;

  @override
  int get hashCode =>
    // ignore: unnecessary_parenthesis
    (resultSize.hashCode) +
    (space.hashCode) +
    (status.hashCode) +
    (toolCall.hashCode);

  @override
  String toString() => 'AgentReadSpaceToolSuccessResponse[resultSize=$resultSize, space=$space, status=$status, toolCall=$toolCall]';

  Map<String, dynamic> toJson() {
    final json = <String, dynamic>{};
      json[r'resultSize'] = this.resultSize;
      json[r'space'] = this.space;
      json[r'status'] = this.status;
      json[r'toolCall'] = this.toolCall;
    return json;
  }

  /// Returns a new [AgentReadSpaceToolSuccessResponse] instance and imports its values from
  /// [value] if it's a [Map], null otherwise.
  // ignore: prefer_constructors_over_static_methods
  static AgentReadSpaceToolSuccessResponse? fromJson(dynamic value) {
    upgradeDto(value, "AgentReadSpaceToolSuccessResponse");
    if (value is Map) {
      final json = value.cast<String, dynamic>();

      return AgentReadSpaceToolSuccessResponse(
        resultSize: AgentToolResultSize.fromJson(json[r'resultSize'])!,
        space: AgentSpaceDetail.fromJson(json[r'space'])!,
        status: AgentReadSpaceToolSuccessResponseStatusEnum.fromJson(json[r'status'])!,
        toolCall: AgentToolCallResponseDto.fromJson(json[r'toolCall'])!,
      );
    }
    return null;
  }

  static List<AgentReadSpaceToolSuccessResponse> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <AgentReadSpaceToolSuccessResponse>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = AgentReadSpaceToolSuccessResponse.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }

  static Map<String, AgentReadSpaceToolSuccessResponse> mapFromJson(dynamic json) {
    final map = <String, AgentReadSpaceToolSuccessResponse>{};
    if (json is Map && json.isNotEmpty) {
      json = json.cast<String, dynamic>(); // ignore: parameter_assignments
      for (final entry in json.entries) {
        final value = AgentReadSpaceToolSuccessResponse.fromJson(entry.value);
        if (value != null) {
          map[entry.key] = value;
        }
      }
    }
    return map;
  }

  // maps a json object with a list of AgentReadSpaceToolSuccessResponse-objects as value to a dart map
  static Map<String, List<AgentReadSpaceToolSuccessResponse>> mapListFromJson(dynamic json, {bool growable = false,}) {
    final map = <String, List<AgentReadSpaceToolSuccessResponse>>{};
    if (json is Map && json.isNotEmpty) {
      // ignore: parameter_assignments
      json = json.cast<String, dynamic>();
      for (final entry in json.entries) {
        map[entry.key] = AgentReadSpaceToolSuccessResponse.listFromJson(entry.value, growable: growable,);
      }
    }
    return map;
  }

  /// The list of required keys that must be present in a JSON.
  static const requiredKeys = <String>{
    'resultSize',
    'space',
    'status',
    'toolCall',
  };
}


class AgentReadSpaceToolSuccessResponseStatusEnum {
  /// Instantiate a new enum with the provided [value].
  const AgentReadSpaceToolSuccessResponseStatusEnum._(this.value);

  /// The underlying value of this enum member.
  final String value;

  @override
  String toString() => value;

  String toJson() => value;

  static const success = AgentReadSpaceToolSuccessResponseStatusEnum._(r'success');

  /// List of all possible values in this [enum][AgentReadSpaceToolSuccessResponseStatusEnum].
  static const values = <AgentReadSpaceToolSuccessResponseStatusEnum>[
    success,
  ];

  static AgentReadSpaceToolSuccessResponseStatusEnum? fromJson(dynamic value) => AgentReadSpaceToolSuccessResponseStatusEnumTypeTransformer().decode(value);

  static List<AgentReadSpaceToolSuccessResponseStatusEnum> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <AgentReadSpaceToolSuccessResponseStatusEnum>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = AgentReadSpaceToolSuccessResponseStatusEnum.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }
}

/// Transformation class that can [encode] an instance of [AgentReadSpaceToolSuccessResponseStatusEnum] to String,
/// and [decode] dynamic data back to [AgentReadSpaceToolSuccessResponseStatusEnum].
class AgentReadSpaceToolSuccessResponseStatusEnumTypeTransformer {
  factory AgentReadSpaceToolSuccessResponseStatusEnumTypeTransformer() => _instance ??= const AgentReadSpaceToolSuccessResponseStatusEnumTypeTransformer._();

  const AgentReadSpaceToolSuccessResponseStatusEnumTypeTransformer._();

  String encode(AgentReadSpaceToolSuccessResponseStatusEnum data) => data.value;

  /// Decodes a [dynamic value][data] to a AgentReadSpaceToolSuccessResponseStatusEnum.
  ///
  /// If [allowNull] is true and the [dynamic value][data] cannot be decoded successfully,
  /// then null is returned. However, if [allowNull] is false and the [dynamic value][data]
  /// cannot be decoded successfully, then an [UnimplementedError] is thrown.
  ///
  /// The [allowNull] is very handy when an API changes and a new enum value is added or removed,
  /// and users are still using an old app with the old code.
  AgentReadSpaceToolSuccessResponseStatusEnum? decode(dynamic data, {bool allowNull = true}) {
    if (data != null) {
      switch (data) {
        case r'success': return AgentReadSpaceToolSuccessResponseStatusEnum.success;
        default:
          if (!allowNull) {
            throw ArgumentError('Unknown enum value to decode: $data');
          }
      }
    }
    return null;
  }

  /// Singleton [AgentReadSpaceToolSuccessResponseStatusEnumTypeTransformer] instance.
  static AgentReadSpaceToolSuccessResponseStatusEnumTypeTransformer? _instance;
}


