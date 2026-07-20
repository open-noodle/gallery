//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

class LibraryManifestResponseDto {
  /// Returns a new [LibraryManifestResponseDto] instance.
  LibraryManifestResponseDto({
    this.albums = const [],
    this.assets = const [],
    required this.generatedAt,
    required this.manifestSchemaVersion,
    required this.nextCursor,
    required this.owner,
  });

  /// All albums owned by the target user
  List<LibraryManifestAlbumDto> albums;

  List<LibraryManifestAssetDto> assets;

  /// When this page was generated
  DateTime generatedAt;

  /// Manifest schema version; consumers must guard
  ///
  /// Minimum value: -9007199254740991
  /// Maximum value: 9007199254740991
  int manifestSchemaVersion;

  /// Pass as ?cursor for the next page; null when exhausted
  String? nextCursor;

  LibraryManifestOwnerDto owner;

  @override
  bool operator ==(Object other) => identical(this, other) || other is LibraryManifestResponseDto &&
    _deepEquality.equals(other.albums, albums) &&
    _deepEquality.equals(other.assets, assets) &&
    other.generatedAt == generatedAt &&
    other.manifestSchemaVersion == manifestSchemaVersion &&
    other.nextCursor == nextCursor &&
    other.owner == owner;

  @override
  int get hashCode =>
    // ignore: unnecessary_parenthesis
    (albums.hashCode) +
    (assets.hashCode) +
    (generatedAt.hashCode) +
    (manifestSchemaVersion.hashCode) +
    (nextCursor == null ? 0 : nextCursor!.hashCode) +
    (owner.hashCode);

  @override
  String toString() => 'LibraryManifestResponseDto[albums=$albums, assets=$assets, generatedAt=$generatedAt, manifestSchemaVersion=$manifestSchemaVersion, nextCursor=$nextCursor, owner=$owner]';

  Map<String, dynamic> toJson() {
    final json = <String, dynamic>{};
      json[r'albums'] = this.albums;
      json[r'assets'] = this.assets;
      json[r'generatedAt'] = this.generatedAt.toUtc().toIso8601String();
      json[r'manifestSchemaVersion'] = this.manifestSchemaVersion;
    if (this.nextCursor != null) {
      json[r'nextCursor'] = this.nextCursor;
    } else {
      json[r'nextCursor'] = null;
    }
      json[r'owner'] = this.owner;
    return json;
  }

  /// Returns a new [LibraryManifestResponseDto] instance and imports its values from
  /// [value] if it's a [Map], null otherwise.
  // ignore: prefer_constructors_over_static_methods
  static LibraryManifestResponseDto? fromJson(dynamic value) {
    upgradeDto(value, "LibraryManifestResponseDto");
    if (value is Map) {
      final json = value.cast<String, dynamic>();

      return LibraryManifestResponseDto(
        albums: LibraryManifestAlbumDto.listFromJson(json[r'albums']),
        assets: LibraryManifestAssetDto.listFromJson(json[r'assets']),
        generatedAt: mapDateTime(json, r'generatedAt', r'')!,
        manifestSchemaVersion: mapValueOfType<int>(json, r'manifestSchemaVersion')!,
        nextCursor: mapValueOfType<String>(json, r'nextCursor'),
        owner: LibraryManifestOwnerDto.fromJson(json[r'owner'])!,
      );
    }
    return null;
  }

  static List<LibraryManifestResponseDto> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <LibraryManifestResponseDto>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = LibraryManifestResponseDto.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }

  static Map<String, LibraryManifestResponseDto> mapFromJson(dynamic json) {
    final map = <String, LibraryManifestResponseDto>{};
    if (json is Map && json.isNotEmpty) {
      json = json.cast<String, dynamic>(); // ignore: parameter_assignments
      for (final entry in json.entries) {
        final value = LibraryManifestResponseDto.fromJson(entry.value);
        if (value != null) {
          map[entry.key] = value;
        }
      }
    }
    return map;
  }

  // maps a json object with a list of LibraryManifestResponseDto-objects as value to a dart map
  static Map<String, List<LibraryManifestResponseDto>> mapListFromJson(dynamic json, {bool growable = false,}) {
    final map = <String, List<LibraryManifestResponseDto>>{};
    if (json is Map && json.isNotEmpty) {
      // ignore: parameter_assignments
      json = json.cast<String, dynamic>();
      for (final entry in json.entries) {
        map[entry.key] = LibraryManifestResponseDto.listFromJson(entry.value, growable: growable,);
      }
    }
    return map;
  }

  /// The list of required keys that must be present in a JSON.
  static const requiredKeys = <String>{
    'albums',
    'assets',
    'generatedAt',
    'manifestSchemaVersion',
    'nextCursor',
    'owner',
  };
}

