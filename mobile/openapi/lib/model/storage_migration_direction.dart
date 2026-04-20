//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;


class StorageMigrationDirection {
  /// Instantiate a new enum with the provided [value].
  const StorageMigrationDirection._(this.value);

  /// The underlying value of this enum member.
  final String value;

  @override
  String toString() => value;

  String toJson() => value;

  static const toS3 = StorageMigrationDirection._(r'toS3');
  static const toDisk = StorageMigrationDirection._(r'toDisk');

  /// List of all possible values in this [enum][StorageMigrationDirection].
  static const values = <StorageMigrationDirection>[
    toS3,
    toDisk,
  ];

  static StorageMigrationDirection? fromJson(dynamic value) => StorageMigrationDirectionTypeTransformer().decode(value);

  static List<StorageMigrationDirection> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <StorageMigrationDirection>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = StorageMigrationDirection.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }
}

/// Transformation class that can [encode] an instance of [StorageMigrationDirection] to String,
/// and [decode] dynamic data back to [StorageMigrationDirection].
class StorageMigrationDirectionTypeTransformer {
  factory StorageMigrationDirectionTypeTransformer() => _instance ??= const StorageMigrationDirectionTypeTransformer._();

  const StorageMigrationDirectionTypeTransformer._();

  String encode(StorageMigrationDirection data) => data.value;

  /// Decodes a [dynamic value][data] to a StorageMigrationDirection.
  ///
  /// If [allowNull] is true and the [dynamic value][data] cannot be decoded successfully,
  /// then null is returned. However, if [allowNull] is false and the [dynamic value][data]
  /// cannot be decoded successfully, then an [UnimplementedError] is thrown.
  ///
  /// The [allowNull] is very handy when an API changes and a new enum value is added or removed,
  /// and users are still using an old app with the old code.
  StorageMigrationDirection? decode(dynamic data, {bool allowNull = true}) {
    if (data != null) {
      switch (data) {
        case r'toS3': return StorageMigrationDirection.toS3;
        case r'toDisk': return StorageMigrationDirection.toDisk;
        default:
          if (!allowNull) {
            throw ArgumentError('Unknown enum value to decode: $data');
          }
      }
    }
    return null;
  }

  /// Singleton [StorageMigrationDirectionTypeTransformer] instance.
  static StorageMigrationDirectionTypeTransformer? _instance;
}

