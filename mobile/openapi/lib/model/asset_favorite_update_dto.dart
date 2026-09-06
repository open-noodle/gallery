//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

class AssetFavoriteUpdateDto {
  /// Returns a new [AssetFavoriteUpdateDto] instance.
  AssetFavoriteUpdateDto({
    this.ids = const [],
    required this.isFavorite,
  });

  /// Asset IDs
  List<String> ids;

  /// Favorite state for the requesting user
  bool isFavorite;

  @override
  bool operator ==(Object other) => identical(this, other) || other is AssetFavoriteUpdateDto &&
    _deepEquality.equals(other.ids, ids) &&
    other.isFavorite == isFavorite;

  @override
  int get hashCode =>
    // ignore: unnecessary_parenthesis
    (ids.hashCode) +
    (isFavorite.hashCode);

  @override
  String toString() => 'AssetFavoriteUpdateDto[ids=$ids, isFavorite=$isFavorite]';

  Map<String, dynamic> toJson() {
    final json = <String, dynamic>{};
      json[r'ids'] = this.ids;
      json[r'isFavorite'] = this.isFavorite;
    return json;
  }

  /// Returns a new [AssetFavoriteUpdateDto] instance and imports its values from
  /// [value] if it's a [Map], null otherwise.
  // ignore: prefer_constructors_over_static_methods
  static AssetFavoriteUpdateDto? fromJson(dynamic value) {
    upgradeDto(value, "AssetFavoriteUpdateDto");
    if (value is Map) {
      final json = value.cast<String, dynamic>();

      return AssetFavoriteUpdateDto(
        ids: json[r'ids'] is Iterable
            ? (json[r'ids'] as Iterable).cast<String>().toList(growable: false)
            : const [],
        isFavorite: mapValueOfType<bool>(json, r'isFavorite')!,
      );
    }
    return null;
  }

  static List<AssetFavoriteUpdateDto> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <AssetFavoriteUpdateDto>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = AssetFavoriteUpdateDto.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }

  static Map<String, AssetFavoriteUpdateDto> mapFromJson(dynamic json) {
    final map = <String, AssetFavoriteUpdateDto>{};
    if (json is Map && json.isNotEmpty) {
      json = json.cast<String, dynamic>(); // ignore: parameter_assignments
      for (final entry in json.entries) {
        final value = AssetFavoriteUpdateDto.fromJson(entry.value);
        if (value != null) {
          map[entry.key] = value;
        }
      }
    }
    return map;
  }

  // maps a json object with a list of AssetFavoriteUpdateDto-objects as value to a dart map
  static Map<String, List<AssetFavoriteUpdateDto>> mapListFromJson(dynamic json, {bool growable = false,}) {
    final map = <String, List<AssetFavoriteUpdateDto>>{};
    if (json is Map && json.isNotEmpty) {
      // ignore: parameter_assignments
      json = json.cast<String, dynamic>();
      for (final entry in json.entries) {
        map[entry.key] = AssetFavoriteUpdateDto.listFromJson(entry.value, growable: growable,);
      }
    }
    return map;
  }

  /// The list of required keys that must be present in a JSON.
  static const requiredKeys = <String>{
    'ids',
    'isFavorite',
  };
}

