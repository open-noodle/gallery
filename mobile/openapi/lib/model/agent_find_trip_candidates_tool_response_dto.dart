//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

class AgentFindTripCandidatesToolResponseDto {
  /// Returns a new [AgentFindTripCandidatesToolResponseDto] instance.
  AgentFindTripCandidatesToolResponseDto({
    required this.status,
    required this.toolCall,
    required this.reason,
    this.candidates = const [],
    required this.recommendation,
    required this.resultSize,
    required this.summary,
  });

  AgentFindTripCandidatesToolResponseDtoStatusEnum status;

  AgentToolCallResponseDto toolCall;

  String reason;

  List<AgentTripCandidateSummary> candidates;

  AgentTripCandidateRecommendation recommendation;

  AgentToolResultSize resultSize;

  String summary;

  @override
  bool operator ==(Object other) => identical(this, other) || other is AgentFindTripCandidatesToolResponseDto &&
    other.status == status &&
    other.toolCall == toolCall &&
    other.reason == reason &&
    _deepEquality.equals(other.candidates, candidates) &&
    other.recommendation == recommendation &&
    other.resultSize == resultSize &&
    other.summary == summary;

  @override
  int get hashCode =>
    // ignore: unnecessary_parenthesis
    (status.hashCode) +
    (toolCall.hashCode) +
    (reason.hashCode) +
    (candidates.hashCode) +
    (recommendation.hashCode) +
    (resultSize.hashCode) +
    (summary.hashCode);

  @override
  String toString() => 'AgentFindTripCandidatesToolResponseDto[status=$status, toolCall=$toolCall, reason=$reason, candidates=$candidates, recommendation=$recommendation, resultSize=$resultSize, summary=$summary]';

  Map<String, dynamic> toJson() {
    final json = <String, dynamic>{};
      json[r'status'] = this.status;
      json[r'toolCall'] = this.toolCall;
      json[r'reason'] = this.reason;
      json[r'candidates'] = this.candidates;
      json[r'recommendation'] = this.recommendation;
      json[r'resultSize'] = this.resultSize;
      json[r'summary'] = this.summary;
    return json;
  }

  /// Returns a new [AgentFindTripCandidatesToolResponseDto] instance and imports its values from
  /// [value] if it's a [Map], null otherwise.
  // ignore: prefer_constructors_over_static_methods
  static AgentFindTripCandidatesToolResponseDto? fromJson(dynamic value) {
    upgradeDto(value, "AgentFindTripCandidatesToolResponseDto");
    if (value is Map) {
      final json = value.cast<String, dynamic>();

      return AgentFindTripCandidatesToolResponseDto(
        status: AgentFindTripCandidatesToolResponseDtoStatusEnum.fromJson(json[r'status'])!,
        toolCall: AgentToolCallResponseDto.fromJson(json[r'toolCall'])!,
        reason: mapValueOfType<String>(json, r'reason')!,
        candidates: AgentTripCandidateSummary.listFromJson(json[r'candidates']),
        recommendation: AgentTripCandidateRecommendation.fromJson(json[r'recommendation'])!,
        resultSize: AgentToolResultSize.fromJson(json[r'resultSize'])!,
        summary: mapValueOfType<String>(json, r'summary')!,
      );
    }
    return null;
  }

  static List<AgentFindTripCandidatesToolResponseDto> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <AgentFindTripCandidatesToolResponseDto>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = AgentFindTripCandidatesToolResponseDto.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }

  static Map<String, AgentFindTripCandidatesToolResponseDto> mapFromJson(dynamic json) {
    final map = <String, AgentFindTripCandidatesToolResponseDto>{};
    if (json is Map && json.isNotEmpty) {
      json = json.cast<String, dynamic>(); // ignore: parameter_assignments
      for (final entry in json.entries) {
        final value = AgentFindTripCandidatesToolResponseDto.fromJson(entry.value);
        if (value != null) {
          map[entry.key] = value;
        }
      }
    }
    return map;
  }

  // maps a json object with a list of AgentFindTripCandidatesToolResponseDto-objects as value to a dart map
  static Map<String, List<AgentFindTripCandidatesToolResponseDto>> mapListFromJson(dynamic json, {bool growable = false,}) {
    final map = <String, List<AgentFindTripCandidatesToolResponseDto>>{};
    if (json is Map && json.isNotEmpty) {
      // ignore: parameter_assignments
      json = json.cast<String, dynamic>();
      for (final entry in json.entries) {
        map[entry.key] = AgentFindTripCandidatesToolResponseDto.listFromJson(entry.value, growable: growable,);
      }
    }
    return map;
  }

  /// The list of required keys that must be present in a JSON.
  static const requiredKeys = <String>{
    'status',
    'toolCall',
    'reason',
    'candidates',
    'recommendation',
    'resultSize',
    'summary',
  };
}


class AgentFindTripCandidatesToolResponseDtoStatusEnum {
  /// Instantiate a new enum with the provided [value].
  const AgentFindTripCandidatesToolResponseDtoStatusEnum._(this.value);

  /// The underlying value of this enum member.
  final String value;

  @override
  String toString() => value;

  String toJson() => value;

  static const success = AgentFindTripCandidatesToolResponseDtoStatusEnum._(r'success');

  /// List of all possible values in this [enum][AgentFindTripCandidatesToolResponseDtoStatusEnum].
  static const values = <AgentFindTripCandidatesToolResponseDtoStatusEnum>[
    success,
  ];

  static AgentFindTripCandidatesToolResponseDtoStatusEnum? fromJson(dynamic value) => AgentFindTripCandidatesToolResponseDtoStatusEnumTypeTransformer().decode(value);

  static List<AgentFindTripCandidatesToolResponseDtoStatusEnum> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <AgentFindTripCandidatesToolResponseDtoStatusEnum>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = AgentFindTripCandidatesToolResponseDtoStatusEnum.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }
}

/// Transformation class that can [encode] an instance of [AgentFindTripCandidatesToolResponseDtoStatusEnum] to String,
/// and [decode] dynamic data back to [AgentFindTripCandidatesToolResponseDtoStatusEnum].
class AgentFindTripCandidatesToolResponseDtoStatusEnumTypeTransformer {
  factory AgentFindTripCandidatesToolResponseDtoStatusEnumTypeTransformer() => _instance ??= const AgentFindTripCandidatesToolResponseDtoStatusEnumTypeTransformer._();

  const AgentFindTripCandidatesToolResponseDtoStatusEnumTypeTransformer._();

  String encode(AgentFindTripCandidatesToolResponseDtoStatusEnum data) => data.value;

  /// Decodes a [dynamic value][data] to a AgentFindTripCandidatesToolResponseDtoStatusEnum.
  ///
  /// If [allowNull] is true and the [dynamic value][data] cannot be decoded successfully,
  /// then null is returned. However, if [allowNull] is false and the [dynamic value][data]
  /// cannot be decoded successfully, then an [UnimplementedError] is thrown.
  ///
  /// The [allowNull] is very handy when an API changes and a new enum value is added or removed,
  /// and users are still using an old app with the old code.
  AgentFindTripCandidatesToolResponseDtoStatusEnum? decode(dynamic data, {bool allowNull = true}) {
    if (data != null) {
      switch (data) {
        case r'success': return AgentFindTripCandidatesToolResponseDtoStatusEnum.success;
        default:
          if (!allowNull) {
            throw ArgumentError('Unknown enum value to decode: $data');
          }
      }
    }
    return null;
  }

  /// Singleton [AgentFindTripCandidatesToolResponseDtoStatusEnumTypeTransformer] instance.
  static AgentFindTripCandidatesToolResponseDtoStatusEnumTypeTransformer? _instance;
}


