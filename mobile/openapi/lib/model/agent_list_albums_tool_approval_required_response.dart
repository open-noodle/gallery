//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

class AgentListAlbumsToolApprovalRequiredResponse {
  /// Returns a new [AgentListAlbumsToolApprovalRequiredResponse] instance.
  AgentListAlbumsToolApprovalRequiredResponse({
    required this.status,
    required this.toolCall,
  });

  AgentListAlbumsToolApprovalRequiredResponseStatusEnum status;

  AgentToolCallResponseDto toolCall;

  @override
  bool operator ==(Object other) => identical(this, other) || other is AgentListAlbumsToolApprovalRequiredResponse &&
    other.status == status &&
    other.toolCall == toolCall;

  @override
  int get hashCode =>
    // ignore: unnecessary_parenthesis
    (status.hashCode) +
    (toolCall.hashCode);

  @override
  String toString() => 'AgentListAlbumsToolApprovalRequiredResponse[status=$status, toolCall=$toolCall]';

  Map<String, dynamic> toJson() {
    final json = <String, dynamic>{};
      json[r'status'] = this.status;
      json[r'toolCall'] = this.toolCall;
    return json;
  }

  /// Returns a new [AgentListAlbumsToolApprovalRequiredResponse] instance and imports its values from
  /// [value] if it's a [Map], null otherwise.
  // ignore: prefer_constructors_over_static_methods
  static AgentListAlbumsToolApprovalRequiredResponse? fromJson(dynamic value) {
    upgradeDto(value, "AgentListAlbumsToolApprovalRequiredResponse");
    if (value is Map) {
      final json = value.cast<String, dynamic>();

      return AgentListAlbumsToolApprovalRequiredResponse(
        status: AgentListAlbumsToolApprovalRequiredResponseStatusEnum.fromJson(json[r'status'])!,
        toolCall: AgentToolCallResponseDto.fromJson(json[r'toolCall'])!,
      );
    }
    return null;
  }

  static List<AgentListAlbumsToolApprovalRequiredResponse> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <AgentListAlbumsToolApprovalRequiredResponse>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = AgentListAlbumsToolApprovalRequiredResponse.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }

  static Map<String, AgentListAlbumsToolApprovalRequiredResponse> mapFromJson(dynamic json) {
    final map = <String, AgentListAlbumsToolApprovalRequiredResponse>{};
    if (json is Map && json.isNotEmpty) {
      json = json.cast<String, dynamic>(); // ignore: parameter_assignments
      for (final entry in json.entries) {
        final value = AgentListAlbumsToolApprovalRequiredResponse.fromJson(entry.value);
        if (value != null) {
          map[entry.key] = value;
        }
      }
    }
    return map;
  }

  // maps a json object with a list of AgentListAlbumsToolApprovalRequiredResponse-objects as value to a dart map
  static Map<String, List<AgentListAlbumsToolApprovalRequiredResponse>> mapListFromJson(dynamic json, {bool growable = false,}) {
    final map = <String, List<AgentListAlbumsToolApprovalRequiredResponse>>{};
    if (json is Map && json.isNotEmpty) {
      // ignore: parameter_assignments
      json = json.cast<String, dynamic>();
      for (final entry in json.entries) {
        map[entry.key] = AgentListAlbumsToolApprovalRequiredResponse.listFromJson(entry.value, growable: growable,);
      }
    }
    return map;
  }

  /// The list of required keys that must be present in a JSON.
  static const requiredKeys = <String>{
    'status',
    'toolCall',
  };
}


class AgentListAlbumsToolApprovalRequiredResponseStatusEnum {
  /// Instantiate a new enum with the provided [value].
  const AgentListAlbumsToolApprovalRequiredResponseStatusEnum._(this.value);

  /// The underlying value of this enum member.
  final String value;

  @override
  String toString() => value;

  String toJson() => value;

  static const approvalRequired = AgentListAlbumsToolApprovalRequiredResponseStatusEnum._(r'approval-required');

  /// List of all possible values in this [enum][AgentListAlbumsToolApprovalRequiredResponseStatusEnum].
  static const values = <AgentListAlbumsToolApprovalRequiredResponseStatusEnum>[
    approvalRequired,
  ];

  static AgentListAlbumsToolApprovalRequiredResponseStatusEnum? fromJson(dynamic value) => AgentListAlbumsToolApprovalRequiredResponseStatusEnumTypeTransformer().decode(value);

  static List<AgentListAlbumsToolApprovalRequiredResponseStatusEnum> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <AgentListAlbumsToolApprovalRequiredResponseStatusEnum>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = AgentListAlbumsToolApprovalRequiredResponseStatusEnum.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }
}

/// Transformation class that can [encode] an instance of [AgentListAlbumsToolApprovalRequiredResponseStatusEnum] to String,
/// and [decode] dynamic data back to [AgentListAlbumsToolApprovalRequiredResponseStatusEnum].
class AgentListAlbumsToolApprovalRequiredResponseStatusEnumTypeTransformer {
  factory AgentListAlbumsToolApprovalRequiredResponseStatusEnumTypeTransformer() => _instance ??= const AgentListAlbumsToolApprovalRequiredResponseStatusEnumTypeTransformer._();

  const AgentListAlbumsToolApprovalRequiredResponseStatusEnumTypeTransformer._();

  String encode(AgentListAlbumsToolApprovalRequiredResponseStatusEnum data) => data.value;

  /// Decodes a [dynamic value][data] to a AgentListAlbumsToolApprovalRequiredResponseStatusEnum.
  ///
  /// If [allowNull] is true and the [dynamic value][data] cannot be decoded successfully,
  /// then null is returned. However, if [allowNull] is false and the [dynamic value][data]
  /// cannot be decoded successfully, then an [UnimplementedError] is thrown.
  ///
  /// The [allowNull] is very handy when an API changes and a new enum value is added or removed,
  /// and users are still using an old app with the old code.
  AgentListAlbumsToolApprovalRequiredResponseStatusEnum? decode(dynamic data, {bool allowNull = true}) {
    if (data != null) {
      switch (data) {
        case r'approval-required': return AgentListAlbumsToolApprovalRequiredResponseStatusEnum.approvalRequired;
        default:
          if (!allowNull) {
            throw ArgumentError('Unknown enum value to decode: $data');
          }
      }
    }
    return null;
  }

  /// Singleton [AgentListAlbumsToolApprovalRequiredResponseStatusEnumTypeTransformer] instance.
  static AgentListAlbumsToolApprovalRequiredResponseStatusEnumTypeTransformer? _instance;
}


