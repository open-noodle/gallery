//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

class AgentSearchUsersToolSuccessResponse {
  /// Returns a new [AgentSearchUsersToolSuccessResponse] instance.
  AgentSearchUsersToolSuccessResponse({
    required this.resultSize,
    required this.status,
    required this.toolCall,
    this.users = const [],
  });

  AgentToolResultSize resultSize;

  AgentSearchUsersToolSuccessResponseStatusEnum status;

  AgentToolCallResponseDto toolCall;

  List<AgentUserLookupResult> users;

  @override
  bool operator ==(Object other) => identical(this, other) || other is AgentSearchUsersToolSuccessResponse &&
    other.resultSize == resultSize &&
    other.status == status &&
    other.toolCall == toolCall &&
    _deepEquality.equals(other.users, users);

  @override
  int get hashCode =>
    // ignore: unnecessary_parenthesis
    (resultSize.hashCode) +
    (status.hashCode) +
    (toolCall.hashCode) +
    (users.hashCode);

  @override
  String toString() => 'AgentSearchUsersToolSuccessResponse[resultSize=$resultSize, status=$status, toolCall=$toolCall, users=$users]';

  Map<String, dynamic> toJson() {
    final json = <String, dynamic>{};
      json[r'resultSize'] = this.resultSize;
      json[r'status'] = this.status;
      json[r'toolCall'] = this.toolCall;
      json[r'users'] = this.users;
    return json;
  }

  /// Returns a new [AgentSearchUsersToolSuccessResponse] instance and imports its values from
  /// [value] if it's a [Map], null otherwise.
  // ignore: prefer_constructors_over_static_methods
  static AgentSearchUsersToolSuccessResponse? fromJson(dynamic value) {
    upgradeDto(value, "AgentSearchUsersToolSuccessResponse");
    if (value is Map) {
      final json = value.cast<String, dynamic>();

      return AgentSearchUsersToolSuccessResponse(
        resultSize: AgentToolResultSize.fromJson(json[r'resultSize'])!,
        status: AgentSearchUsersToolSuccessResponseStatusEnum.fromJson(json[r'status'])!,
        toolCall: AgentToolCallResponseDto.fromJson(json[r'toolCall'])!,
        users: AgentUserLookupResult.listFromJson(json[r'users']),
      );
    }
    return null;
  }

  static List<AgentSearchUsersToolSuccessResponse> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <AgentSearchUsersToolSuccessResponse>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = AgentSearchUsersToolSuccessResponse.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }

  static Map<String, AgentSearchUsersToolSuccessResponse> mapFromJson(dynamic json) {
    final map = <String, AgentSearchUsersToolSuccessResponse>{};
    if (json is Map && json.isNotEmpty) {
      json = json.cast<String, dynamic>(); // ignore: parameter_assignments
      for (final entry in json.entries) {
        final value = AgentSearchUsersToolSuccessResponse.fromJson(entry.value);
        if (value != null) {
          map[entry.key] = value;
        }
      }
    }
    return map;
  }

  // maps a json object with a list of AgentSearchUsersToolSuccessResponse-objects as value to a dart map
  static Map<String, List<AgentSearchUsersToolSuccessResponse>> mapListFromJson(dynamic json, {bool growable = false,}) {
    final map = <String, List<AgentSearchUsersToolSuccessResponse>>{};
    if (json is Map && json.isNotEmpty) {
      // ignore: parameter_assignments
      json = json.cast<String, dynamic>();
      for (final entry in json.entries) {
        map[entry.key] = AgentSearchUsersToolSuccessResponse.listFromJson(entry.value, growable: growable,);
      }
    }
    return map;
  }

  /// The list of required keys that must be present in a JSON.
  static const requiredKeys = <String>{
    'resultSize',
    'status',
    'toolCall',
    'users',
  };
}


enum AgentSearchUsersToolSuccessResponseStatusEnum {
  success._(r'success'),
  ;

  /// Instantiate a new enum with the provided value.
  const AgentSearchUsersToolSuccessResponseStatusEnum._(this._value);

  /// The underlying value of this enum member.
  final String _value;

  @override
  String toString() => _value;

  /// Encodes this enum as a value suitable for JSON.
  String toJson() => _value;

  /// Returns the instance of [AgentSearchUsersToolSuccessResponseStatusEnum] that was successfully decoded
  /// from the passed [value] on success, null otherwise.
  static AgentSearchUsersToolSuccessResponseStatusEnum? fromJson(dynamic value) => AgentSearchUsersToolSuccessResponseStatusEnumTypeTransformer().decode(value);

  /// Returns a [List] containing instances of [AgentSearchUsersToolSuccessResponseStatusEnum]
  /// that were successfully decoded from the passed [JSON][json].
  static List<AgentSearchUsersToolSuccessResponseStatusEnum> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <AgentSearchUsersToolSuccessResponseStatusEnum>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = AgentSearchUsersToolSuccessResponseStatusEnum.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }
}

/// Transformation class that can [encode] an instance of [AgentSearchUsersToolSuccessResponseStatusEnum] to String,
/// and [decode] dynamic data back to [AgentSearchUsersToolSuccessResponseStatusEnum].
class AgentSearchUsersToolSuccessResponseStatusEnumTypeTransformer {
  factory AgentSearchUsersToolSuccessResponseStatusEnumTypeTransformer() => _instance ??= const AgentSearchUsersToolSuccessResponseStatusEnumTypeTransformer._();

  const AgentSearchUsersToolSuccessResponseStatusEnumTypeTransformer._();

  String encode(AgentSearchUsersToolSuccessResponseStatusEnum data) => data._value;

  /// Returns the instance of [AgentSearchUsersToolSuccessResponseStatusEnum] that was successfully decoded
  /// from the passed [data] value on success, null otherwise.
  ///
  /// If [allowNull] is true and the [dynamic value][data] cannot be decoded successfully,
  /// then null is returned. However, if [allowNull] is false and the [dynamic value][data]
  /// cannot be decoded successfully, then an [UnimplementedError] is thrown.
  ///
  /// The [allowNull] is very handy when an API changes and a new enum value is added or removed,
  /// and users are still using an old app with the old code.
  AgentSearchUsersToolSuccessResponseStatusEnum? decode(dynamic data, {bool allowNull = true}) {
    if (data is AgentSearchUsersToolSuccessResponseStatusEnum) {
      return data;
    }
    if (data != null) {
      switch (data) {
        case r'success': return AgentSearchUsersToolSuccessResponseStatusEnum.success;
        default:
          if (!allowNull) {
            throw ArgumentError('Unknown enum value to decode: $data');
          }
      }
    }
    return null;
  }

  /// The singleton instance of this transformer.
  static AgentSearchUsersToolSuccessResponseStatusEnumTypeTransformer? _instance;
}


