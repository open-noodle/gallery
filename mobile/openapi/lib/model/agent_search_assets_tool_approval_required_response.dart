//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

class AgentSearchAssetsToolApprovalRequiredResponse {
  /// Returns a new [AgentSearchAssetsToolApprovalRequiredResponse] instance.
  AgentSearchAssetsToolApprovalRequiredResponse({
    required this.status,
    required this.toolCall,
  });

  AgentSearchAssetsToolApprovalRequiredResponseStatusEnum status;

  AgentToolCallResponseDto toolCall;

  @override
  bool operator ==(Object other) => identical(this, other) || other is AgentSearchAssetsToolApprovalRequiredResponse &&
    other.status == status &&
    other.toolCall == toolCall;

  @override
  int get hashCode =>
    // ignore: unnecessary_parenthesis
    (status.hashCode) +
    (toolCall.hashCode);

  @override
  String toString() => 'AgentSearchAssetsToolApprovalRequiredResponse[status=$status, toolCall=$toolCall]';

  Map<String, dynamic> toJson() {
    final json = <String, dynamic>{};
      json[r'status'] = this.status;
      json[r'toolCall'] = this.toolCall;
    return json;
  }

  /// Returns a new [AgentSearchAssetsToolApprovalRequiredResponse] instance and imports its values from
  /// [value] if it's a [Map], null otherwise.
  // ignore: prefer_constructors_over_static_methods
  static AgentSearchAssetsToolApprovalRequiredResponse? fromJson(dynamic value) {
    upgradeDto(value, "AgentSearchAssetsToolApprovalRequiredResponse");
    if (value is Map) {
      final json = value.cast<String, dynamic>();

      return AgentSearchAssetsToolApprovalRequiredResponse(
        status: AgentSearchAssetsToolApprovalRequiredResponseStatusEnum.fromJson(json[r'status'])!,
        toolCall: AgentToolCallResponseDto.fromJson(json[r'toolCall'])!,
      );
    }
    return null;
  }

  static List<AgentSearchAssetsToolApprovalRequiredResponse> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <AgentSearchAssetsToolApprovalRequiredResponse>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = AgentSearchAssetsToolApprovalRequiredResponse.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }

  static Map<String, AgentSearchAssetsToolApprovalRequiredResponse> mapFromJson(dynamic json) {
    final map = <String, AgentSearchAssetsToolApprovalRequiredResponse>{};
    if (json is Map && json.isNotEmpty) {
      json = json.cast<String, dynamic>(); // ignore: parameter_assignments
      for (final entry in json.entries) {
        final value = AgentSearchAssetsToolApprovalRequiredResponse.fromJson(entry.value);
        if (value != null) {
          map[entry.key] = value;
        }
      }
    }
    return map;
  }

  // maps a json object with a list of AgentSearchAssetsToolApprovalRequiredResponse-objects as value to a dart map
  static Map<String, List<AgentSearchAssetsToolApprovalRequiredResponse>> mapListFromJson(dynamic json, {bool growable = false,}) {
    final map = <String, List<AgentSearchAssetsToolApprovalRequiredResponse>>{};
    if (json is Map && json.isNotEmpty) {
      // ignore: parameter_assignments
      json = json.cast<String, dynamic>();
      for (final entry in json.entries) {
        map[entry.key] = AgentSearchAssetsToolApprovalRequiredResponse.listFromJson(entry.value, growable: growable,);
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


class AgentSearchAssetsToolApprovalRequiredResponseStatusEnum {
  /// Instantiate a new enum with the provided [value].
  const AgentSearchAssetsToolApprovalRequiredResponseStatusEnum._(this.value);

  /// The underlying value of this enum member.
  final String value;

  @override
  String toString() => value;

  String toJson() => value;

  static const approvalRequired = AgentSearchAssetsToolApprovalRequiredResponseStatusEnum._(r'approval-required');

  /// List of all possible values in this [enum][AgentSearchAssetsToolApprovalRequiredResponseStatusEnum].
  static const values = <AgentSearchAssetsToolApprovalRequiredResponseStatusEnum>[
    approvalRequired,
  ];

  static AgentSearchAssetsToolApprovalRequiredResponseStatusEnum? fromJson(dynamic value) => AgentSearchAssetsToolApprovalRequiredResponseStatusEnumTypeTransformer().decode(value);

  static List<AgentSearchAssetsToolApprovalRequiredResponseStatusEnum> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <AgentSearchAssetsToolApprovalRequiredResponseStatusEnum>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = AgentSearchAssetsToolApprovalRequiredResponseStatusEnum.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }
}

/// Transformation class that can [encode] an instance of [AgentSearchAssetsToolApprovalRequiredResponseStatusEnum] to String,
/// and [decode] dynamic data back to [AgentSearchAssetsToolApprovalRequiredResponseStatusEnum].
class AgentSearchAssetsToolApprovalRequiredResponseStatusEnumTypeTransformer {
  factory AgentSearchAssetsToolApprovalRequiredResponseStatusEnumTypeTransformer() => _instance ??= const AgentSearchAssetsToolApprovalRequiredResponseStatusEnumTypeTransformer._();

  const AgentSearchAssetsToolApprovalRequiredResponseStatusEnumTypeTransformer._();

  String encode(AgentSearchAssetsToolApprovalRequiredResponseStatusEnum data) => data.value;

  /// Decodes a [dynamic value][data] to a AgentSearchAssetsToolApprovalRequiredResponseStatusEnum.
  ///
  /// If [allowNull] is true and the [dynamic value][data] cannot be decoded successfully,
  /// then null is returned. However, if [allowNull] is false and the [dynamic value][data]
  /// cannot be decoded successfully, then an [UnimplementedError] is thrown.
  ///
  /// The [allowNull] is very handy when an API changes and a new enum value is added or removed,
  /// and users are still using an old app with the old code.
  AgentSearchAssetsToolApprovalRequiredResponseStatusEnum? decode(dynamic data, {bool allowNull = true}) {
    if (data != null) {
      switch (data) {
        case r'approval-required': return AgentSearchAssetsToolApprovalRequiredResponseStatusEnum.approvalRequired;
        default:
          if (!allowNull) {
            throw ArgumentError('Unknown enum value to decode: $data');
          }
      }
    }
    return null;
  }

  /// Singleton [AgentSearchAssetsToolApprovalRequiredResponseStatusEnumTypeTransformer] instance.
  static AgentSearchAssetsToolApprovalRequiredResponseStatusEnumTypeTransformer? _instance;
}


