//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

class AgentFindTripCandidatesToolSuccessResponse {
  /// Returns a new [AgentFindTripCandidatesToolSuccessResponse] instance.
  AgentFindTripCandidatesToolSuccessResponse({
    this.candidates = const [],
    required this.recommendation,
    required this.resultSize,
    required this.status,
    required this.summary,
    required this.toolCall,
  });

  List<AgentTripCandidateSummary> candidates;

  AgentTripCandidateRecommendation recommendation;

  AgentToolResultSize resultSize;

  AgentFindTripCandidatesToolSuccessResponseStatusEnum status;

  String summary;

  AgentToolCallResponseDto toolCall;

  @override
  bool operator ==(Object other) => identical(this, other) || other is AgentFindTripCandidatesToolSuccessResponse &&
    _deepEquality.equals(other.candidates, candidates) &&
    other.recommendation == recommendation &&
    other.resultSize == resultSize &&
    other.status == status &&
    other.summary == summary &&
    other.toolCall == toolCall;

  @override
  int get hashCode =>
    // ignore: unnecessary_parenthesis
    (candidates.hashCode) +
    (recommendation.hashCode) +
    (resultSize.hashCode) +
    (status.hashCode) +
    (summary.hashCode) +
    (toolCall.hashCode);

  @override
  String toString() => 'AgentFindTripCandidatesToolSuccessResponse[candidates=$candidates, recommendation=$recommendation, resultSize=$resultSize, status=$status, summary=$summary, toolCall=$toolCall]';

  Map<String, dynamic> toJson() {
    final json = <String, dynamic>{};
      json[r'candidates'] = this.candidates;
      json[r'recommendation'] = this.recommendation;
      json[r'resultSize'] = this.resultSize;
      json[r'status'] = this.status;
      json[r'summary'] = this.summary;
      json[r'toolCall'] = this.toolCall;
    return json;
  }

  /// Returns a new [AgentFindTripCandidatesToolSuccessResponse] instance and imports its values from
  /// [value] if it's a [Map], null otherwise.
  // ignore: prefer_constructors_over_static_methods
  static AgentFindTripCandidatesToolSuccessResponse? fromJson(dynamic value) {
    upgradeDto(value, "AgentFindTripCandidatesToolSuccessResponse");
    if (value is Map) {
      final json = value.cast<String, dynamic>();

      return AgentFindTripCandidatesToolSuccessResponse(
        candidates: AgentTripCandidateSummary.listFromJson(json[r'candidates']),
        recommendation: AgentTripCandidateRecommendation.fromJson(json[r'recommendation'])!,
        resultSize: AgentToolResultSize.fromJson(json[r'resultSize'])!,
        status: AgentFindTripCandidatesToolSuccessResponseStatusEnum.fromJson(json[r'status'])!,
        summary: mapValueOfType<String>(json, r'summary')!,
        toolCall: AgentToolCallResponseDto.fromJson(json[r'toolCall'])!,
      );
    }
    return null;
  }

  static List<AgentFindTripCandidatesToolSuccessResponse> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <AgentFindTripCandidatesToolSuccessResponse>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = AgentFindTripCandidatesToolSuccessResponse.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }

  static Map<String, AgentFindTripCandidatesToolSuccessResponse> mapFromJson(dynamic json) {
    final map = <String, AgentFindTripCandidatesToolSuccessResponse>{};
    if (json is Map && json.isNotEmpty) {
      json = json.cast<String, dynamic>(); // ignore: parameter_assignments
      for (final entry in json.entries) {
        final value = AgentFindTripCandidatesToolSuccessResponse.fromJson(entry.value);
        if (value != null) {
          map[entry.key] = value;
        }
      }
    }
    return map;
  }

  // maps a json object with a list of AgentFindTripCandidatesToolSuccessResponse-objects as value to a dart map
  static Map<String, List<AgentFindTripCandidatesToolSuccessResponse>> mapListFromJson(dynamic json, {bool growable = false,}) {
    final map = <String, List<AgentFindTripCandidatesToolSuccessResponse>>{};
    if (json is Map && json.isNotEmpty) {
      // ignore: parameter_assignments
      json = json.cast<String, dynamic>();
      for (final entry in json.entries) {
        map[entry.key] = AgentFindTripCandidatesToolSuccessResponse.listFromJson(entry.value, growable: growable,);
      }
    }
    return map;
  }

  /// The list of required keys that must be present in a JSON.
  static const requiredKeys = <String>{
    'candidates',
    'recommendation',
    'resultSize',
    'status',
    'summary',
    'toolCall',
  };
}


class AgentFindTripCandidatesToolSuccessResponseStatusEnum {
  /// Instantiate a new enum with the provided [value].
  const AgentFindTripCandidatesToolSuccessResponseStatusEnum._(this.value);

  /// The underlying value of this enum member.
  final String value;

  @override
  String toString() => value;

  String toJson() => value;

  static const success = AgentFindTripCandidatesToolSuccessResponseStatusEnum._(r'success');

  /// List of all possible values in this [enum][AgentFindTripCandidatesToolSuccessResponseStatusEnum].
  static const values = <AgentFindTripCandidatesToolSuccessResponseStatusEnum>[
    success,
  ];

  static AgentFindTripCandidatesToolSuccessResponseStatusEnum? fromJson(dynamic value) => AgentFindTripCandidatesToolSuccessResponseStatusEnumTypeTransformer().decode(value);

  static List<AgentFindTripCandidatesToolSuccessResponseStatusEnum> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <AgentFindTripCandidatesToolSuccessResponseStatusEnum>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = AgentFindTripCandidatesToolSuccessResponseStatusEnum.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }
}

/// Transformation class that can [encode] an instance of [AgentFindTripCandidatesToolSuccessResponseStatusEnum] to String,
/// and [decode] dynamic data back to [AgentFindTripCandidatesToolSuccessResponseStatusEnum].
class AgentFindTripCandidatesToolSuccessResponseStatusEnumTypeTransformer {
  factory AgentFindTripCandidatesToolSuccessResponseStatusEnumTypeTransformer() => _instance ??= const AgentFindTripCandidatesToolSuccessResponseStatusEnumTypeTransformer._();

  const AgentFindTripCandidatesToolSuccessResponseStatusEnumTypeTransformer._();

  String encode(AgentFindTripCandidatesToolSuccessResponseStatusEnum data) => data.value;

  /// Decodes a [dynamic value][data] to a AgentFindTripCandidatesToolSuccessResponseStatusEnum.
  ///
  /// If [allowNull] is true and the [dynamic value][data] cannot be decoded successfully,
  /// then null is returned. However, if [allowNull] is false and the [dynamic value][data]
  /// cannot be decoded successfully, then an [UnimplementedError] is thrown.
  ///
  /// The [allowNull] is very handy when an API changes and a new enum value is added or removed,
  /// and users are still using an old app with the old code.
  AgentFindTripCandidatesToolSuccessResponseStatusEnum? decode(dynamic data, {bool allowNull = true}) {
    if (data != null) {
      switch (data) {
        case r'success': return AgentFindTripCandidatesToolSuccessResponseStatusEnum.success;
        default:
          if (!allowNull) {
            throw ArgumentError('Unknown enum value to decode: $data');
          }
      }
    }
    return null;
  }

  /// Singleton [AgentFindTripCandidatesToolSuccessResponseStatusEnumTypeTransformer] instance.
  static AgentFindTripCandidatesToolSuccessResponseStatusEnumTypeTransformer? _instance;
}


