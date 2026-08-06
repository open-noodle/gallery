//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

class AgentSearchPeopleToolSuccessResponse {
  /// Returns a new [AgentSearchPeopleToolSuccessResponse] instance.
  AgentSearchPeopleToolSuccessResponse({
    required this.people,
    required this.resultSize,
    required this.status,
    required this.toolCall,
  });

  AgentSearchPeopleResult people;

  AgentToolResultSize resultSize;

  AgentSearchPeopleToolSuccessResponseStatusEnum status;

  AgentToolCallResponseDto toolCall;

  @override
  bool operator ==(Object other) => identical(this, other) || other is AgentSearchPeopleToolSuccessResponse &&
    other.people == people &&
    other.resultSize == resultSize &&
    other.status == status &&
    other.toolCall == toolCall;

  @override
  int get hashCode =>
    // ignore: unnecessary_parenthesis
    (people.hashCode) +
    (resultSize.hashCode) +
    (status.hashCode) +
    (toolCall.hashCode);

  @override
  String toString() => 'AgentSearchPeopleToolSuccessResponse[people=$people, resultSize=$resultSize, status=$status, toolCall=$toolCall]';

  Map<String, dynamic> toJson() {
    final json = <String, dynamic>{};
      json[r'people'] = this.people;
      json[r'resultSize'] = this.resultSize;
      json[r'status'] = this.status;
      json[r'toolCall'] = this.toolCall;
    return json;
  }

  /// Returns a new [AgentSearchPeopleToolSuccessResponse] instance and imports its values from
  /// [value] if it's a [Map], null otherwise.
  // ignore: prefer_constructors_over_static_methods
  static AgentSearchPeopleToolSuccessResponse? fromJson(dynamic value) {
    upgradeDto(value, "AgentSearchPeopleToolSuccessResponse");
    if (value is Map) {
      final json = value.cast<String, dynamic>();

      return AgentSearchPeopleToolSuccessResponse(
        people: AgentSearchPeopleResult.fromJson(json[r'people'])!,
        resultSize: AgentToolResultSize.fromJson(json[r'resultSize'])!,
        status: AgentSearchPeopleToolSuccessResponseStatusEnum.fromJson(json[r'status'])!,
        toolCall: AgentToolCallResponseDto.fromJson(json[r'toolCall'])!,
      );
    }
    return null;
  }

  static List<AgentSearchPeopleToolSuccessResponse> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <AgentSearchPeopleToolSuccessResponse>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = AgentSearchPeopleToolSuccessResponse.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }

  static Map<String, AgentSearchPeopleToolSuccessResponse> mapFromJson(dynamic json) {
    final map = <String, AgentSearchPeopleToolSuccessResponse>{};
    if (json is Map && json.isNotEmpty) {
      json = json.cast<String, dynamic>(); // ignore: parameter_assignments
      for (final entry in json.entries) {
        final value = AgentSearchPeopleToolSuccessResponse.fromJson(entry.value);
        if (value != null) {
          map[entry.key] = value;
        }
      }
    }
    return map;
  }

  // maps a json object with a list of AgentSearchPeopleToolSuccessResponse-objects as value to a dart map
  static Map<String, List<AgentSearchPeopleToolSuccessResponse>> mapListFromJson(dynamic json, {bool growable = false,}) {
    final map = <String, List<AgentSearchPeopleToolSuccessResponse>>{};
    if (json is Map && json.isNotEmpty) {
      // ignore: parameter_assignments
      json = json.cast<String, dynamic>();
      for (final entry in json.entries) {
        map[entry.key] = AgentSearchPeopleToolSuccessResponse.listFromJson(entry.value, growable: growable,);
      }
    }
    return map;
  }

  /// The list of required keys that must be present in a JSON.
  static const requiredKeys = <String>{
    'people',
    'resultSize',
    'status',
    'toolCall',
  };
}


class AgentSearchPeopleToolSuccessResponseStatusEnum {
  /// Instantiate a new enum with the provided [value].
  const AgentSearchPeopleToolSuccessResponseStatusEnum._(this.value);

  /// The underlying value of this enum member.
  final String value;

  @override
  String toString() => value;

  String toJson() => value;

  static const success = AgentSearchPeopleToolSuccessResponseStatusEnum._(r'success');

  /// List of all possible values in this [enum][AgentSearchPeopleToolSuccessResponseStatusEnum].
  static const values = <AgentSearchPeopleToolSuccessResponseStatusEnum>[
    success,
  ];

  static AgentSearchPeopleToolSuccessResponseStatusEnum? fromJson(dynamic value) => AgentSearchPeopleToolSuccessResponseStatusEnumTypeTransformer().decode(value);

  static List<AgentSearchPeopleToolSuccessResponseStatusEnum> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <AgentSearchPeopleToolSuccessResponseStatusEnum>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = AgentSearchPeopleToolSuccessResponseStatusEnum.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }
}

/// Transformation class that can [encode] an instance of [AgentSearchPeopleToolSuccessResponseStatusEnum] to String,
/// and [decode] dynamic data back to [AgentSearchPeopleToolSuccessResponseStatusEnum].
class AgentSearchPeopleToolSuccessResponseStatusEnumTypeTransformer {
  factory AgentSearchPeopleToolSuccessResponseStatusEnumTypeTransformer() => _instance ??= const AgentSearchPeopleToolSuccessResponseStatusEnumTypeTransformer._();

  const AgentSearchPeopleToolSuccessResponseStatusEnumTypeTransformer._();

  String encode(AgentSearchPeopleToolSuccessResponseStatusEnum data) => data.value;

  /// Decodes a [dynamic value][data] to a AgentSearchPeopleToolSuccessResponseStatusEnum.
  ///
  /// If [allowNull] is true and the [dynamic value][data] cannot be decoded successfully,
  /// then null is returned. However, if [allowNull] is false and the [dynamic value][data]
  /// cannot be decoded successfully, then an [UnimplementedError] is thrown.
  ///
  /// The [allowNull] is very handy when an API changes and a new enum value is added or removed,
  /// and users are still using an old app with the old code.
  AgentSearchPeopleToolSuccessResponseStatusEnum? decode(dynamic data, {bool allowNull = true}) {
    if (data != null) {
      switch (data) {
        case r'success': return AgentSearchPeopleToolSuccessResponseStatusEnum.success;
        default:
          if (!allowNull) {
            throw ArgumentError('Unknown enum value to decode: $data');
          }
      }
    }
    return null;
  }

  /// Singleton [AgentSearchPeopleToolSuccessResponseStatusEnumTypeTransformer] instance.
  static AgentSearchPeopleToolSuccessResponseStatusEnumTypeTransformer? _instance;
}


