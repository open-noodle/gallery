//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

class FamilyUnionUpdateDto {
  /// Returns a new [FamilyUnionUpdateDto] instance.
  FamilyUnionUpdateDto({
    this.endDate = const Optional.absent(),
    this.startDate = const Optional.absent(),
    this.status = const Optional.absent(),
  });

  /// Union end date
  Optional<DateTime?> endDate;

  /// Union start date
  Optional<DateTime?> startDate;

  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  Optional<FamilyUnionStatus?> status;

  @override
  bool operator ==(Object other) => identical(this, other) || other is FamilyUnionUpdateDto &&
    other.endDate == endDate &&
    other.startDate == startDate &&
    other.status == status;

  @override
  int get hashCode =>
    // ignore: unnecessary_parenthesis
    (endDate == null ? 0 : endDate!.hashCode) +
    (startDate == null ? 0 : startDate!.hashCode) +
    (status == null ? 0 : status!.hashCode);

  @override
  String toString() => 'FamilyUnionUpdateDto[endDate=$endDate, startDate=$startDate, status=$status]';

  Map<String, dynamic> toJson() {
    final json = <String, dynamic>{};
    if (this.endDate.isPresent) {
      final value = this.endDate.value;
      json[r'endDate'] = value == null ? null : _dateFormatter.format(value);
    }
    if (this.startDate.isPresent) {
      final value = this.startDate.value;
      json[r'startDate'] = value == null ? null : _dateFormatter.format(value);
    }
    if (this.status.isPresent) {
      final value = this.status.value;
      json[r'status'] = value;
    }
    return json;
  }

  /// Returns a new [FamilyUnionUpdateDto] instance and imports its values from
  /// [value] if it's a [Map], null otherwise.
  // ignore: prefer_constructors_over_static_methods
  static FamilyUnionUpdateDto? fromJson(dynamic value) {
    upgradeDto(value, "FamilyUnionUpdateDto");
    if (value is Map) {
      final json = value.cast<String, dynamic>();

      return FamilyUnionUpdateDto(
        endDate: json.containsKey(r'endDate') ? Optional.present(mapDateTime(json, r'endDate', r'')) : const Optional.absent(),
        startDate: json.containsKey(r'startDate') ? Optional.present(mapDateTime(json, r'startDate', r'')) : const Optional.absent(),
        status: json.containsKey(r'status') ? Optional.present(FamilyUnionStatus.fromJson(json[r'status'])) : const Optional.absent(),
      );
    }
    return null;
  }

  static List<FamilyUnionUpdateDto> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <FamilyUnionUpdateDto>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = FamilyUnionUpdateDto.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }

  static Map<String, FamilyUnionUpdateDto> mapFromJson(dynamic json) {
    final map = <String, FamilyUnionUpdateDto>{};
    if (json is Map && json.isNotEmpty) {
      json = json.cast<String, dynamic>(); // ignore: parameter_assignments
      for (final entry in json.entries) {
        final value = FamilyUnionUpdateDto.fromJson(entry.value);
        if (value != null) {
          map[entry.key] = value;
        }
      }
    }
    return map;
  }

  // maps a json object with a list of FamilyUnionUpdateDto-objects as value to a dart map
  static Map<String, List<FamilyUnionUpdateDto>> mapListFromJson(dynamic json, {bool growable = false,}) {
    final map = <String, List<FamilyUnionUpdateDto>>{};
    if (json is Map && json.isNotEmpty) {
      // ignore: parameter_assignments
      json = json.cast<String, dynamic>();
      for (final entry in json.entries) {
        map[entry.key] = FamilyUnionUpdateDto.listFromJson(entry.value, growable: growable,);
      }
    }
    return map;
  }

  /// The list of required keys that must be present in a JSON.
  static const requiredKeys = <String>{
  };
}

