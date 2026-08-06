//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

class AgentReadAssetPreviewsToolApprovalRequiredResponse {
  /// Returns a new [AgentReadAssetPreviewsToolApprovalRequiredResponse] instance.
  AgentReadAssetPreviewsToolApprovalRequiredResponse({
    required this.status,
    required this.toolCall,
  });

  AgentReadAssetPreviewsToolApprovalRequiredResponseStatusEnum status;

  AgentToolCallResponseDto toolCall;

  @override
  bool operator ==(Object other) => identical(this, other) || other is AgentReadAssetPreviewsToolApprovalRequiredResponse &&
    other.status == status &&
    other.toolCall == toolCall;

  @override
  int get hashCode =>
    // ignore: unnecessary_parenthesis
    (status.hashCode) +
    (toolCall.hashCode);

  @override
  String toString() => 'AgentReadAssetPreviewsToolApprovalRequiredResponse[status=$status, toolCall=$toolCall]';

  Map<String, dynamic> toJson() {
    final json = <String, dynamic>{};
      json[r'status'] = this.status;
      json[r'toolCall'] = this.toolCall;
    return json;
  }

  /// Returns a new [AgentReadAssetPreviewsToolApprovalRequiredResponse] instance and imports its values from
  /// [value] if it's a [Map], null otherwise.
  // ignore: prefer_constructors_over_static_methods
  static AgentReadAssetPreviewsToolApprovalRequiredResponse? fromJson(dynamic value) {
    upgradeDto(value, "AgentReadAssetPreviewsToolApprovalRequiredResponse");
    if (value is Map) {
      final json = value.cast<String, dynamic>();

      return AgentReadAssetPreviewsToolApprovalRequiredResponse(
        status: AgentReadAssetPreviewsToolApprovalRequiredResponseStatusEnum.fromJson(json[r'status'])!,
        toolCall: AgentToolCallResponseDto.fromJson(json[r'toolCall'])!,
      );
    }
    return null;
  }

  static List<AgentReadAssetPreviewsToolApprovalRequiredResponse> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <AgentReadAssetPreviewsToolApprovalRequiredResponse>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = AgentReadAssetPreviewsToolApprovalRequiredResponse.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }

  static Map<String, AgentReadAssetPreviewsToolApprovalRequiredResponse> mapFromJson(dynamic json) {
    final map = <String, AgentReadAssetPreviewsToolApprovalRequiredResponse>{};
    if (json is Map && json.isNotEmpty) {
      json = json.cast<String, dynamic>(); // ignore: parameter_assignments
      for (final entry in json.entries) {
        final value = AgentReadAssetPreviewsToolApprovalRequiredResponse.fromJson(entry.value);
        if (value != null) {
          map[entry.key] = value;
        }
      }
    }
    return map;
  }

  // maps a json object with a list of AgentReadAssetPreviewsToolApprovalRequiredResponse-objects as value to a dart map
  static Map<String, List<AgentReadAssetPreviewsToolApprovalRequiredResponse>> mapListFromJson(dynamic json, {bool growable = false,}) {
    final map = <String, List<AgentReadAssetPreviewsToolApprovalRequiredResponse>>{};
    if (json is Map && json.isNotEmpty) {
      // ignore: parameter_assignments
      json = json.cast<String, dynamic>();
      for (final entry in json.entries) {
        map[entry.key] = AgentReadAssetPreviewsToolApprovalRequiredResponse.listFromJson(entry.value, growable: growable,);
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


class AgentReadAssetPreviewsToolApprovalRequiredResponseStatusEnum {
  /// Instantiate a new enum with the provided [value].
  const AgentReadAssetPreviewsToolApprovalRequiredResponseStatusEnum._(this.value);

  /// The underlying value of this enum member.
  final String value;

  @override
  String toString() => value;

  String toJson() => value;

  static const approvalRequired = AgentReadAssetPreviewsToolApprovalRequiredResponseStatusEnum._(r'approval-required');

  /// List of all possible values in this [enum][AgentReadAssetPreviewsToolApprovalRequiredResponseStatusEnum].
  static const values = <AgentReadAssetPreviewsToolApprovalRequiredResponseStatusEnum>[
    approvalRequired,
  ];

  static AgentReadAssetPreviewsToolApprovalRequiredResponseStatusEnum? fromJson(dynamic value) => AgentReadAssetPreviewsToolApprovalRequiredResponseStatusEnumTypeTransformer().decode(value);

  static List<AgentReadAssetPreviewsToolApprovalRequiredResponseStatusEnum> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <AgentReadAssetPreviewsToolApprovalRequiredResponseStatusEnum>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = AgentReadAssetPreviewsToolApprovalRequiredResponseStatusEnum.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }
}

/// Transformation class that can [encode] an instance of [AgentReadAssetPreviewsToolApprovalRequiredResponseStatusEnum] to String,
/// and [decode] dynamic data back to [AgentReadAssetPreviewsToolApprovalRequiredResponseStatusEnum].
class AgentReadAssetPreviewsToolApprovalRequiredResponseStatusEnumTypeTransformer {
  factory AgentReadAssetPreviewsToolApprovalRequiredResponseStatusEnumTypeTransformer() => _instance ??= const AgentReadAssetPreviewsToolApprovalRequiredResponseStatusEnumTypeTransformer._();

  const AgentReadAssetPreviewsToolApprovalRequiredResponseStatusEnumTypeTransformer._();

  String encode(AgentReadAssetPreviewsToolApprovalRequiredResponseStatusEnum data) => data.value;

  /// Decodes a [dynamic value][data] to a AgentReadAssetPreviewsToolApprovalRequiredResponseStatusEnum.
  ///
  /// If [allowNull] is true and the [dynamic value][data] cannot be decoded successfully,
  /// then null is returned. However, if [allowNull] is false and the [dynamic value][data]
  /// cannot be decoded successfully, then an [UnimplementedError] is thrown.
  ///
  /// The [allowNull] is very handy when an API changes and a new enum value is added or removed,
  /// and users are still using an old app with the old code.
  AgentReadAssetPreviewsToolApprovalRequiredResponseStatusEnum? decode(dynamic data, {bool allowNull = true}) {
    if (data != null) {
      switch (data) {
        case r'approval-required': return AgentReadAssetPreviewsToolApprovalRequiredResponseStatusEnum.approvalRequired;
        default:
          if (!allowNull) {
            throw ArgumentError('Unknown enum value to decode: $data');
          }
      }
    }
    return null;
  }

  /// Singleton [AgentReadAssetPreviewsToolApprovalRequiredResponseStatusEnumTypeTransformer] instance.
  static AgentReadAssetPreviewsToolApprovalRequiredResponseStatusEnumTypeTransformer? _instance;
}


