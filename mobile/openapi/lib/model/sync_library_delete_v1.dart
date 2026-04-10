//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

class SyncLibraryDeleteV1 {
  /// Returns a new [SyncLibraryDeleteV1] instance.
  SyncLibraryDeleteV1({
    required this.libraryId,
  });

  /// Library ID
  String libraryId;

  @override
  bool operator ==(Object other) => identical(this, other) || other is SyncLibraryDeleteV1 &&
    other.libraryId == libraryId;

  @override
  int get hashCode =>
    // ignore: unnecessary_parenthesis
    (libraryId.hashCode);

  @override
  String toString() => 'SyncLibraryDeleteV1[libraryId=$libraryId]';

  Map<String, dynamic> toJson() {
    final json = <String, dynamic>{};
      json[r'libraryId'] = this.libraryId;
    return json;
  }

  /// Returns a new [SyncLibraryDeleteV1] instance and imports its values from
  /// [value] if it's a [Map], null otherwise.
  // ignore: prefer_constructors_over_static_methods
  static SyncLibraryDeleteV1? fromJson(dynamic value) {
    upgradeDto(value, "SyncLibraryDeleteV1");
    if (value is Map) {
      final json = value.cast<String, dynamic>();

      return SyncLibraryDeleteV1(
        libraryId: mapValueOfType<String>(json, r'libraryId')!,
      );
    }
    return null;
  }

  static List<SyncLibraryDeleteV1> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <SyncLibraryDeleteV1>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = SyncLibraryDeleteV1.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }

  static Map<String, SyncLibraryDeleteV1> mapFromJson(dynamic json) {
    final map = <String, SyncLibraryDeleteV1>{};
    if (json is Map && json.isNotEmpty) {
      json = json.cast<String, dynamic>(); // ignore: parameter_assignments
      for (final entry in json.entries) {
        final value = SyncLibraryDeleteV1.fromJson(entry.value);
        if (value != null) {
          map[entry.key] = value;
        }
      }
    }
    return map;
  }

  // maps a json object with a list of SyncLibraryDeleteV1-objects as value to a dart map
  static Map<String, List<SyncLibraryDeleteV1>> mapListFromJson(dynamic json, {bool growable = false,}) {
    final map = <String, List<SyncLibraryDeleteV1>>{};
    if (json is Map && json.isNotEmpty) {
      // ignore: parameter_assignments
      json = json.cast<String, dynamic>();
      for (final entry in json.entries) {
        map[entry.key] = SyncLibraryDeleteV1.listFromJson(entry.value, growable: growable,);
      }
    }
    return map;
  }

  /// The list of required keys that must be present in a JSON.
  static const requiredKeys = <String>{
    'libraryId',
  };
}

