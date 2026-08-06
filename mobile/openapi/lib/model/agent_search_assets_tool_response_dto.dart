//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

class AgentSearchAssetsToolResponseDto {
  /// Returns a new [AgentSearchAssetsToolResponseDto] instance.
  AgentSearchAssetsToolResponseDto({
    required this.status,
    required this.toolCall,
    this.reason,
    this.summary,
    this.detail,
    this.returnedCount,
    this.hasMore,
    this.nextPage,
    this.resultSize,
    this.sample,
    this.selectionHandle,
    this.approximateTotal,
    this.totalCount,
  });

  AgentSearchAssetsToolResponseDtoStatusEnum status;

  AgentToolCallResponseDto toolCall;

  String? reason;

  String? summary;

  AgentSearchAssetsDetail? detail;

  int? returnedCount;

  bool? hasMore;

  String? nextPage;

  AgentToolResultSize? resultSize;

  AgentSearchAssetsSample? sample;

  AgentSearchAssetsSelectionHandle? selectionHandle;

  int? approximateTotal;

  int? totalCount;

  @override
  bool operator ==(Object other) => identical(this, other) || other is AgentSearchAssetsToolResponseDto &&
    other.status == status &&
    other.toolCall == toolCall &&
    other.reason == reason &&
    other.summary == summary &&
    other.detail == detail &&
    other.returnedCount == returnedCount &&
    other.hasMore == hasMore &&
    other.nextPage == nextPage &&
    other.resultSize == resultSize &&
    other.sample == sample &&
    other.selectionHandle == selectionHandle &&
    other.approximateTotal == approximateTotal &&
    other.totalCount == totalCount;

  @override
  int get hashCode =>
    // ignore: unnecessary_parenthesis
    (status.hashCode) +
    (toolCall.hashCode) +
    (reason == null ? 0 : reason!.hashCode) +
    (summary == null ? 0 : summary!.hashCode) +
    (detail == null ? 0 : detail!.hashCode) +
    (returnedCount == null ? 0 : returnedCount!.hashCode) +
    (hasMore == null ? 0 : hasMore!.hashCode) +
    (nextPage == null ? 0 : nextPage!.hashCode) +
    (resultSize == null ? 0 : resultSize!.hashCode) +
    (sample == null ? 0 : sample!.hashCode) +
    (selectionHandle == null ? 0 : selectionHandle!.hashCode) +
    (approximateTotal == null ? 0 : approximateTotal!.hashCode) +
    (totalCount == null ? 0 : totalCount!.hashCode);

  @override
  String toString() => 'AgentSearchAssetsToolResponseDto[status=$status, toolCall=$toolCall, reason=$reason, summary=$summary, detail=$detail, returnedCount=$returnedCount, hasMore=$hasMore, nextPage=$nextPage, resultSize=$resultSize, sample=$sample, selectionHandle=$selectionHandle, approximateTotal=$approximateTotal, totalCount=$totalCount]';

  Map<String, dynamic> toJson() {
    final json = <String, dynamic>{};
      json[r'status'] = this.status;
      json[r'toolCall'] = this.toolCall;
    if (this.reason != null) {
      json[r'reason'] = this.reason;
    }
    if (this.summary != null) {
      json[r'summary'] = this.summary;
    }
    if (this.detail != null) {
      json[r'detail'] = this.detail;
    }
    if (this.returnedCount != null) {
      json[r'returnedCount'] = this.returnedCount;
    }
    if (this.hasMore != null) {
      json[r'hasMore'] = this.hasMore;
    }
    if (this.nextPage != null) {
      json[r'nextPage'] = this.nextPage;
    }
    if (this.resultSize != null) {
      json[r'resultSize'] = this.resultSize;
    }
    if (this.sample != null) {
      json[r'sample'] = this.sample;
    }
    if (this.selectionHandle != null) {
      json[r'selectionHandle'] = this.selectionHandle;
    }
    if (this.approximateTotal != null) {
      json[r'approximateTotal'] = this.approximateTotal;
    }
    if (this.totalCount != null) {
      json[r'totalCount'] = this.totalCount;
    }
    return json;
  }

  /// Returns a new [AgentSearchAssetsToolResponseDto] instance and imports its values from
  /// [value] if it's a [Map], null otherwise.
  // ignore: prefer_constructors_over_static_methods
  static AgentSearchAssetsToolResponseDto? fromJson(dynamic value) {
    upgradeDto(value, "AgentSearchAssetsToolResponseDto");
    if (value is Map) {
      final json = value.cast<String, dynamic>();

      return AgentSearchAssetsToolResponseDto(
        status: AgentSearchAssetsToolResponseDtoStatusEnum.fromJson(json[r'status'])!,
        toolCall: AgentToolCallResponseDto.fromJson(json[r'toolCall'])!,
        reason: mapValueOfType<String>(json, r'reason'),
        summary: mapValueOfType<String>(json, r'summary'),
        detail: AgentSearchAssetsDetail.fromJson(json[r'detail']),
        returnedCount: mapValueOfType<int>(json, r'returnedCount'),
        hasMore: mapValueOfType<bool>(json, r'hasMore'),
        nextPage: mapValueOfType<String>(json, r'nextPage'),
        resultSize: AgentToolResultSize.fromJson(json[r'resultSize']),
        sample: AgentSearchAssetsSample.fromJson(json[r'sample']),
        selectionHandle: AgentSearchAssetsSelectionHandle.fromJson(json[r'selectionHandle']),
        approximateTotal: mapValueOfType<int>(json, r'approximateTotal'),
        totalCount: mapValueOfType<int>(json, r'totalCount'),
      );
    }
    return null;
  }

  static List<AgentSearchAssetsToolResponseDto> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <AgentSearchAssetsToolResponseDto>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = AgentSearchAssetsToolResponseDto.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }

  static Map<String, AgentSearchAssetsToolResponseDto> mapFromJson(dynamic json) {
    final map = <String, AgentSearchAssetsToolResponseDto>{};
    if (json is Map && json.isNotEmpty) {
      json = json.cast<String, dynamic>(); // ignore: parameter_assignments
      for (final entry in json.entries) {
        final value = AgentSearchAssetsToolResponseDto.fromJson(entry.value);
        if (value != null) {
          map[entry.key] = value;
        }
      }
    }
    return map;
  }

  // maps a json object with a list of AgentSearchAssetsToolResponseDto-objects as value to a dart map
  static Map<String, List<AgentSearchAssetsToolResponseDto>> mapListFromJson(dynamic json, {bool growable = false,}) {
    final map = <String, List<AgentSearchAssetsToolResponseDto>>{};
    if (json is Map && json.isNotEmpty) {
      // ignore: parameter_assignments
      json = json.cast<String, dynamic>();
      for (final entry in json.entries) {
        map[entry.key] = AgentSearchAssetsToolResponseDto.listFromJson(entry.value, growable: growable,);
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


class AgentSearchAssetsToolResponseDtoStatusEnum {
  /// Instantiate a new enum with the provided [value].
  const AgentSearchAssetsToolResponseDtoStatusEnum._(this.value);

  /// The underlying value of this enum member.
  final String value;

  @override
  String toString() => value;

  String toJson() => value;

  static const approvalRequired = AgentSearchAssetsToolResponseDtoStatusEnum._(r'approval-required');
  static const denied = AgentSearchAssetsToolResponseDtoStatusEnum._(r'denied');
  static const success = AgentSearchAssetsToolResponseDtoStatusEnum._(r'success');

  /// List of all possible values in this [enum][AgentSearchAssetsToolResponseDtoStatusEnum].
  static const values = <AgentSearchAssetsToolResponseDtoStatusEnum>[
    approvalRequired,
    denied,
    success,
  ];

  static AgentSearchAssetsToolResponseDtoStatusEnum? fromJson(dynamic value) => AgentSearchAssetsToolResponseDtoStatusEnumTypeTransformer().decode(value);

  static List<AgentSearchAssetsToolResponseDtoStatusEnum> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <AgentSearchAssetsToolResponseDtoStatusEnum>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = AgentSearchAssetsToolResponseDtoStatusEnum.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }
}

/// Transformation class that can [encode] an instance of [AgentSearchAssetsToolResponseDtoStatusEnum] to String,
/// and [decode] dynamic data back to [AgentSearchAssetsToolResponseDtoStatusEnum].
class AgentSearchAssetsToolResponseDtoStatusEnumTypeTransformer {
  factory AgentSearchAssetsToolResponseDtoStatusEnumTypeTransformer() => _instance ??= const AgentSearchAssetsToolResponseDtoStatusEnumTypeTransformer._();

  const AgentSearchAssetsToolResponseDtoStatusEnumTypeTransformer._();

  String encode(AgentSearchAssetsToolResponseDtoStatusEnum data) => data.value;

  /// Decodes a [dynamic value][data] to a AgentSearchAssetsToolResponseDtoStatusEnum.
  ///
  /// If [allowNull] is true and the [dynamic value][data] cannot be decoded successfully,
  /// then null is returned. However, if [allowNull] is false and the [dynamic value][data]
  /// cannot be decoded successfully, then an [UnimplementedError] is thrown.
  ///
  /// The [allowNull] is very handy when an API changes and a new enum value is added or removed,
  /// and users are still using an old app with the old code.
  AgentSearchAssetsToolResponseDtoStatusEnum? decode(dynamic data, {bool allowNull = true}) {
    if (data != null) {
      switch (data) {
        case r'approval-required': return AgentSearchAssetsToolResponseDtoStatusEnum.approvalRequired;
        case r'denied': return AgentSearchAssetsToolResponseDtoStatusEnum.denied;
        case r'success': return AgentSearchAssetsToolResponseDtoStatusEnum.success;
        default:
          if (!allowNull) {
            throw ArgumentError('Unknown enum value to decode: $data');
          }
      }
    }
    return null;
  }

  /// Singleton [AgentSearchAssetsToolResponseDtoStatusEnumTypeTransformer] instance.
  static AgentSearchAssetsToolResponseDtoStatusEnumTypeTransformer? _instance;
}

