//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

class AgentReadAssetMetadataToolSuccessResponse {
  /// Returns a new [AgentReadAssetMetadataToolSuccessResponse] instance.
  AgentReadAssetMetadataToolSuccessResponse({
    this.assets = const [],
    this.detail = const Optional.absent(),
    this.fields = const [],
    required this.resultSize,
    required this.status,
    required this.summary,
    required this.toolCall,
  });

  List<AgentAssetMetadataResult> assets;

  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  Optional<AgentAssetMetadataDetail?> detail;

  List<AgentAssetMetadataField> fields;

  AgentToolResultSize resultSize;

  AgentReadAssetMetadataToolSuccessResponseStatusEnum status;

  String summary;

  AgentToolCallResponseDto toolCall;

  @override
  bool operator ==(Object other) => identical(this, other) || other is AgentReadAssetMetadataToolSuccessResponse &&
    _deepEquality.equals(other.assets, assets) &&
    other.detail == detail &&
    _deepEquality.equals(other.fields, fields) &&
    other.resultSize == resultSize &&
    other.status == status &&
    other.summary == summary &&
    other.toolCall == toolCall;

  @override
  int get hashCode =>
    // ignore: unnecessary_parenthesis
    (assets.hashCode) +
    (detail == null ? 0 : detail!.hashCode) +
    (fields.hashCode) +
    (resultSize.hashCode) +
    (status.hashCode) +
    (summary.hashCode) +
    (toolCall.hashCode);

  @override
  String toString() => 'AgentReadAssetMetadataToolSuccessResponse[assets=$assets, detail=$detail, fields=$fields, resultSize=$resultSize, status=$status, summary=$summary, toolCall=$toolCall]';

  Map<String, dynamic> toJson() {
    final json = <String, dynamic>{};
      json[r'assets'] = this.assets;
    if (this.detail.isPresent) {
      final value = this.detail.value;
      json[r'detail'] = value;
    }
      json[r'fields'] = this.fields;
      json[r'resultSize'] = this.resultSize;
      json[r'status'] = this.status;
      json[r'summary'] = this.summary;
      json[r'toolCall'] = this.toolCall;
    return json;
  }

  /// Returns a new [AgentReadAssetMetadataToolSuccessResponse] instance and imports its values from
  /// [value] if it's a [Map], null otherwise.
  // ignore: prefer_constructors_over_static_methods
  static AgentReadAssetMetadataToolSuccessResponse? fromJson(dynamic value) {
    upgradeDto(value, "AgentReadAssetMetadataToolSuccessResponse");
    if (value is Map) {
      final json = value.cast<String, dynamic>();

      return AgentReadAssetMetadataToolSuccessResponse(
        assets: AgentAssetMetadataResult.listFromJson(json[r'assets']),
        detail: json.containsKey(r'detail') ? Optional.present(AgentAssetMetadataDetail.fromJson(json[r'detail'])) : const Optional.absent(),
        fields: AgentAssetMetadataField.listFromJson(json[r'fields']),
        resultSize: AgentToolResultSize.fromJson(json[r'resultSize'])!,
        status: AgentReadAssetMetadataToolSuccessResponseStatusEnum.fromJson(json[r'status'])!,
        summary: mapValueOfType<String>(json, r'summary')!,
        toolCall: AgentToolCallResponseDto.fromJson(json[r'toolCall'])!,
      );
    }
    return null;
  }

  static List<AgentReadAssetMetadataToolSuccessResponse> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <AgentReadAssetMetadataToolSuccessResponse>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = AgentReadAssetMetadataToolSuccessResponse.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }

  static Map<String, AgentReadAssetMetadataToolSuccessResponse> mapFromJson(dynamic json) {
    final map = <String, AgentReadAssetMetadataToolSuccessResponse>{};
    if (json is Map && json.isNotEmpty) {
      json = json.cast<String, dynamic>(); // ignore: parameter_assignments
      for (final entry in json.entries) {
        final value = AgentReadAssetMetadataToolSuccessResponse.fromJson(entry.value);
        if (value != null) {
          map[entry.key] = value;
        }
      }
    }
    return map;
  }

  // maps a json object with a list of AgentReadAssetMetadataToolSuccessResponse-objects as value to a dart map
  static Map<String, List<AgentReadAssetMetadataToolSuccessResponse>> mapListFromJson(dynamic json, {bool growable = false,}) {
    final map = <String, List<AgentReadAssetMetadataToolSuccessResponse>>{};
    if (json is Map && json.isNotEmpty) {
      // ignore: parameter_assignments
      json = json.cast<String, dynamic>();
      for (final entry in json.entries) {
        map[entry.key] = AgentReadAssetMetadataToolSuccessResponse.listFromJson(entry.value, growable: growable,);
      }
    }
    return map;
  }

  /// The list of required keys that must be present in a JSON.
  static const requiredKeys = <String>{
    'assets',
    'fields',
    'resultSize',
    'status',
    'summary',
    'toolCall',
  };
}


class AgentReadAssetMetadataToolSuccessResponseStatusEnum {
  /// Instantiate a new enum with the provided [value].
  const AgentReadAssetMetadataToolSuccessResponseStatusEnum._(this.value);

  /// The underlying value of this enum member.
  final String value;

  @override
  String toString() => value;

  String toJson() => value;

  static const success = AgentReadAssetMetadataToolSuccessResponseStatusEnum._(r'success');

  /// List of all possible values in this [enum][AgentReadAssetMetadataToolSuccessResponseStatusEnum].
  static const values = <AgentReadAssetMetadataToolSuccessResponseStatusEnum>[
    success,
  ];

  static AgentReadAssetMetadataToolSuccessResponseStatusEnum? fromJson(dynamic value) => AgentReadAssetMetadataToolSuccessResponseStatusEnumTypeTransformer().decode(value);

  static List<AgentReadAssetMetadataToolSuccessResponseStatusEnum> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <AgentReadAssetMetadataToolSuccessResponseStatusEnum>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = AgentReadAssetMetadataToolSuccessResponseStatusEnum.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }
}

/// Transformation class that can [encode] an instance of [AgentReadAssetMetadataToolSuccessResponseStatusEnum] to String,
/// and [decode] dynamic data back to [AgentReadAssetMetadataToolSuccessResponseStatusEnum].
class AgentReadAssetMetadataToolSuccessResponseStatusEnumTypeTransformer {
  factory AgentReadAssetMetadataToolSuccessResponseStatusEnumTypeTransformer() => _instance ??= const AgentReadAssetMetadataToolSuccessResponseStatusEnumTypeTransformer._();

  const AgentReadAssetMetadataToolSuccessResponseStatusEnumTypeTransformer._();

  String encode(AgentReadAssetMetadataToolSuccessResponseStatusEnum data) => data.value;

  /// Decodes a [dynamic value][data] to a AgentReadAssetMetadataToolSuccessResponseStatusEnum.
  ///
  /// If [allowNull] is true and the [dynamic value][data] cannot be decoded successfully,
  /// then null is returned. However, if [allowNull] is false and the [dynamic value][data]
  /// cannot be decoded successfully, then an [UnimplementedError] is thrown.
  ///
  /// The [allowNull] is very handy when an API changes and a new enum value is added or removed,
  /// and users are still using an old app with the old code.
  AgentReadAssetMetadataToolSuccessResponseStatusEnum? decode(dynamic data, {bool allowNull = true}) {
    if (data != null) {
      switch (data) {
        case r'success': return AgentReadAssetMetadataToolSuccessResponseStatusEnum.success;
        default:
          if (!allowNull) {
            throw ArgumentError('Unknown enum value to decode: $data');
          }
      }
    }
    return null;
  }

  /// Singleton [AgentReadAssetMetadataToolSuccessResponseStatusEnumTypeTransformer] instance.
  static AgentReadAssetMetadataToolSuccessResponseStatusEnumTypeTransformer? _instance;
}


