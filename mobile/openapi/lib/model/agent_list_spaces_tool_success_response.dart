//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

class AgentListSpacesToolSuccessResponse {
  /// Returns a new [AgentListSpacesToolSuccessResponse] instance.
  AgentListSpacesToolSuccessResponse({
    required this.resultSize,
    this.spaces = const [],
    required this.status,
    required this.toolCall,
  });

  AgentToolResultSize resultSize;

  List<AgentSpaceSummary> spaces;

  AgentListSpacesToolSuccessResponseStatusEnum status;

  AgentToolCallResponseDto toolCall;

  @override
  bool operator ==(Object other) => identical(this, other) || other is AgentListSpacesToolSuccessResponse &&
    other.resultSize == resultSize &&
    _deepEquality.equals(other.spaces, spaces) &&
    other.status == status &&
    other.toolCall == toolCall;

  @override
  int get hashCode =>
    // ignore: unnecessary_parenthesis
    (resultSize.hashCode) +
    (spaces.hashCode) +
    (status.hashCode) +
    (toolCall.hashCode);

  @override
  String toString() => 'AgentListSpacesToolSuccessResponse[resultSize=$resultSize, spaces=$spaces, status=$status, toolCall=$toolCall]';

  Map<String, dynamic> toJson() {
    final json = <String, dynamic>{};
      json[r'resultSize'] = this.resultSize;
      json[r'spaces'] = this.spaces;
      json[r'status'] = this.status;
      json[r'toolCall'] = this.toolCall;
    return json;
  }

  /// Returns a new [AgentListSpacesToolSuccessResponse] instance and imports its values from
  /// [value] if it's a [Map], null otherwise.
  // ignore: prefer_constructors_over_static_methods
  static AgentListSpacesToolSuccessResponse? fromJson(dynamic value) {
    upgradeDto(value, "AgentListSpacesToolSuccessResponse");
    if (value is Map) {
      final json = value.cast<String, dynamic>();

      return AgentListSpacesToolSuccessResponse(
        resultSize: AgentToolResultSize.fromJson(json[r'resultSize'])!,
        spaces: AgentSpaceSummary.listFromJson(json[r'spaces']),
        status: AgentListSpacesToolSuccessResponseStatusEnum.fromJson(json[r'status'])!,
        toolCall: AgentToolCallResponseDto.fromJson(json[r'toolCall'])!,
      );
    }
    return null;
  }

  static List<AgentListSpacesToolSuccessResponse> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <AgentListSpacesToolSuccessResponse>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = AgentListSpacesToolSuccessResponse.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }

  static Map<String, AgentListSpacesToolSuccessResponse> mapFromJson(dynamic json) {
    final map = <String, AgentListSpacesToolSuccessResponse>{};
    if (json is Map && json.isNotEmpty) {
      json = json.cast<String, dynamic>(); // ignore: parameter_assignments
      for (final entry in json.entries) {
        final value = AgentListSpacesToolSuccessResponse.fromJson(entry.value);
        if (value != null) {
          map[entry.key] = value;
        }
      }
    }
    return map;
  }

  // maps a json object with a list of AgentListSpacesToolSuccessResponse-objects as value to a dart map
  static Map<String, List<AgentListSpacesToolSuccessResponse>> mapListFromJson(dynamic json, {bool growable = false,}) {
    final map = <String, List<AgentListSpacesToolSuccessResponse>>{};
    if (json is Map && json.isNotEmpty) {
      // ignore: parameter_assignments
      json = json.cast<String, dynamic>();
      for (final entry in json.entries) {
        map[entry.key] = AgentListSpacesToolSuccessResponse.listFromJson(entry.value, growable: growable,);
      }
    }
    return map;
  }

  /// The list of required keys that must be present in a JSON.
  static const requiredKeys = <String>{
    'resultSize',
    'spaces',
    'status',
    'toolCall',
  };
}


class AgentListSpacesToolSuccessResponseStatusEnum {
  /// Instantiate a new enum with the provided [value].
  const AgentListSpacesToolSuccessResponseStatusEnum._(this.value);

  /// The underlying value of this enum member.
  final String value;

  @override
  String toString() => value;

  String toJson() => value;

  static const success = AgentListSpacesToolSuccessResponseStatusEnum._(r'success');

  /// List of all possible values in this [enum][AgentListSpacesToolSuccessResponseStatusEnum].
  static const values = <AgentListSpacesToolSuccessResponseStatusEnum>[
    success,
  ];

  static AgentListSpacesToolSuccessResponseStatusEnum? fromJson(dynamic value) => AgentListSpacesToolSuccessResponseStatusEnumTypeTransformer().decode(value);

  static List<AgentListSpacesToolSuccessResponseStatusEnum> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <AgentListSpacesToolSuccessResponseStatusEnum>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = AgentListSpacesToolSuccessResponseStatusEnum.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }
}

/// Transformation class that can [encode] an instance of [AgentListSpacesToolSuccessResponseStatusEnum] to String,
/// and [decode] dynamic data back to [AgentListSpacesToolSuccessResponseStatusEnum].
class AgentListSpacesToolSuccessResponseStatusEnumTypeTransformer {
  factory AgentListSpacesToolSuccessResponseStatusEnumTypeTransformer() => _instance ??= const AgentListSpacesToolSuccessResponseStatusEnumTypeTransformer._();

  const AgentListSpacesToolSuccessResponseStatusEnumTypeTransformer._();

  String encode(AgentListSpacesToolSuccessResponseStatusEnum data) => data.value;

  /// Decodes a [dynamic value][data] to a AgentListSpacesToolSuccessResponseStatusEnum.
  ///
  /// If [allowNull] is true and the [dynamic value][data] cannot be decoded successfully,
  /// then null is returned. However, if [allowNull] is false and the [dynamic value][data]
  /// cannot be decoded successfully, then an [UnimplementedError] is thrown.
  ///
  /// The [allowNull] is very handy when an API changes and a new enum value is added or removed,
  /// and users are still using an old app with the old code.
  AgentListSpacesToolSuccessResponseStatusEnum? decode(dynamic data, {bool allowNull = true}) {
    if (data != null) {
      switch (data) {
        case r'success': return AgentListSpacesToolSuccessResponseStatusEnum.success;
        default:
          if (!allowNull) {
            throw ArgumentError('Unknown enum value to decode: $data');
          }
      }
    }
    return null;
  }

  /// Singleton [AgentListSpacesToolSuccessResponseStatusEnumTypeTransformer] instance.
  static AgentListSpacesToolSuccessResponseStatusEnumTypeTransformer? _instance;
}


