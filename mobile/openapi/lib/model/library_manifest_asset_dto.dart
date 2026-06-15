//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

class LibraryManifestAssetDto {
  /// Returns a new [LibraryManifestAssetDto] instance.
  LibraryManifestAssetDto({
    this.albumIds = const [],
    required this.assetId,
    required this.checksum,
    required this.checksumAlgorithm,
    required this.fileCreatedAt,
    required this.fileModifiedAt,
    required this.objectKey,
    required this.originalFileName,
    required this.size,
    required this.type,
  });

  /// IDs of the owner-owned albums this asset belongs to
  List<String> albumIds;

  /// Asset ID
  String assetId;

  /// Base64 encoded SHA1 hash
  String checksum;

  /// Checksum algorithm
  LibraryManifestAssetDtoChecksumAlgorithmEnum checksumAlgorithm;

  /// File creation time
  DateTime fileCreatedAt;

  /// File modification time
  DateTime fileModifiedAt;

  /// Object-storage key (asset.originalPath)
  String objectKey;

  /// Original file name
  String originalFileName;

  /// Original file size in bytes; null if unknown
  ///
  /// Minimum value: 0
  /// Maximum value: 9007199254740991
  int? size;

  AssetTypeEnum type;

  @override
  bool operator ==(Object other) => identical(this, other) || other is LibraryManifestAssetDto &&
    _deepEquality.equals(other.albumIds, albumIds) &&
    other.assetId == assetId &&
    other.checksum == checksum &&
    other.checksumAlgorithm == checksumAlgorithm &&
    other.fileCreatedAt == fileCreatedAt &&
    other.fileModifiedAt == fileModifiedAt &&
    other.objectKey == objectKey &&
    other.originalFileName == originalFileName &&
    other.size == size &&
    other.type == type;

  @override
  int get hashCode =>
    // ignore: unnecessary_parenthesis
    (albumIds.hashCode) +
    (assetId.hashCode) +
    (checksum.hashCode) +
    (checksumAlgorithm.hashCode) +
    (fileCreatedAt.hashCode) +
    (fileModifiedAt.hashCode) +
    (objectKey.hashCode) +
    (originalFileName.hashCode) +
    (size == null ? 0 : size!.hashCode) +
    (type.hashCode);

  @override
  String toString() => 'LibraryManifestAssetDto[albumIds=$albumIds, assetId=$assetId, checksum=$checksum, checksumAlgorithm=$checksumAlgorithm, fileCreatedAt=$fileCreatedAt, fileModifiedAt=$fileModifiedAt, objectKey=$objectKey, originalFileName=$originalFileName, size=$size, type=$type]';

  Map<String, dynamic> toJson() {
    final json = <String, dynamic>{};
      json[r'albumIds'] = this.albumIds;
      json[r'assetId'] = this.assetId;
      json[r'checksum'] = this.checksum;
      json[r'checksumAlgorithm'] = this.checksumAlgorithm;
      json[r'fileCreatedAt'] = this.fileCreatedAt.toUtc().toIso8601String();
      json[r'fileModifiedAt'] = this.fileModifiedAt.toUtc().toIso8601String();
      json[r'objectKey'] = this.objectKey;
      json[r'originalFileName'] = this.originalFileName;
    if (this.size != null) {
      json[r'size'] = this.size;
    } else {
    //  json[r'size'] = null;
    }
      json[r'type'] = this.type;
    return json;
  }

  /// Returns a new [LibraryManifestAssetDto] instance and imports its values from
  /// [value] if it's a [Map], null otherwise.
  // ignore: prefer_constructors_over_static_methods
  static LibraryManifestAssetDto? fromJson(dynamic value) {
    upgradeDto(value, "LibraryManifestAssetDto");
    if (value is Map) {
      final json = value.cast<String, dynamic>();

      return LibraryManifestAssetDto(
        albumIds: json[r'albumIds'] is Iterable
            ? (json[r'albumIds'] as Iterable).cast<String>().toList(growable: false)
            : const [],
        assetId: mapValueOfType<String>(json, r'assetId')!,
        checksum: mapValueOfType<String>(json, r'checksum')!,
        checksumAlgorithm: LibraryManifestAssetDtoChecksumAlgorithmEnum.fromJson(json[r'checksumAlgorithm'])!,
        fileCreatedAt: mapDateTime(json, r'fileCreatedAt', r'')!,
        fileModifiedAt: mapDateTime(json, r'fileModifiedAt', r'')!,
        objectKey: mapValueOfType<String>(json, r'objectKey')!,
        originalFileName: mapValueOfType<String>(json, r'originalFileName')!,
        size: mapValueOfType<int>(json, r'size'),
        type: AssetTypeEnum.fromJson(json[r'type'])!,
      );
    }
    return null;
  }

  static List<LibraryManifestAssetDto> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <LibraryManifestAssetDto>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = LibraryManifestAssetDto.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }

  static Map<String, LibraryManifestAssetDto> mapFromJson(dynamic json) {
    final map = <String, LibraryManifestAssetDto>{};
    if (json is Map && json.isNotEmpty) {
      json = json.cast<String, dynamic>(); // ignore: parameter_assignments
      for (final entry in json.entries) {
        final value = LibraryManifestAssetDto.fromJson(entry.value);
        if (value != null) {
          map[entry.key] = value;
        }
      }
    }
    return map;
  }

  // maps a json object with a list of LibraryManifestAssetDto-objects as value to a dart map
  static Map<String, List<LibraryManifestAssetDto>> mapListFromJson(dynamic json, {bool growable = false,}) {
    final map = <String, List<LibraryManifestAssetDto>>{};
    if (json is Map && json.isNotEmpty) {
      // ignore: parameter_assignments
      json = json.cast<String, dynamic>();
      for (final entry in json.entries) {
        map[entry.key] = LibraryManifestAssetDto.listFromJson(entry.value, growable: growable,);
      }
    }
    return map;
  }

  /// The list of required keys that must be present in a JSON.
  static const requiredKeys = <String>{
    'albumIds',
    'assetId',
    'checksum',
    'checksumAlgorithm',
    'fileCreatedAt',
    'fileModifiedAt',
    'objectKey',
    'originalFileName',
    'size',
    'type',
  };
}

/// Checksum algorithm
class LibraryManifestAssetDtoChecksumAlgorithmEnum {
  /// Instantiate a new enum with the provided [value].
  const LibraryManifestAssetDtoChecksumAlgorithmEnum._(this.value);

  /// The underlying value of this enum member.
  final String value;

  @override
  String toString() => value;

  String toJson() => value;

  static const sha1 = LibraryManifestAssetDtoChecksumAlgorithmEnum._(r'sha1');
  static const sha1Path = LibraryManifestAssetDtoChecksumAlgorithmEnum._(r'sha1-path');

  /// List of all possible values in this [enum][LibraryManifestAssetDtoChecksumAlgorithmEnum].
  static const values = <LibraryManifestAssetDtoChecksumAlgorithmEnum>[
    sha1,
    sha1Path,
  ];

  static LibraryManifestAssetDtoChecksumAlgorithmEnum? fromJson(dynamic value) => LibraryManifestAssetDtoChecksumAlgorithmEnumTypeTransformer().decode(value);

  static List<LibraryManifestAssetDtoChecksumAlgorithmEnum> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <LibraryManifestAssetDtoChecksumAlgorithmEnum>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = LibraryManifestAssetDtoChecksumAlgorithmEnum.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }
}

/// Transformation class that can [encode] an instance of [LibraryManifestAssetDtoChecksumAlgorithmEnum] to String,
/// and [decode] dynamic data back to [LibraryManifestAssetDtoChecksumAlgorithmEnum].
class LibraryManifestAssetDtoChecksumAlgorithmEnumTypeTransformer {
  factory LibraryManifestAssetDtoChecksumAlgorithmEnumTypeTransformer() => _instance ??= const LibraryManifestAssetDtoChecksumAlgorithmEnumTypeTransformer._();

  const LibraryManifestAssetDtoChecksumAlgorithmEnumTypeTransformer._();

  String encode(LibraryManifestAssetDtoChecksumAlgorithmEnum data) => data.value;

  /// Decodes a [dynamic value][data] to a LibraryManifestAssetDtoChecksumAlgorithmEnum.
  ///
  /// If [allowNull] is true and the [dynamic value][data] cannot be decoded successfully,
  /// then null is returned. However, if [allowNull] is false and the [dynamic value][data]
  /// cannot be decoded successfully, then an [UnimplementedError] is thrown.
  ///
  /// The [allowNull] is very handy when an API changes and a new enum value is added or removed,
  /// and users are still using an old app with the old code.
  LibraryManifestAssetDtoChecksumAlgorithmEnum? decode(dynamic data, {bool allowNull = true}) {
    if (data != null) {
      switch (data) {
        case r'sha1': return LibraryManifestAssetDtoChecksumAlgorithmEnum.sha1;
        case r'sha1-path': return LibraryManifestAssetDtoChecksumAlgorithmEnum.sha1Path;
        default:
          if (!allowNull) {
            throw ArgumentError('Unknown enum value to decode: $data');
          }
      }
    }
    return null;
  }

  /// Singleton [LibraryManifestAssetDtoChecksumAlgorithmEnumTypeTransformer] instance.
  static LibraryManifestAssetDtoChecksumAlgorithmEnumTypeTransformer? _instance;
}


