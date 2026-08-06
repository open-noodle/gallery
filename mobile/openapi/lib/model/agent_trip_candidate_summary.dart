//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

class AgentTripCandidateSummary {
  /// Returns a new [AgentTripCandidateSummary] instance.
  AgentTripCandidateSummary({
    required this.albumAssetCount,
    required this.assetCount,
    this.cities = const [],
    required this.confidence,
    this.countries = const [],
    required this.dayCount,
    required this.dedupeKey,
    required this.excludedDuplicateCount,
    required this.excludedStackChildCount,
    this.placeLabels = const [],
    required this.score,
    required this.selectionHandle,
    this.states = const [],
    required this.subtitle,
    required this.takenAfter,
    required this.takenBefore,
    required this.title,
  });

  /// Minimum value: 0
  /// Maximum value: 9007199254740991
  int albumAssetCount;

  /// Minimum value: 0
  /// Maximum value: 9007199254740991
  int assetCount;

  List<String> cities;

  AgentTripCandidateConfidence confidence;

  List<String> countries;

  /// Minimum value: 0
  /// Maximum value: 9007199254740991
  int dayCount;

  String dedupeKey;

  /// Minimum value: 0
  /// Maximum value: 9007199254740991
  int excludedDuplicateCount;

  /// Minimum value: 0
  /// Maximum value: 9007199254740991
  int excludedStackChildCount;

  List<String> placeLabels;

  /// Minimum value: 0
  /// Maximum value: 9007199254740991
  int score;

  AgentSearchAssetsSelectionHandle selectionHandle;

  List<String> states;

  String subtitle;

  DateTime takenAfter;

  DateTime takenBefore;

  String title;

  @override
  bool operator ==(Object other) => identical(this, other) || other is AgentTripCandidateSummary &&
    other.albumAssetCount == albumAssetCount &&
    other.assetCount == assetCount &&
    _deepEquality.equals(other.cities, cities) &&
    other.confidence == confidence &&
    _deepEquality.equals(other.countries, countries) &&
    other.dayCount == dayCount &&
    other.dedupeKey == dedupeKey &&
    other.excludedDuplicateCount == excludedDuplicateCount &&
    other.excludedStackChildCount == excludedStackChildCount &&
    _deepEquality.equals(other.placeLabels, placeLabels) &&
    other.score == score &&
    other.selectionHandle == selectionHandle &&
    _deepEquality.equals(other.states, states) &&
    other.subtitle == subtitle &&
    other.takenAfter == takenAfter &&
    other.takenBefore == takenBefore &&
    other.title == title;

  @override
  int get hashCode =>
    // ignore: unnecessary_parenthesis
    (albumAssetCount.hashCode) +
    (assetCount.hashCode) +
    (cities.hashCode) +
    (confidence.hashCode) +
    (countries.hashCode) +
    (dayCount.hashCode) +
    (dedupeKey.hashCode) +
    (excludedDuplicateCount.hashCode) +
    (excludedStackChildCount.hashCode) +
    (placeLabels.hashCode) +
    (score.hashCode) +
    (selectionHandle.hashCode) +
    (states.hashCode) +
    (subtitle.hashCode) +
    (takenAfter.hashCode) +
    (takenBefore.hashCode) +
    (title.hashCode);

  @override
  String toString() => 'AgentTripCandidateSummary[albumAssetCount=$albumAssetCount, assetCount=$assetCount, cities=$cities, confidence=$confidence, countries=$countries, dayCount=$dayCount, dedupeKey=$dedupeKey, excludedDuplicateCount=$excludedDuplicateCount, excludedStackChildCount=$excludedStackChildCount, placeLabels=$placeLabels, score=$score, selectionHandle=$selectionHandle, states=$states, subtitle=$subtitle, takenAfter=$takenAfter, takenBefore=$takenBefore, title=$title]';

  Map<String, dynamic> toJson() {
    final json = <String, dynamic>{};
      json[r'albumAssetCount'] = this.albumAssetCount;
      json[r'assetCount'] = this.assetCount;
      json[r'cities'] = this.cities;
      json[r'confidence'] = this.confidence;
      json[r'countries'] = this.countries;
      json[r'dayCount'] = this.dayCount;
      json[r'dedupeKey'] = this.dedupeKey;
      json[r'excludedDuplicateCount'] = this.excludedDuplicateCount;
      json[r'excludedStackChildCount'] = this.excludedStackChildCount;
      json[r'placeLabels'] = this.placeLabels;
      json[r'score'] = this.score;
      json[r'selectionHandle'] = this.selectionHandle;
      json[r'states'] = this.states;
      json[r'subtitle'] = this.subtitle;
      json[r'takenAfter'] = _isEpochMarker(r'/^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))T(?:(?:[01]\\d|2[0-3]):[0-5]\\d(?::[0-5]\\d(?:\\.\\d+)?)?(?:Z|([+-](?:[01]\\d|2[0-3]):[0-5]\\d)))$/')
        ? this.takenAfter.millisecondsSinceEpoch
        : this.takenAfter.toUtc().toIso8601String();
      json[r'takenBefore'] = _isEpochMarker(r'/^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))T(?:(?:[01]\\d|2[0-3]):[0-5]\\d(?::[0-5]\\d(?:\\.\\d+)?)?(?:Z|([+-](?:[01]\\d|2[0-3]):[0-5]\\d)))$/')
        ? this.takenBefore.millisecondsSinceEpoch
        : this.takenBefore.toUtc().toIso8601String();
      json[r'title'] = this.title;
    return json;
  }

  /// Returns a new [AgentTripCandidateSummary] instance and imports its values from
  /// [value] if it's a [Map], null otherwise.
  // ignore: prefer_constructors_over_static_methods
  static AgentTripCandidateSummary? fromJson(dynamic value) {
    upgradeDto(value, "AgentTripCandidateSummary");
    if (value is Map) {
      final json = value.cast<String, dynamic>();

      return AgentTripCandidateSummary(
        albumAssetCount: mapValueOfType<int>(json, r'albumAssetCount')!,
        assetCount: mapValueOfType<int>(json, r'assetCount')!,
        cities: json[r'cities'] is Iterable
            ? (json[r'cities'] as Iterable).cast<String>().toList(growable: false)
            : const [],
        confidence: AgentTripCandidateConfidence.fromJson(json[r'confidence'])!,
        countries: json[r'countries'] is Iterable
            ? (json[r'countries'] as Iterable).cast<String>().toList(growable: false)
            : const [],
        dayCount: mapValueOfType<int>(json, r'dayCount')!,
        dedupeKey: mapValueOfType<String>(json, r'dedupeKey')!,
        excludedDuplicateCount: mapValueOfType<int>(json, r'excludedDuplicateCount')!,
        excludedStackChildCount: mapValueOfType<int>(json, r'excludedStackChildCount')!,
        placeLabels: json[r'placeLabels'] is Iterable
            ? (json[r'placeLabels'] as Iterable).cast<String>().toList(growable: false)
            : const [],
        score: mapValueOfType<int>(json, r'score')!,
        selectionHandle: AgentSearchAssetsSelectionHandle.fromJson(json[r'selectionHandle'])!,
        states: json[r'states'] is Iterable
            ? (json[r'states'] as Iterable).cast<String>().toList(growable: false)
            : const [],
        subtitle: mapValueOfType<String>(json, r'subtitle')!,
        takenAfter: mapDateTime(json, r'takenAfter', r'/^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))T(?:(?:[01]\\d|2[0-3]):[0-5]\\d(?::[0-5]\\d(?:\\.\\d+)?)?(?:Z|([+-](?:[01]\\d|2[0-3]):[0-5]\\d)))$/')!,
        takenBefore: mapDateTime(json, r'takenBefore', r'/^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))T(?:(?:[01]\\d|2[0-3]):[0-5]\\d(?::[0-5]\\d(?:\\.\\d+)?)?(?:Z|([+-](?:[01]\\d|2[0-3]):[0-5]\\d)))$/')!,
        title: mapValueOfType<String>(json, r'title')!,
      );
    }
    return null;
  }

  static List<AgentTripCandidateSummary> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <AgentTripCandidateSummary>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = AgentTripCandidateSummary.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }

  static Map<String, AgentTripCandidateSummary> mapFromJson(dynamic json) {
    final map = <String, AgentTripCandidateSummary>{};
    if (json is Map && json.isNotEmpty) {
      json = json.cast<String, dynamic>(); // ignore: parameter_assignments
      for (final entry in json.entries) {
        final value = AgentTripCandidateSummary.fromJson(entry.value);
        if (value != null) {
          map[entry.key] = value;
        }
      }
    }
    return map;
  }

  // maps a json object with a list of AgentTripCandidateSummary-objects as value to a dart map
  static Map<String, List<AgentTripCandidateSummary>> mapListFromJson(dynamic json, {bool growable = false,}) {
    final map = <String, List<AgentTripCandidateSummary>>{};
    if (json is Map && json.isNotEmpty) {
      // ignore: parameter_assignments
      json = json.cast<String, dynamic>();
      for (final entry in json.entries) {
        map[entry.key] = AgentTripCandidateSummary.listFromJson(entry.value, growable: growable,);
      }
    }
    return map;
  }

  /// The list of required keys that must be present in a JSON.
  static const requiredKeys = <String>{
    'albumAssetCount',
    'assetCount',
    'cities',
    'confidence',
    'countries',
    'dayCount',
    'dedupeKey',
    'excludedDuplicateCount',
    'excludedStackChildCount',
    'placeLabels',
    'score',
    'selectionHandle',
    'states',
    'subtitle',
    'takenAfter',
    'takenBefore',
    'title',
  };
}

