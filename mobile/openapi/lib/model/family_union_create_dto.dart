//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

class FamilyUnionCreateDto {
  /// Returns a new [FamilyUnionCreateDto] instance.
  FamilyUnionCreateDto({
    this.childIds = const Optional.present(const []),
    this.childPersonIds = const Optional.present(const []),
    this.endDate = const Optional.absent(),
    this.partnerIds = const Optional.present(const []),
    this.partnerPersonIds = const Optional.present(const []),
    this.startDate = const Optional.absent(),
    this.status = const Optional.absent(),
  });

  /// Child identity IDs
  Optional<List<String>?> childIds;

  /// Child person IDs, resolved to identities
  Optional<List<String>?> childPersonIds;

  /// Union end date
  Optional<DateTime?> endDate;

  /// Partner identity IDs (at most two)
  Optional<List<String>?> partnerIds;

  /// Partner person IDs, resolved to identities
  Optional<List<String>?> partnerPersonIds;

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
  bool operator ==(Object other) => identical(this, other) || other is FamilyUnionCreateDto &&
    _deepEquality.equals(other.childIds, childIds) &&
    _deepEquality.equals(other.childPersonIds, childPersonIds) &&
    other.endDate == endDate &&
    _deepEquality.equals(other.partnerIds, partnerIds) &&
    _deepEquality.equals(other.partnerPersonIds, partnerPersonIds) &&
    other.startDate == startDate &&
    other.status == status;

  @override
  int get hashCode =>
    // ignore: unnecessary_parenthesis
    (childIds.hashCode) +
    (childPersonIds.hashCode) +
    (endDate == null ? 0 : endDate!.hashCode) +
    (partnerIds.hashCode) +
    (partnerPersonIds.hashCode) +
    (startDate == null ? 0 : startDate!.hashCode) +
    (status == null ? 0 : status!.hashCode);

  @override
  String toString() => 'FamilyUnionCreateDto[childIds=$childIds, childPersonIds=$childPersonIds, endDate=$endDate, partnerIds=$partnerIds, partnerPersonIds=$partnerPersonIds, startDate=$startDate, status=$status]';

  Map<String, dynamic> toJson() {
    final json = <String, dynamic>{};
    if (this.childIds.isPresent) {
      final value = this.childIds.value;
      json[r'childIds'] = value;
    }
    if (this.childPersonIds.isPresent) {
      final value = this.childPersonIds.value;
      json[r'childPersonIds'] = value;
    }
    if (this.endDate.isPresent) {
      final value = this.endDate.value;
      json[r'endDate'] = value == null ? null : _dateFormatter.format(value);
    }
    if (this.partnerIds.isPresent) {
      final value = this.partnerIds.value;
      json[r'partnerIds'] = value;
    }
    if (this.partnerPersonIds.isPresent) {
      final value = this.partnerPersonIds.value;
      json[r'partnerPersonIds'] = value;
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

  /// Returns a new [FamilyUnionCreateDto] instance and imports its values from
  /// [value] if it's a [Map], null otherwise.
  // ignore: prefer_constructors_over_static_methods
  static FamilyUnionCreateDto? fromJson(dynamic value) {
    upgradeDto(value, "FamilyUnionCreateDto");
    if (value is Map) {
      final json = value.cast<String, dynamic>();

      return FamilyUnionCreateDto(
        childIds: json.containsKey(r'childIds') ? Optional.present(json[r'childIds'] is Iterable
            ? (json[r'childIds'] as Iterable).cast<String>().toList(growable: false)
            : const []) : const Optional.absent(),
        childPersonIds: json.containsKey(r'childPersonIds') ? Optional.present(json[r'childPersonIds'] is Iterable
            ? (json[r'childPersonIds'] as Iterable).cast<String>().toList(growable: false)
            : const []) : const Optional.absent(),
        endDate: json.containsKey(r'endDate') ? Optional.present(mapDateTime(json, r'endDate', r'')) : const Optional.absent(),
        partnerIds: json.containsKey(r'partnerIds') ? Optional.present(json[r'partnerIds'] is Iterable
            ? (json[r'partnerIds'] as Iterable).cast<String>().toList(growable: false)
            : const []) : const Optional.absent(),
        partnerPersonIds: json.containsKey(r'partnerPersonIds') ? Optional.present(json[r'partnerPersonIds'] is Iterable
            ? (json[r'partnerPersonIds'] as Iterable).cast<String>().toList(growable: false)
            : const []) : const Optional.absent(),
        startDate: json.containsKey(r'startDate') ? Optional.present(mapDateTime(json, r'startDate', r'')) : const Optional.absent(),
        status: json.containsKey(r'status') ? Optional.present(FamilyUnionStatus.fromJson(json[r'status'])) : const Optional.absent(),
      );
    }
    return null;
  }

  static List<FamilyUnionCreateDto> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <FamilyUnionCreateDto>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = FamilyUnionCreateDto.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }

  static Map<String, FamilyUnionCreateDto> mapFromJson(dynamic json) {
    final map = <String, FamilyUnionCreateDto>{};
    if (json is Map && json.isNotEmpty) {
      json = json.cast<String, dynamic>(); // ignore: parameter_assignments
      for (final entry in json.entries) {
        final value = FamilyUnionCreateDto.fromJson(entry.value);
        if (value != null) {
          map[entry.key] = value;
        }
      }
    }
    return map;
  }

  // maps a json object with a list of FamilyUnionCreateDto-objects as value to a dart map
  static Map<String, List<FamilyUnionCreateDto>> mapListFromJson(dynamic json, {bool growable = false,}) {
    final map = <String, List<FamilyUnionCreateDto>>{};
    if (json is Map && json.isNotEmpty) {
      // ignore: parameter_assignments
      json = json.cast<String, dynamic>();
      for (final entry in json.entries) {
        map[entry.key] = FamilyUnionCreateDto.listFromJson(entry.value, growable: growable,);
      }
    }
    return map;
  }

  /// The list of required keys that must be present in a JSON.
  static const requiredKeys = <String>{
  };
}

