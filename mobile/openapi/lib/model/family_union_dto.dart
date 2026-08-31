//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

class FamilyUnionDto {
  /// Returns a new [FamilyUnionDto] instance.
  FamilyUnionDto({
    this.children = const [],
    required this.id,
    this.partners = const [],
    required this.status,
  });

  /// Children in this union
  List<FamilyParticipantDto> children;

  /// Union ID
  String id;

  /// Partners in this union (0, 1 or 2)
  List<FamilyParticipantDto> partners;

  FamilyUnionStatus status;

  @override
  bool operator ==(Object other) => identical(this, other) || other is FamilyUnionDto &&
    _deepEquality.equals(other.children, children) &&
    other.id == id &&
    _deepEquality.equals(other.partners, partners) &&
    other.status == status;

  @override
  int get hashCode =>
    // ignore: unnecessary_parenthesis
    (children.hashCode) +
    (id.hashCode) +
    (partners.hashCode) +
    (status.hashCode);

  @override
  String toString() => 'FamilyUnionDto[children=$children, id=$id, partners=$partners, status=$status]';

  Map<String, dynamic> toJson() {
    final json = <String, dynamic>{};
      json[r'children'] = this.children;
      json[r'id'] = this.id;
      json[r'partners'] = this.partners;
      json[r'status'] = this.status;
    return json;
  }

  /// Returns a new [FamilyUnionDto] instance and imports its values from
  /// [value] if it's a [Map], null otherwise.
  // ignore: prefer_constructors_over_static_methods
  static FamilyUnionDto? fromJson(dynamic value) {
    upgradeDto(value, "FamilyUnionDto");
    if (value is Map) {
      final json = value.cast<String, dynamic>();

      return FamilyUnionDto(
        children: FamilyParticipantDto.listFromJson(json[r'children']),
        id: mapValueOfType<String>(json, r'id')!,
        partners: FamilyParticipantDto.listFromJson(json[r'partners']),
        status: FamilyUnionStatus.fromJson(json[r'status'])!,
      );
    }
    return null;
  }

  static List<FamilyUnionDto> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <FamilyUnionDto>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = FamilyUnionDto.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }

  static Map<String, FamilyUnionDto> mapFromJson(dynamic json) {
    final map = <String, FamilyUnionDto>{};
    if (json is Map && json.isNotEmpty) {
      json = json.cast<String, dynamic>(); // ignore: parameter_assignments
      for (final entry in json.entries) {
        final value = FamilyUnionDto.fromJson(entry.value);
        if (value != null) {
          map[entry.key] = value;
        }
      }
    }
    return map;
  }

  // maps a json object with a list of FamilyUnionDto-objects as value to a dart map
  static Map<String, List<FamilyUnionDto>> mapListFromJson(dynamic json, {bool growable = false,}) {
    final map = <String, List<FamilyUnionDto>>{};
    if (json is Map && json.isNotEmpty) {
      // ignore: parameter_assignments
      json = json.cast<String, dynamic>();
      for (final entry in json.entries) {
        map[entry.key] = FamilyUnionDto.listFromJson(entry.value, growable: growable,);
      }
    }
    return map;
  }

  /// The list of required keys that must be present in a JSON.
  static const requiredKeys = <String>{
    'children',
    'id',
    'partners',
    'status',
  };
}

