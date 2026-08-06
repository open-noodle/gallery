//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

class AgentReadAssetPreviewsToolSuccessResponse {
  /// Returns a new [AgentReadAssetPreviewsToolSuccessResponse] instance.
  AgentReadAssetPreviewsToolSuccessResponse({
    this.previews = const [],
    required this.resultSize,
    required this.status,
    required this.toolCall,
  });

  List<AgentAssetMediaReference> previews;

  AgentToolResultSize resultSize;

  AgentReadAssetPreviewsToolSuccessResponseStatusEnum status;

  AgentToolCallResponseDto toolCall;

  @override
  bool operator ==(Object other) => identical(this, other) || other is AgentReadAssetPreviewsToolSuccessResponse &&
    _deepEquality.equals(other.previews, previews) &&
    other.resultSize == resultSize &&
    other.status == status &&
    other.toolCall == toolCall;

  @override
  int get hashCode =>
    // ignore: unnecessary_parenthesis
    (previews.hashCode) +
    (resultSize.hashCode) +
    (status.hashCode) +
    (toolCall.hashCode);

  @override
  String toString() => 'AgentReadAssetPreviewsToolSuccessResponse[previews=$previews, resultSize=$resultSize, status=$status, toolCall=$toolCall]';

  Map<String, dynamic> toJson() {
    final json = <String, dynamic>{};
      json[r'previews'] = this.previews;
      json[r'resultSize'] = this.resultSize;
      json[r'status'] = this.status;
      json[r'toolCall'] = this.toolCall;
    return json;
  }

  /// Returns a new [AgentReadAssetPreviewsToolSuccessResponse] instance and imports its values from
  /// [value] if it's a [Map], null otherwise.
  // ignore: prefer_constructors_over_static_methods
  static AgentReadAssetPreviewsToolSuccessResponse? fromJson(dynamic value) {
    upgradeDto(value, "AgentReadAssetPreviewsToolSuccessResponse");
    if (value is Map) {
      final json = value.cast<String, dynamic>();

      return AgentReadAssetPreviewsToolSuccessResponse(
        previews: AgentAssetMediaReference.listFromJson(json[r'previews']),
        resultSize: AgentToolResultSize.fromJson(json[r'resultSize'])!,
        status: AgentReadAssetPreviewsToolSuccessResponseStatusEnum.fromJson(json[r'status'])!,
        toolCall: AgentToolCallResponseDto.fromJson(json[r'toolCall'])!,
      );
    }
    return null;
  }

  static List<AgentReadAssetPreviewsToolSuccessResponse> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <AgentReadAssetPreviewsToolSuccessResponse>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = AgentReadAssetPreviewsToolSuccessResponse.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }

  static Map<String, AgentReadAssetPreviewsToolSuccessResponse> mapFromJson(dynamic json) {
    final map = <String, AgentReadAssetPreviewsToolSuccessResponse>{};
    if (json is Map && json.isNotEmpty) {
      json = json.cast<String, dynamic>(); // ignore: parameter_assignments
      for (final entry in json.entries) {
        final value = AgentReadAssetPreviewsToolSuccessResponse.fromJson(entry.value);
        if (value != null) {
          map[entry.key] = value;
        }
      }
    }
    return map;
  }

  // maps a json object with a list of AgentReadAssetPreviewsToolSuccessResponse-objects as value to a dart map
  static Map<String, List<AgentReadAssetPreviewsToolSuccessResponse>> mapListFromJson(dynamic json, {bool growable = false,}) {
    final map = <String, List<AgentReadAssetPreviewsToolSuccessResponse>>{};
    if (json is Map && json.isNotEmpty) {
      // ignore: parameter_assignments
      json = json.cast<String, dynamic>();
      for (final entry in json.entries) {
        map[entry.key] = AgentReadAssetPreviewsToolSuccessResponse.listFromJson(entry.value, growable: growable,);
      }
    }
    return map;
  }

  /// The list of required keys that must be present in a JSON.
  static const requiredKeys = <String>{
    'previews',
    'resultSize',
    'status',
    'toolCall',
  };
}


class AgentReadAssetPreviewsToolSuccessResponseStatusEnum {
  /// Instantiate a new enum with the provided [value].
  const AgentReadAssetPreviewsToolSuccessResponseStatusEnum._(this.value);

  /// The underlying value of this enum member.
  final String value;

  @override
  String toString() => value;

  String toJson() => value;

  static const success = AgentReadAssetPreviewsToolSuccessResponseStatusEnum._(r'success');

  /// List of all possible values in this [enum][AgentReadAssetPreviewsToolSuccessResponseStatusEnum].
  static const values = <AgentReadAssetPreviewsToolSuccessResponseStatusEnum>[
    success,
  ];

  static AgentReadAssetPreviewsToolSuccessResponseStatusEnum? fromJson(dynamic value) => AgentReadAssetPreviewsToolSuccessResponseStatusEnumTypeTransformer().decode(value);

  static List<AgentReadAssetPreviewsToolSuccessResponseStatusEnum> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <AgentReadAssetPreviewsToolSuccessResponseStatusEnum>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = AgentReadAssetPreviewsToolSuccessResponseStatusEnum.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }
}

/// Transformation class that can [encode] an instance of [AgentReadAssetPreviewsToolSuccessResponseStatusEnum] to String,
/// and [decode] dynamic data back to [AgentReadAssetPreviewsToolSuccessResponseStatusEnum].
class AgentReadAssetPreviewsToolSuccessResponseStatusEnumTypeTransformer {
  factory AgentReadAssetPreviewsToolSuccessResponseStatusEnumTypeTransformer() => _instance ??= const AgentReadAssetPreviewsToolSuccessResponseStatusEnumTypeTransformer._();

  const AgentReadAssetPreviewsToolSuccessResponseStatusEnumTypeTransformer._();

  String encode(AgentReadAssetPreviewsToolSuccessResponseStatusEnum data) => data.value;

  /// Decodes a [dynamic value][data] to a AgentReadAssetPreviewsToolSuccessResponseStatusEnum.
  ///
  /// If [allowNull] is true and the [dynamic value][data] cannot be decoded successfully,
  /// then null is returned. However, if [allowNull] is false and the [dynamic value][data]
  /// cannot be decoded successfully, then an [UnimplementedError] is thrown.
  ///
  /// The [allowNull] is very handy when an API changes and a new enum value is added or removed,
  /// and users are still using an old app with the old code.
  AgentReadAssetPreviewsToolSuccessResponseStatusEnum? decode(dynamic data, {bool allowNull = true}) {
    if (data != null) {
      switch (data) {
        case r'success': return AgentReadAssetPreviewsToolSuccessResponseStatusEnum.success;
        default:
          if (!allowNull) {
            throw ArgumentError('Unknown enum value to decode: $data');
          }
      }
    }
    return null;
  }

  /// Singleton [AgentReadAssetPreviewsToolSuccessResponseStatusEnumTypeTransformer] instance.
  static AgentReadAssetPreviewsToolSuccessResponseStatusEnumTypeTransformer? _instance;
}


