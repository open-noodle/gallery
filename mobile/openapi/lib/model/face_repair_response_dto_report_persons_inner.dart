//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

class FaceRepairResponseDtoReportPersonsInner {
  /// Returns a new [FaceRepairResponseDtoReportPersonsInner] instance.
  FaceRepairResponseDtoReportPersonsInner({
    required this.eligible,
    required this.flagged,
    required this.flaggedFraction,
    required this.personId,
    required this.reviewOnly,
    this.suspectedOwners = const [],
  });

  num eligible;

  num flagged;

  num flaggedFraction;

  String personId;

  bool reviewOnly;

  List<FaceRepairResponseDtoReportPersonsInnerSuspectedOwnersInner> suspectedOwners;

  @override
  bool operator ==(Object other) => identical(this, other) || other is FaceRepairResponseDtoReportPersonsInner &&
    other.eligible == eligible &&
    other.flagged == flagged &&
    other.flaggedFraction == flaggedFraction &&
    other.personId == personId &&
    other.reviewOnly == reviewOnly &&
    _deepEquality.equals(other.suspectedOwners, suspectedOwners);

  @override
  int get hashCode =>
    // ignore: unnecessary_parenthesis
    (eligible.hashCode) +
    (flagged.hashCode) +
    (flaggedFraction.hashCode) +
    (personId.hashCode) +
    (reviewOnly.hashCode) +
    (suspectedOwners.hashCode);

  @override
  String toString() => 'FaceRepairResponseDtoReportPersonsInner[eligible=$eligible, flagged=$flagged, flaggedFraction=$flaggedFraction, personId=$personId, reviewOnly=$reviewOnly, suspectedOwners=$suspectedOwners]';

  Map<String, dynamic> toJson() {
    final json = <String, dynamic>{};
      json[r'eligible'] = this.eligible;
      json[r'flagged'] = this.flagged;
      json[r'flaggedFraction'] = this.flaggedFraction;
      json[r'personId'] = this.personId;
      json[r'reviewOnly'] = this.reviewOnly;
      json[r'suspectedOwners'] = this.suspectedOwners;
    return json;
  }

  /// Returns a new [FaceRepairResponseDtoReportPersonsInner] instance and imports its values from
  /// [value] if it's a [Map], null otherwise.
  // ignore: prefer_constructors_over_static_methods
  static FaceRepairResponseDtoReportPersonsInner? fromJson(dynamic value) {
    upgradeDto(value, "FaceRepairResponseDtoReportPersonsInner");
    if (value is Map) {
      final json = value.cast<String, dynamic>();

      return FaceRepairResponseDtoReportPersonsInner(
        eligible: num.parse('${json[r'eligible']}'),
        flagged: num.parse('${json[r'flagged']}'),
        flaggedFraction: num.parse('${json[r'flaggedFraction']}'),
        personId: mapValueOfType<String>(json, r'personId')!,
        reviewOnly: mapValueOfType<bool>(json, r'reviewOnly')!,
        suspectedOwners: FaceRepairResponseDtoReportPersonsInnerSuspectedOwnersInner.listFromJson(json[r'suspectedOwners']),
      );
    }
    return null;
  }

  static List<FaceRepairResponseDtoReportPersonsInner> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <FaceRepairResponseDtoReportPersonsInner>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = FaceRepairResponseDtoReportPersonsInner.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }

  static Map<String, FaceRepairResponseDtoReportPersonsInner> mapFromJson(dynamic json) {
    final map = <String, FaceRepairResponseDtoReportPersonsInner>{};
    if (json is Map && json.isNotEmpty) {
      json = json.cast<String, dynamic>(); // ignore: parameter_assignments
      for (final entry in json.entries) {
        final value = FaceRepairResponseDtoReportPersonsInner.fromJson(entry.value);
        if (value != null) {
          map[entry.key] = value;
        }
      }
    }
    return map;
  }

  // maps a json object with a list of FaceRepairResponseDtoReportPersonsInner-objects as value to a dart map
  static Map<String, List<FaceRepairResponseDtoReportPersonsInner>> mapListFromJson(dynamic json, {bool growable = false,}) {
    final map = <String, List<FaceRepairResponseDtoReportPersonsInner>>{};
    if (json is Map && json.isNotEmpty) {
      // ignore: parameter_assignments
      json = json.cast<String, dynamic>();
      for (final entry in json.entries) {
        map[entry.key] = FaceRepairResponseDtoReportPersonsInner.listFromJson(entry.value, growable: growable,);
      }
    }
    return map;
  }

  /// The list of required keys that must be present in a JSON.
  static const requiredKeys = <String>{
    'eligible',
    'flagged',
    'flaggedFraction',
    'personId',
    'reviewOnly',
    'suspectedOwners',
  };
}

