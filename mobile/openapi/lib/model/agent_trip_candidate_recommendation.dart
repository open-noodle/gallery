//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

class AgentTripCandidateRecommendation {
  /// Returns a new [AgentTripCandidateRecommendation] instance.
  AgentTripCandidateRecommendation({
    required this.action,
    required this.candidateDedupeKey,
    required this.reason,
  });

  AgentTripCandidateNonAutoRecommendationAction action;

  String candidateDedupeKey;

  String reason;

  @override
  bool operator ==(Object other) => identical(this, other) || other is AgentTripCandidateRecommendation &&
    other.action == action &&
    other.candidateDedupeKey == candidateDedupeKey &&
    other.reason == reason;

  @override
  int get hashCode =>
    // ignore: unnecessary_parenthesis
    (action.hashCode) +
    (candidateDedupeKey.hashCode) +
    (reason.hashCode);

  @override
  String toString() => 'AgentTripCandidateRecommendation[action=$action, candidateDedupeKey=$candidateDedupeKey, reason=$reason]';

  Map<String, dynamic> toJson() {
    final json = <String, dynamic>{};
      json[r'action'] = this.action;
      json[r'candidateDedupeKey'] = this.candidateDedupeKey;
      json[r'reason'] = this.reason;
    return json;
  }

  /// Returns a new [AgentTripCandidateRecommendation] instance and imports its values from
  /// [value] if it's a [Map], null otherwise.
  // ignore: prefer_constructors_over_static_methods
  static AgentTripCandidateRecommendation? fromJson(dynamic value) {
    upgradeDto(value, "AgentTripCandidateRecommendation");
    if (value is Map) {
      final json = value.cast<String, dynamic>();

      return AgentTripCandidateRecommendation(
        action: AgentTripCandidateNonAutoRecommendationAction.fromJson(json[r'action'])!,
        candidateDedupeKey: mapValueOfType<String>(json, r'candidateDedupeKey')!,
        reason: mapValueOfType<String>(json, r'reason')!,
      );
    }
    return null;
  }

  static List<AgentTripCandidateRecommendation> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <AgentTripCandidateRecommendation>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = AgentTripCandidateRecommendation.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }

  static Map<String, AgentTripCandidateRecommendation> mapFromJson(dynamic json) {
    final map = <String, AgentTripCandidateRecommendation>{};
    if (json is Map && json.isNotEmpty) {
      json = json.cast<String, dynamic>(); // ignore: parameter_assignments
      for (final entry in json.entries) {
        final value = AgentTripCandidateRecommendation.fromJson(entry.value);
        if (value != null) {
          map[entry.key] = value;
        }
      }
    }
    return map;
  }

  // maps a json object with a list of AgentTripCandidateRecommendation-objects as value to a dart map
  static Map<String, List<AgentTripCandidateRecommendation>> mapListFromJson(dynamic json, {bool growable = false,}) {
    final map = <String, List<AgentTripCandidateRecommendation>>{};
    if (json is Map && json.isNotEmpty) {
      // ignore: parameter_assignments
      json = json.cast<String, dynamic>();
      for (final entry in json.entries) {
        map[entry.key] = AgentTripCandidateRecommendation.listFromJson(entry.value, growable: growable,);
      }
    }
    return map;
  }

  /// The list of required keys that must be present in a JSON.
  static const requiredKeys = <String>{
    'action',
    'candidateDedupeKey',
    'reason',
  };
}

