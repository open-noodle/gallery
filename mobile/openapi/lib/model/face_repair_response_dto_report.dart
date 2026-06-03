//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

class FaceRepairResponseDtoReport {
  /// Returns a new [FaceRepairResponseDtoReport] instance.
  FaceRepairResponseDtoReport({
    this.persons = const [],
    required this.totals,
  });

  List<FaceRepairResponseDtoReportPersonsInner> persons;

  FaceRepairResponseDtoReportTotals totals;

  @override
  bool operator ==(Object other) => identical(this, other) || other is FaceRepairResponseDtoReport &&
    _deepEquality.equals(other.persons, persons) &&
    other.totals == totals;

  @override
  int get hashCode =>
    // ignore: unnecessary_parenthesis
    (persons.hashCode) +
    (totals.hashCode);

  @override
  String toString() => 'FaceRepairResponseDtoReport[persons=$persons, totals=$totals]';

  Map<String, dynamic> toJson() {
    final json = <String, dynamic>{};
      json[r'persons'] = this.persons;
      json[r'totals'] = this.totals;
    return json;
  }

  /// Returns a new [FaceRepairResponseDtoReport] instance and imports its values from
  /// [value] if it's a [Map], null otherwise.
  // ignore: prefer_constructors_over_static_methods
  static FaceRepairResponseDtoReport? fromJson(dynamic value) {
    upgradeDto(value, "FaceRepairResponseDtoReport");
    if (value is Map) {
      final json = value.cast<String, dynamic>();

      return FaceRepairResponseDtoReport(
        persons: FaceRepairResponseDtoReportPersonsInner.listFromJson(json[r'persons']),
        totals: FaceRepairResponseDtoReportTotals.fromJson(json[r'totals'])!,
      );
    }
    return null;
  }

  static List<FaceRepairResponseDtoReport> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <FaceRepairResponseDtoReport>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = FaceRepairResponseDtoReport.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }

  static Map<String, FaceRepairResponseDtoReport> mapFromJson(dynamic json) {
    final map = <String, FaceRepairResponseDtoReport>{};
    if (json is Map && json.isNotEmpty) {
      json = json.cast<String, dynamic>(); // ignore: parameter_assignments
      for (final entry in json.entries) {
        final value = FaceRepairResponseDtoReport.fromJson(entry.value);
        if (value != null) {
          map[entry.key] = value;
        }
      }
    }
    return map;
  }

  // maps a json object with a list of FaceRepairResponseDtoReport-objects as value to a dart map
  static Map<String, List<FaceRepairResponseDtoReport>> mapListFromJson(dynamic json, {bool growable = false,}) {
    final map = <String, List<FaceRepairResponseDtoReport>>{};
    if (json is Map && json.isNotEmpty) {
      // ignore: parameter_assignments
      json = json.cast<String, dynamic>();
      for (final entry in json.entries) {
        map[entry.key] = FaceRepairResponseDtoReport.listFromJson(entry.value, growable: growable,);
      }
    }
    return map;
  }

  /// The list of required keys that must be present in a JSON.
  static const requiredKeys = <String>{
    'persons',
    'totals',
  };
}

