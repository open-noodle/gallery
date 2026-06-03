//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

class FaceRepairResponseDtoReportTotals {
  /// Returns a new [FaceRepairResponseDtoReportTotals] instance.
  FaceRepairResponseDtoReportTotals({
    required this.affectedPersons,
    required this.eligibleFaces,
    required this.flaggedFaces,
    required this.reviewOnlyByReason,
    required this.reviewOnlyFaces,
    required this.reviewOnlyPersons,
    required this.toRepair,
  });

  num affectedPersons;

  num eligibleFaces;

  num flaggedFaces;

  FaceRepairResponseDtoReportTotalsReviewOnlyByReason reviewOnlyByReason;

  num reviewOnlyFaces;

  num reviewOnlyPersons;

  num toRepair;

  @override
  bool operator ==(Object other) => identical(this, other) || other is FaceRepairResponseDtoReportTotals &&
    other.affectedPersons == affectedPersons &&
    other.eligibleFaces == eligibleFaces &&
    other.flaggedFaces == flaggedFaces &&
    other.reviewOnlyByReason == reviewOnlyByReason &&
    other.reviewOnlyFaces == reviewOnlyFaces &&
    other.reviewOnlyPersons == reviewOnlyPersons &&
    other.toRepair == toRepair;

  @override
  int get hashCode =>
    // ignore: unnecessary_parenthesis
    (affectedPersons.hashCode) +
    (eligibleFaces.hashCode) +
    (flaggedFaces.hashCode) +
    (reviewOnlyByReason.hashCode) +
    (reviewOnlyFaces.hashCode) +
    (reviewOnlyPersons.hashCode) +
    (toRepair.hashCode);

  @override
  String toString() => 'FaceRepairResponseDtoReportTotals[affectedPersons=$affectedPersons, eligibleFaces=$eligibleFaces, flaggedFaces=$flaggedFaces, reviewOnlyByReason=$reviewOnlyByReason, reviewOnlyFaces=$reviewOnlyFaces, reviewOnlyPersons=$reviewOnlyPersons, toRepair=$toRepair]';

  Map<String, dynamic> toJson() {
    final json = <String, dynamic>{};
      json[r'affectedPersons'] = this.affectedPersons;
      json[r'eligibleFaces'] = this.eligibleFaces;
      json[r'flaggedFaces'] = this.flaggedFaces;
      json[r'reviewOnlyByReason'] = this.reviewOnlyByReason;
      json[r'reviewOnlyFaces'] = this.reviewOnlyFaces;
      json[r'reviewOnlyPersons'] = this.reviewOnlyPersons;
      json[r'toRepair'] = this.toRepair;
    return json;
  }

  /// Returns a new [FaceRepairResponseDtoReportTotals] instance and imports its values from
  /// [value] if it's a [Map], null otherwise.
  // ignore: prefer_constructors_over_static_methods
  static FaceRepairResponseDtoReportTotals? fromJson(dynamic value) {
    upgradeDto(value, "FaceRepairResponseDtoReportTotals");
    if (value is Map) {
      final json = value.cast<String, dynamic>();

      return FaceRepairResponseDtoReportTotals(
        affectedPersons: num.parse('${json[r'affectedPersons']}'),
        eligibleFaces: num.parse('${json[r'eligibleFaces']}'),
        flaggedFaces: num.parse('${json[r'flaggedFaces']}'),
        reviewOnlyByReason: FaceRepairResponseDtoReportTotalsReviewOnlyByReason.fromJson(json[r'reviewOnlyByReason'])!,
        reviewOnlyFaces: num.parse('${json[r'reviewOnlyFaces']}'),
        reviewOnlyPersons: num.parse('${json[r'reviewOnlyPersons']}'),
        toRepair: num.parse('${json[r'toRepair']}'),
      );
    }
    return null;
  }

  static List<FaceRepairResponseDtoReportTotals> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <FaceRepairResponseDtoReportTotals>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = FaceRepairResponseDtoReportTotals.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }

  static Map<String, FaceRepairResponseDtoReportTotals> mapFromJson(dynamic json) {
    final map = <String, FaceRepairResponseDtoReportTotals>{};
    if (json is Map && json.isNotEmpty) {
      json = json.cast<String, dynamic>(); // ignore: parameter_assignments
      for (final entry in json.entries) {
        final value = FaceRepairResponseDtoReportTotals.fromJson(entry.value);
        if (value != null) {
          map[entry.key] = value;
        }
      }
    }
    return map;
  }

  // maps a json object with a list of FaceRepairResponseDtoReportTotals-objects as value to a dart map
  static Map<String, List<FaceRepairResponseDtoReportTotals>> mapListFromJson(dynamic json, {bool growable = false,}) {
    final map = <String, List<FaceRepairResponseDtoReportTotals>>{};
    if (json is Map && json.isNotEmpty) {
      // ignore: parameter_assignments
      json = json.cast<String, dynamic>();
      for (final entry in json.entries) {
        map[entry.key] = FaceRepairResponseDtoReportTotals.listFromJson(entry.value, growable: growable,);
      }
    }
    return map;
  }

  /// The list of required keys that must be present in a JSON.
  static const requiredKeys = <String>{
    'affectedPersons',
    'eligibleFaces',
    'flaggedFaces',
    'reviewOnlyByReason',
    'reviewOnlyFaces',
    'reviewOnlyPersons',
    'toRepair',
  };
}

