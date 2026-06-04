//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

class StorageMigrationFileTypesDto {
  /// Returns a new [StorageMigrationFileTypesDto] instance.
  StorageMigrationFileTypesDto({
    this.encodedVideos = const Optional.present(true),
    this.fullsize = const Optional.present(true),
    this.originals = const Optional.present(true),
    this.personThumbnails = const Optional.present(true),
    this.previews = const Optional.present(true),
    this.profileImages = const Optional.present(true),
    this.sidecars = const Optional.present(true),
    this.thumbnails = const Optional.present(true),
  });

  /// Include encoded video files
  Optional<bool?> encodedVideos;

  /// Include full-size files
  Optional<bool?> fullsize;

  /// Include original files
  Optional<bool?> originals;

  /// Include person thumbnail files
  Optional<bool?> personThumbnails;

  /// Include preview files
  Optional<bool?> previews;

  /// Include profile image files
  Optional<bool?> profileImages;

  /// Include sidecar files
  Optional<bool?> sidecars;

  /// Include thumbnail files
  Optional<bool?> thumbnails;

  @override
  bool operator ==(Object other) => identical(this, other) || other is StorageMigrationFileTypesDto &&
    other.encodedVideos == encodedVideos &&
    other.fullsize == fullsize &&
    other.originals == originals &&
    other.personThumbnails == personThumbnails &&
    other.previews == previews &&
    other.profileImages == profileImages &&
    other.sidecars == sidecars &&
    other.thumbnails == thumbnails;

  @override
  int get hashCode =>
    // ignore: unnecessary_parenthesis
    (encodedVideos.hashCode) +
    (fullsize.hashCode) +
    (originals.hashCode) +
    (personThumbnails.hashCode) +
    (previews.hashCode) +
    (profileImages.hashCode) +
    (sidecars.hashCode) +
    (thumbnails.hashCode);

  @override
  String toString() => 'StorageMigrationFileTypesDto[encodedVideos=$encodedVideos, fullsize=$fullsize, originals=$originals, personThumbnails=$personThumbnails, previews=$previews, profileImages=$profileImages, sidecars=$sidecars, thumbnails=$thumbnails]';

  Map<String, dynamic> toJson() {
    final json = <String, dynamic>{};
    if (this.encodedVideos.isPresent) {
      final value = this.encodedVideos.value;
      json[r'encodedVideos'] = value;
    }
    if (this.fullsize.isPresent) {
      final value = this.fullsize.value;
      json[r'fullsize'] = value;
    }
    if (this.originals.isPresent) {
      final value = this.originals.value;
      json[r'originals'] = value;
    }
    if (this.personThumbnails.isPresent) {
      final value = this.personThumbnails.value;
      json[r'personThumbnails'] = value;
    }
    if (this.previews.isPresent) {
      final value = this.previews.value;
      json[r'previews'] = value;
    }
    if (this.profileImages.isPresent) {
      final value = this.profileImages.value;
      json[r'profileImages'] = value;
    }
    if (this.sidecars.isPresent) {
      final value = this.sidecars.value;
      json[r'sidecars'] = value;
    }
    if (this.thumbnails.isPresent) {
      final value = this.thumbnails.value;
      json[r'thumbnails'] = value;
    }
    return json;
  }

  /// Returns a new [StorageMigrationFileTypesDto] instance and imports its values from
  /// [value] if it's a [Map], null otherwise.
  // ignore: prefer_constructors_over_static_methods
  static StorageMigrationFileTypesDto? fromJson(dynamic value) {
    upgradeDto(value, "StorageMigrationFileTypesDto");
    if (value is Map) {
      final json = value.cast<String, dynamic>();

      return StorageMigrationFileTypesDto(
        encodedVideos: json.containsKey(r'encodedVideos') ? Optional.present(mapValueOfType<bool>(json, r'encodedVideos')) : const Optional.absent(),
        fullsize: json.containsKey(r'fullsize') ? Optional.present(mapValueOfType<bool>(json, r'fullsize')) : const Optional.absent(),
        originals: json.containsKey(r'originals') ? Optional.present(mapValueOfType<bool>(json, r'originals')) : const Optional.absent(),
        personThumbnails: json.containsKey(r'personThumbnails') ? Optional.present(mapValueOfType<bool>(json, r'personThumbnails')) : const Optional.absent(),
        previews: json.containsKey(r'previews') ? Optional.present(mapValueOfType<bool>(json, r'previews')) : const Optional.absent(),
        profileImages: json.containsKey(r'profileImages') ? Optional.present(mapValueOfType<bool>(json, r'profileImages')) : const Optional.absent(),
        sidecars: json.containsKey(r'sidecars') ? Optional.present(mapValueOfType<bool>(json, r'sidecars')) : const Optional.absent(),
        thumbnails: json.containsKey(r'thumbnails') ? Optional.present(mapValueOfType<bool>(json, r'thumbnails')) : const Optional.absent(),
      );
    }
    return null;
  }

  static List<StorageMigrationFileTypesDto> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <StorageMigrationFileTypesDto>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = StorageMigrationFileTypesDto.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }

  static Map<String, StorageMigrationFileTypesDto> mapFromJson(dynamic json) {
    final map = <String, StorageMigrationFileTypesDto>{};
    if (json is Map && json.isNotEmpty) {
      json = json.cast<String, dynamic>(); // ignore: parameter_assignments
      for (final entry in json.entries) {
        final value = StorageMigrationFileTypesDto.fromJson(entry.value);
        if (value != null) {
          map[entry.key] = value;
        }
      }
    }
    return map;
  }

  // maps a json object with a list of StorageMigrationFileTypesDto-objects as value to a dart map
  static Map<String, List<StorageMigrationFileTypesDto>> mapListFromJson(dynamic json, {bool growable = false,}) {
    final map = <String, List<StorageMigrationFileTypesDto>>{};
    if (json is Map && json.isNotEmpty) {
      // ignore: parameter_assignments
      json = json.cast<String, dynamic>();
      for (final entry in json.entries) {
        map[entry.key] = StorageMigrationFileTypesDto.listFromJson(entry.value, growable: growable,);
      }
    }
    return map;
  }

  /// The list of required keys that must be present in a JSON.
  static const requiredKeys = <String>{
  };
}

