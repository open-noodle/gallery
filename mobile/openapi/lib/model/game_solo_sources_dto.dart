//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

class GameSoloSourcesDto {
  /// Returns a new [GameSoloSourcesDto] instance.
  GameSoloSourcesDto({
    this.includePartners = const Optional.absent(),
    this.includeSpaces = const Optional.absent(),
  });

  /// Also draw from partners' photos
  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  Optional<bool?> includePartners;

  /// Also draw from shared-space photos
  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  Optional<bool?> includeSpaces;

  @override
  bool operator ==(Object other) => identical(this, other) || other is GameSoloSourcesDto &&
    other.includePartners == includePartners &&
    other.includeSpaces == includeSpaces;

  @override
  int get hashCode =>
    // ignore: unnecessary_parenthesis
    (includePartners == null ? 0 : includePartners!.hashCode) +
    (includeSpaces == null ? 0 : includeSpaces!.hashCode);

  @override
  String toString() => 'GameSoloSourcesDto[includePartners=$includePartners, includeSpaces=$includeSpaces]';

  Map<String, dynamic> toJson() {
    final json = <String, dynamic>{};
    if (this.includePartners.isPresent) {
      final value = this.includePartners.value;
      json[r'includePartners'] = value;
    }
    if (this.includeSpaces.isPresent) {
      final value = this.includeSpaces.value;
      json[r'includeSpaces'] = value;
    }
    return json;
  }

  /// Returns a new [GameSoloSourcesDto] instance and imports its values from
  /// [value] if it's a [Map], null otherwise.
  // ignore: prefer_constructors_over_static_methods
  static GameSoloSourcesDto? fromJson(dynamic value) {
    upgradeDto(value, "GameSoloSourcesDto");
    if (value is Map) {
      final json = value.cast<String, dynamic>();

      return GameSoloSourcesDto(
        includePartners: json.containsKey(r'includePartners') ? Optional.present(mapValueOfType<bool>(json, r'includePartners')) : const Optional.absent(),
        includeSpaces: json.containsKey(r'includeSpaces') ? Optional.present(mapValueOfType<bool>(json, r'includeSpaces')) : const Optional.absent(),
      );
    }
    return null;
  }

  static List<GameSoloSourcesDto> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <GameSoloSourcesDto>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = GameSoloSourcesDto.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }

  static Map<String, GameSoloSourcesDto> mapFromJson(dynamic json) {
    final map = <String, GameSoloSourcesDto>{};
    if (json is Map && json.isNotEmpty) {
      json = json.cast<String, dynamic>(); // ignore: parameter_assignments
      for (final entry in json.entries) {
        final value = GameSoloSourcesDto.fromJson(entry.value);
        if (value != null) {
          map[entry.key] = value;
        }
      }
    }
    return map;
  }

  // maps a json object with a list of GameSoloSourcesDto-objects as value to a dart map
  static Map<String, List<GameSoloSourcesDto>> mapListFromJson(dynamic json, {bool growable = false,}) {
    final map = <String, List<GameSoloSourcesDto>>{};
    if (json is Map && json.isNotEmpty) {
      // ignore: parameter_assignments
      json = json.cast<String, dynamic>();
      for (final entry in json.entries) {
        map[entry.key] = GameSoloSourcesDto.listFromJson(entry.value, growable: growable,);
      }
    }
    return map;
  }

  /// The list of required keys that must be present in a JSON.
  static const requiredKeys = <String>{
  };
}

