//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

class FaceRepairResponseDtoReportTotalsReviewOnlyByReason {
  /// Returns a new [FaceRepairResponseDtoReportTotalsReviewOnlyByReason] instance.
  FaceRepairResponseDtoReportTotalsReviewOnlyByReason({
    required this.badTarget,
    required this.overCap,
    required this.unAttributable,
  });

  num badTarget;

  num overCap;

  num unAttributable;

  @override
  bool operator ==(Object other) => identical(this, other) || other is FaceRepairResponseDtoReportTotalsReviewOnlyByReason &&
    other.badTarget == badTarget &&
    other.overCap == overCap &&
    other.unAttributable == unAttributable;

  @override
  int get hashCode =>
    // ignore: unnecessary_parenthesis
    (badTarget.hashCode) +
    (overCap.hashCode) +
    (unAttributable.hashCode);

  @override
  String toString() => 'FaceRepairResponseDtoReportTotalsReviewOnlyByReason[badTarget=$badTarget, overCap=$overCap, unAttributable=$unAttributable]';

  Map<String, dynamic> toJson() {
    final json = <String, dynamic>{};
      json[r'badTarget'] = this.badTarget;
      json[r'overCap'] = this.overCap;
      json[r'unAttributable'] = this.unAttributable;
    return json;
  }

  /// Returns a new [FaceRepairResponseDtoReportTotalsReviewOnlyByReason] instance and imports its values from
  /// [value] if it's a [Map], null otherwise.
  // ignore: prefer_constructors_over_static_methods
  static FaceRepairResponseDtoReportTotalsReviewOnlyByReason? fromJson(dynamic value) {
    upgradeDto(value, "FaceRepairResponseDtoReportTotalsReviewOnlyByReason");
    if (value is Map) {
      final json = value.cast<String, dynamic>();

      return FaceRepairResponseDtoReportTotalsReviewOnlyByReason(
        badTarget: num.parse('${json[r'badTarget']}'),
        overCap: num.parse('${json[r'overCap']}'),
        unAttributable: num.parse('${json[r'unAttributable']}'),
      );
    }
    return null;
  }

  static List<FaceRepairResponseDtoReportTotalsReviewOnlyByReason> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <FaceRepairResponseDtoReportTotalsReviewOnlyByReason>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = FaceRepairResponseDtoReportTotalsReviewOnlyByReason.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }

  static Map<String, FaceRepairResponseDtoReportTotalsReviewOnlyByReason> mapFromJson(dynamic json) {
    final map = <String, FaceRepairResponseDtoReportTotalsReviewOnlyByReason>{};
    if (json is Map && json.isNotEmpty) {
      json = json.cast<String, dynamic>(); // ignore: parameter_assignments
      for (final entry in json.entries) {
        final value = FaceRepairResponseDtoReportTotalsReviewOnlyByReason.fromJson(entry.value);
        if (value != null) {
          map[entry.key] = value;
        }
      }
    }
    return map;
  }

  // maps a json object with a list of FaceRepairResponseDtoReportTotalsReviewOnlyByReason-objects as value to a dart map
  static Map<String, List<FaceRepairResponseDtoReportTotalsReviewOnlyByReason>> mapListFromJson(dynamic json, {bool growable = false,}) {
    final map = <String, List<FaceRepairResponseDtoReportTotalsReviewOnlyByReason>>{};
    if (json is Map && json.isNotEmpty) {
      // ignore: parameter_assignments
      json = json.cast<String, dynamic>();
      for (final entry in json.entries) {
        map[entry.key] = FaceRepairResponseDtoReportTotalsReviewOnlyByReason.listFromJson(entry.value, growable: growable,);
      }
    }
    return map;
  }

  /// The list of required keys that must be present in a JSON.
  static const requiredKeys = <String>{
    'badTarget',
    'overCap',
    'unAttributable',
  };
}

