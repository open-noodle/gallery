//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

class AgentSearchAssetsToolSuccessResponse {
  /// Returns a new [AgentSearchAssetsToolSuccessResponse] instance.
  AgentSearchAssetsToolSuccessResponse({
    this.approximateTotal = const Optional.absent(),
    required this.detail,
    required this.hasMore,
    required this.nextPage,
    required this.resultSize,
    required this.returnedCount,
    this.sample = const Optional.absent(),
    required this.selectionHandle,
    required this.status,
    required this.summary,
    required this.toolCall,
    this.totalCount = const Optional.absent(),
  });

  /// Minimum value: 0
  /// Maximum value: 9007199254740991
  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  Optional<int?> approximateTotal;

  AgentSearchAssetsDetail detail;

  bool hasMore;

  String? nextPage;

  AgentToolResultSize resultSize;

  /// Minimum value: 0
  /// Maximum value: 9007199254740991
  int returnedCount;

  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  Optional<AgentSearchAssetsSample?> sample;

  AgentSearchAssetsSelectionHandle selectionHandle;

  AgentSearchAssetsToolSuccessResponseStatusEnum status;

  String summary;

  AgentToolCallResponseDto toolCall;

  /// Minimum value: 0
  /// Maximum value: 9007199254740991
  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  Optional<int?> totalCount;

  @override
  bool operator ==(Object other) => identical(this, other) || other is AgentSearchAssetsToolSuccessResponse &&
    other.approximateTotal == approximateTotal &&
    other.detail == detail &&
    other.hasMore == hasMore &&
    other.nextPage == nextPage &&
    other.resultSize == resultSize &&
    other.returnedCount == returnedCount &&
    other.sample == sample &&
    other.selectionHandle == selectionHandle &&
    other.status == status &&
    other.summary == summary &&
    other.toolCall == toolCall &&
    other.totalCount == totalCount;

  @override
  int get hashCode =>
    // ignore: unnecessary_parenthesis
    (approximateTotal == null ? 0 : approximateTotal!.hashCode) +
    (detail.hashCode) +
    (hasMore.hashCode) +
    (nextPage == null ? 0 : nextPage!.hashCode) +
    (resultSize.hashCode) +
    (returnedCount.hashCode) +
    (sample == null ? 0 : sample!.hashCode) +
    (selectionHandle.hashCode) +
    (status.hashCode) +
    (summary.hashCode) +
    (toolCall.hashCode) +
    (totalCount == null ? 0 : totalCount!.hashCode);

  @override
  String toString() => 'AgentSearchAssetsToolSuccessResponse[approximateTotal=$approximateTotal, detail=$detail, hasMore=$hasMore, nextPage=$nextPage, resultSize=$resultSize, returnedCount=$returnedCount, sample=$sample, selectionHandle=$selectionHandle, status=$status, summary=$summary, toolCall=$toolCall, totalCount=$totalCount]';

  Map<String, dynamic> toJson() {
    final json = <String, dynamic>{};
    if (this.approximateTotal.isPresent) {
      final value = this.approximateTotal.value;
      json[r'approximateTotal'] = value;
    }
      json[r'detail'] = this.detail;
      json[r'hasMore'] = this.hasMore;
    if (this.nextPage != null) {
      json[r'nextPage'] = this.nextPage;
    } else {
    //  json[r'nextPage'] = null;
    }
      json[r'resultSize'] = this.resultSize;
      json[r'returnedCount'] = this.returnedCount;
    if (this.sample.isPresent) {
      final value = this.sample.value;
      json[r'sample'] = value;
    }
      json[r'selectionHandle'] = this.selectionHandle;
      json[r'status'] = this.status;
      json[r'summary'] = this.summary;
      json[r'toolCall'] = this.toolCall;
    if (this.totalCount.isPresent) {
      final value = this.totalCount.value;
      json[r'totalCount'] = value;
    }
    return json;
  }

  /// Returns a new [AgentSearchAssetsToolSuccessResponse] instance and imports its values from
  /// [value] if it's a [Map], null otherwise.
  // ignore: prefer_constructors_over_static_methods
  static AgentSearchAssetsToolSuccessResponse? fromJson(dynamic value) {
    upgradeDto(value, "AgentSearchAssetsToolSuccessResponse");
    if (value is Map) {
      final json = value.cast<String, dynamic>();

      return AgentSearchAssetsToolSuccessResponse(
        approximateTotal: json.containsKey(r'approximateTotal') ? Optional.present(json[r'approximateTotal'] == null ? null : int.parse('${json[r'approximateTotal']}')) : const Optional.absent(),
        detail: AgentSearchAssetsDetail.fromJson(json[r'detail'])!,
        hasMore: mapValueOfType<bool>(json, r'hasMore')!,
        nextPage: mapValueOfType<String>(json, r'nextPage'),
        resultSize: AgentToolResultSize.fromJson(json[r'resultSize'])!,
        returnedCount: mapValueOfType<int>(json, r'returnedCount')!,
        sample: json.containsKey(r'sample') ? Optional.present(AgentSearchAssetsSample.fromJson(json[r'sample'])) : const Optional.absent(),
        selectionHandle: AgentSearchAssetsSelectionHandle.fromJson(json[r'selectionHandle'])!,
        status: AgentSearchAssetsToolSuccessResponseStatusEnum.fromJson(json[r'status'])!,
        summary: mapValueOfType<String>(json, r'summary')!,
        toolCall: AgentToolCallResponseDto.fromJson(json[r'toolCall'])!,
        totalCount: json.containsKey(r'totalCount') ? Optional.present(json[r'totalCount'] == null ? null : int.parse('${json[r'totalCount']}')) : const Optional.absent(),
      );
    }
    return null;
  }

  static List<AgentSearchAssetsToolSuccessResponse> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <AgentSearchAssetsToolSuccessResponse>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = AgentSearchAssetsToolSuccessResponse.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }

  static Map<String, AgentSearchAssetsToolSuccessResponse> mapFromJson(dynamic json) {
    final map = <String, AgentSearchAssetsToolSuccessResponse>{};
    if (json is Map && json.isNotEmpty) {
      json = json.cast<String, dynamic>(); // ignore: parameter_assignments
      for (final entry in json.entries) {
        final value = AgentSearchAssetsToolSuccessResponse.fromJson(entry.value);
        if (value != null) {
          map[entry.key] = value;
        }
      }
    }
    return map;
  }

  // maps a json object with a list of AgentSearchAssetsToolSuccessResponse-objects as value to a dart map
  static Map<String, List<AgentSearchAssetsToolSuccessResponse>> mapListFromJson(dynamic json, {bool growable = false,}) {
    final map = <String, List<AgentSearchAssetsToolSuccessResponse>>{};
    if (json is Map && json.isNotEmpty) {
      // ignore: parameter_assignments
      json = json.cast<String, dynamic>();
      for (final entry in json.entries) {
        map[entry.key] = AgentSearchAssetsToolSuccessResponse.listFromJson(entry.value, growable: growable,);
      }
    }
    return map;
  }

  /// The list of required keys that must be present in a JSON.
  static const requiredKeys = <String>{
    'detail',
    'hasMore',
    'nextPage',
    'resultSize',
    'returnedCount',
    'selectionHandle',
    'status',
    'summary',
    'toolCall',
  };
}


class AgentSearchAssetsToolSuccessResponseStatusEnum {
  /// Instantiate a new enum with the provided [value].
  const AgentSearchAssetsToolSuccessResponseStatusEnum._(this.value);

  /// The underlying value of this enum member.
  final String value;

  @override
  String toString() => value;

  String toJson() => value;

  static const success = AgentSearchAssetsToolSuccessResponseStatusEnum._(r'success');

  /// List of all possible values in this [enum][AgentSearchAssetsToolSuccessResponseStatusEnum].
  static const values = <AgentSearchAssetsToolSuccessResponseStatusEnum>[
    success,
  ];

  static AgentSearchAssetsToolSuccessResponseStatusEnum? fromJson(dynamic value) => AgentSearchAssetsToolSuccessResponseStatusEnumTypeTransformer().decode(value);

  static List<AgentSearchAssetsToolSuccessResponseStatusEnum> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <AgentSearchAssetsToolSuccessResponseStatusEnum>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = AgentSearchAssetsToolSuccessResponseStatusEnum.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }
}

/// Transformation class that can [encode] an instance of [AgentSearchAssetsToolSuccessResponseStatusEnum] to String,
/// and [decode] dynamic data back to [AgentSearchAssetsToolSuccessResponseStatusEnum].
class AgentSearchAssetsToolSuccessResponseStatusEnumTypeTransformer {
  factory AgentSearchAssetsToolSuccessResponseStatusEnumTypeTransformer() => _instance ??= const AgentSearchAssetsToolSuccessResponseStatusEnumTypeTransformer._();

  const AgentSearchAssetsToolSuccessResponseStatusEnumTypeTransformer._();

  String encode(AgentSearchAssetsToolSuccessResponseStatusEnum data) => data.value;

  /// Decodes a [dynamic value][data] to a AgentSearchAssetsToolSuccessResponseStatusEnum.
  ///
  /// If [allowNull] is true and the [dynamic value][data] cannot be decoded successfully,
  /// then null is returned. However, if [allowNull] is false and the [dynamic value][data]
  /// cannot be decoded successfully, then an [UnimplementedError] is thrown.
  ///
  /// The [allowNull] is very handy when an API changes and a new enum value is added or removed,
  /// and users are still using an old app with the old code.
  AgentSearchAssetsToolSuccessResponseStatusEnum? decode(dynamic data, {bool allowNull = true}) {
    if (data != null) {
      switch (data) {
        case r'success': return AgentSearchAssetsToolSuccessResponseStatusEnum.success;
        default:
          if (!allowNull) {
            throw ArgumentError('Unknown enum value to decode: $data');
          }
      }
    }
    return null;
  }

  /// Singleton [AgentSearchAssetsToolSuccessResponseStatusEnumTypeTransformer] instance.
  static AgentSearchAssetsToolSuccessResponseStatusEnumTypeTransformer? _instance;
}


