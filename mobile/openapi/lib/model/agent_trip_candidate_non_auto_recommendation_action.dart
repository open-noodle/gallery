//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;


class AgentTripCandidateNonAutoRecommendationAction {
  /// Instantiate a new enum with the provided [value].
  const AgentTripCandidateNonAutoRecommendationAction._(this.value);

  /// The underlying value of this enum member.
  final String value;

  @override
  String toString() => value;

  String toJson() => value;

  static const askUser = AgentTripCandidateNonAutoRecommendationAction._(r'ask_user');
  static const none = AgentTripCandidateNonAutoRecommendationAction._(r'none');

  /// List of all possible values in this [enum][AgentTripCandidateNonAutoRecommendationAction].
  static const values = <AgentTripCandidateNonAutoRecommendationAction>[
    askUser,
    none,
  ];

  static AgentTripCandidateNonAutoRecommendationAction? fromJson(dynamic value) => AgentTripCandidateNonAutoRecommendationActionTypeTransformer().decode(value);

  static List<AgentTripCandidateNonAutoRecommendationAction> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <AgentTripCandidateNonAutoRecommendationAction>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = AgentTripCandidateNonAutoRecommendationAction.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }
}

/// Transformation class that can [encode] an instance of [AgentTripCandidateNonAutoRecommendationAction] to String,
/// and [decode] dynamic data back to [AgentTripCandidateNonAutoRecommendationAction].
class AgentTripCandidateNonAutoRecommendationActionTypeTransformer {
  factory AgentTripCandidateNonAutoRecommendationActionTypeTransformer() => _instance ??= const AgentTripCandidateNonAutoRecommendationActionTypeTransformer._();

  const AgentTripCandidateNonAutoRecommendationActionTypeTransformer._();

  String encode(AgentTripCandidateNonAutoRecommendationAction data) => data.value;

  /// Decodes a [dynamic value][data] to a AgentTripCandidateNonAutoRecommendationAction.
  ///
  /// If [allowNull] is true and the [dynamic value][data] cannot be decoded successfully,
  /// then null is returned. However, if [allowNull] is false and the [dynamic value][data]
  /// cannot be decoded successfully, then an [UnimplementedError] is thrown.
  ///
  /// The [allowNull] is very handy when an API changes and a new enum value is added or removed,
  /// and users are still using an old app with the old code.
  AgentTripCandidateNonAutoRecommendationAction? decode(dynamic data, {bool allowNull = true}) {
    if (data != null) {
      switch (data) {
        case r'ask_user': return AgentTripCandidateNonAutoRecommendationAction.askUser;
        case r'none': return AgentTripCandidateNonAutoRecommendationAction.none;
        default:
          if (!allowNull) {
            throw ArgumentError('Unknown enum value to decode: $data');
          }
      }
    }
    return null;
  }

  /// Singleton [AgentTripCandidateNonAutoRecommendationActionTypeTransformer] instance.
  static AgentTripCandidateNonAutoRecommendationActionTypeTransformer? _instance;
}

