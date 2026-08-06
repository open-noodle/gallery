//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

class AgentReadAssetOriginalsToolSuccessResponse {
  /// Returns a new [AgentReadAssetOriginalsToolSuccessResponse] instance.
  AgentReadAssetOriginalsToolSuccessResponse({
    this.originals = const [],
    required this.resultSize,
    required this.status,
    required this.toolCall,
  });

  List<AgentAssetMediaReference> originals;

  AgentToolResultSize resultSize;

  AgentReadAssetOriginalsToolSuccessResponseStatusEnum status;

  AgentToolCallResponseDto toolCall;

  @override
  bool operator ==(Object other) => identical(this, other) || other is AgentReadAssetOriginalsToolSuccessResponse &&
    _deepEquality.equals(other.originals, originals) &&
    other.resultSize == resultSize &&
    other.status == status &&
    other.toolCall == toolCall;

  @override
  int get hashCode =>
    // ignore: unnecessary_parenthesis
    (originals.hashCode) +
    (resultSize.hashCode) +
    (status.hashCode) +
    (toolCall.hashCode);

  @override
  String toString() => 'AgentReadAssetOriginalsToolSuccessResponse[originals=$originals, resultSize=$resultSize, status=$status, toolCall=$toolCall]';

  Map<String, dynamic> toJson() {
    final json = <String, dynamic>{};
      json[r'originals'] = this.originals;
      json[r'resultSize'] = this.resultSize;
      json[r'status'] = this.status;
      json[r'toolCall'] = this.toolCall;
    return json;
  }

  /// Returns a new [AgentReadAssetOriginalsToolSuccessResponse] instance and imports its values from
  /// [value] if it's a [Map], null otherwise.
  // ignore: prefer_constructors_over_static_methods
  static AgentReadAssetOriginalsToolSuccessResponse? fromJson(dynamic value) {
    upgradeDto(value, "AgentReadAssetOriginalsToolSuccessResponse");
    if (value is Map) {
      final json = value.cast<String, dynamic>();

      return AgentReadAssetOriginalsToolSuccessResponse(
        originals: AgentAssetMediaReference.listFromJson(json[r'originals']),
        resultSize: AgentToolResultSize.fromJson(json[r'resultSize'])!,
        status: AgentReadAssetOriginalsToolSuccessResponseStatusEnum.fromJson(json[r'status'])!,
        toolCall: AgentToolCallResponseDto.fromJson(json[r'toolCall'])!,
      );
    }
    return null;
  }

  static List<AgentReadAssetOriginalsToolSuccessResponse> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <AgentReadAssetOriginalsToolSuccessResponse>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = AgentReadAssetOriginalsToolSuccessResponse.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }

  static Map<String, AgentReadAssetOriginalsToolSuccessResponse> mapFromJson(dynamic json) {
    final map = <String, AgentReadAssetOriginalsToolSuccessResponse>{};
    if (json is Map && json.isNotEmpty) {
      json = json.cast<String, dynamic>(); // ignore: parameter_assignments
      for (final entry in json.entries) {
        final value = AgentReadAssetOriginalsToolSuccessResponse.fromJson(entry.value);
        if (value != null) {
          map[entry.key] = value;
        }
      }
    }
    return map;
  }

  // maps a json object with a list of AgentReadAssetOriginalsToolSuccessResponse-objects as value to a dart map
  static Map<String, List<AgentReadAssetOriginalsToolSuccessResponse>> mapListFromJson(dynamic json, {bool growable = false,}) {
    final map = <String, List<AgentReadAssetOriginalsToolSuccessResponse>>{};
    if (json is Map && json.isNotEmpty) {
      // ignore: parameter_assignments
      json = json.cast<String, dynamic>();
      for (final entry in json.entries) {
        map[entry.key] = AgentReadAssetOriginalsToolSuccessResponse.listFromJson(entry.value, growable: growable,);
      }
    }
    return map;
  }

  /// The list of required keys that must be present in a JSON.
  static const requiredKeys = <String>{
    'originals',
    'resultSize',
    'status',
    'toolCall',
  };
}


class AgentReadAssetOriginalsToolSuccessResponseStatusEnum {
  /// Instantiate a new enum with the provided [value].
  const AgentReadAssetOriginalsToolSuccessResponseStatusEnum._(this.value);

  /// The underlying value of this enum member.
  final String value;

  @override
  String toString() => value;

  String toJson() => value;

  static const success = AgentReadAssetOriginalsToolSuccessResponseStatusEnum._(r'success');

  /// List of all possible values in this [enum][AgentReadAssetOriginalsToolSuccessResponseStatusEnum].
  static const values = <AgentReadAssetOriginalsToolSuccessResponseStatusEnum>[
    success,
  ];

  static AgentReadAssetOriginalsToolSuccessResponseStatusEnum? fromJson(dynamic value) => AgentReadAssetOriginalsToolSuccessResponseStatusEnumTypeTransformer().decode(value);

  static List<AgentReadAssetOriginalsToolSuccessResponseStatusEnum> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <AgentReadAssetOriginalsToolSuccessResponseStatusEnum>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = AgentReadAssetOriginalsToolSuccessResponseStatusEnum.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }
}

/// Transformation class that can [encode] an instance of [AgentReadAssetOriginalsToolSuccessResponseStatusEnum] to String,
/// and [decode] dynamic data back to [AgentReadAssetOriginalsToolSuccessResponseStatusEnum].
class AgentReadAssetOriginalsToolSuccessResponseStatusEnumTypeTransformer {
  factory AgentReadAssetOriginalsToolSuccessResponseStatusEnumTypeTransformer() => _instance ??= const AgentReadAssetOriginalsToolSuccessResponseStatusEnumTypeTransformer._();

  const AgentReadAssetOriginalsToolSuccessResponseStatusEnumTypeTransformer._();

  String encode(AgentReadAssetOriginalsToolSuccessResponseStatusEnum data) => data.value;

  /// Decodes a [dynamic value][data] to a AgentReadAssetOriginalsToolSuccessResponseStatusEnum.
  ///
  /// If [allowNull] is true and the [dynamic value][data] cannot be decoded successfully,
  /// then null is returned. However, if [allowNull] is false and the [dynamic value][data]
  /// cannot be decoded successfully, then an [UnimplementedError] is thrown.
  ///
  /// The [allowNull] is very handy when an API changes and a new enum value is added or removed,
  /// and users are still using an old app with the old code.
  AgentReadAssetOriginalsToolSuccessResponseStatusEnum? decode(dynamic data, {bool allowNull = true}) {
    if (data != null) {
      switch (data) {
        case r'success': return AgentReadAssetOriginalsToolSuccessResponseStatusEnum.success;
        default:
          if (!allowNull) {
            throw ArgumentError('Unknown enum value to decode: $data');
          }
      }
    }
    return null;
  }

  /// Singleton [AgentReadAssetOriginalsToolSuccessResponseStatusEnumTypeTransformer] instance.
  static AgentReadAssetOriginalsToolSuccessResponseStatusEnumTypeTransformer? _instance;
}


