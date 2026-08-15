//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

class StorageRoutingStatusEntryDto {
  /// Returns a new [StorageRoutingStatusEntryDto] instance.
  StorageRoutingStatusEntryDto({
    required this.misplacedCount,
    required this.routedTo,
  });

  /// Number of files of this kind currently stored on the other backend
  ///
  /// Minimum value: -9007199254740991
  /// Maximum value: 9007199254740991
  int misplacedCount;

  /// The resolved backend new files of this kind are written to
  StorageRoutingStatusEntryDtoRoutedToEnum routedTo;

  @override
  bool operator ==(Object other) => identical(this, other) || other is StorageRoutingStatusEntryDto &&
    other.misplacedCount == misplacedCount &&
    other.routedTo == routedTo;

  @override
  int get hashCode =>
    // ignore: unnecessary_parenthesis
    (misplacedCount.hashCode) +
    (routedTo.hashCode);

  @override
  String toString() => 'StorageRoutingStatusEntryDto[misplacedCount=$misplacedCount, routedTo=$routedTo]';

  Map<String, dynamic> toJson() {
    final json = <String, dynamic>{};
      json[r'misplacedCount'] = this.misplacedCount;
      json[r'routedTo'] = this.routedTo;
    return json;
  }

  /// Returns a new [StorageRoutingStatusEntryDto] instance and imports its values from
  /// [value] if it's a [Map], null otherwise.
  // ignore: prefer_constructors_over_static_methods
  static StorageRoutingStatusEntryDto? fromJson(dynamic value) {
    upgradeDto(value, "StorageRoutingStatusEntryDto");
    if (value is Map) {
      final json = value.cast<String, dynamic>();

      return StorageRoutingStatusEntryDto(
        misplacedCount: mapValueOfType<int>(json, r'misplacedCount')!,
        routedTo: StorageRoutingStatusEntryDtoRoutedToEnum.fromJson(json[r'routedTo'])!,
      );
    }
    return null;
  }

  static List<StorageRoutingStatusEntryDto> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <StorageRoutingStatusEntryDto>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = StorageRoutingStatusEntryDto.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }

  static Map<String, StorageRoutingStatusEntryDto> mapFromJson(dynamic json) {
    final map = <String, StorageRoutingStatusEntryDto>{};
    if (json is Map && json.isNotEmpty) {
      json = json.cast<String, dynamic>(); // ignore: parameter_assignments
      for (final entry in json.entries) {
        final value = StorageRoutingStatusEntryDto.fromJson(entry.value);
        if (value != null) {
          map[entry.key] = value;
        }
      }
    }
    return map;
  }

  // maps a json object with a list of StorageRoutingStatusEntryDto-objects as value to a dart map
  static Map<String, List<StorageRoutingStatusEntryDto>> mapListFromJson(dynamic json, {bool growable = false,}) {
    final map = <String, List<StorageRoutingStatusEntryDto>>{};
    if (json is Map && json.isNotEmpty) {
      // ignore: parameter_assignments
      json = json.cast<String, dynamic>();
      for (final entry in json.entries) {
        map[entry.key] = StorageRoutingStatusEntryDto.listFromJson(entry.value, growable: growable,);
      }
    }
    return map;
  }

  /// The list of required keys that must be present in a JSON.
  static const requiredKeys = <String>{
    'misplacedCount',
    'routedTo',
  };
}

/// The resolved backend new files of this kind are written to
enum StorageRoutingStatusEntryDtoRoutedToEnum {
  disk._(r'disk'),
  s3._(r's3'),
  ;

  /// Instantiate a new enum with the provided value.
  const StorageRoutingStatusEntryDtoRoutedToEnum._(this._value);

  /// The underlying value of this enum member.
  final String _value;

  @override
  String toString() => _value;

  /// Encodes this enum as a value suitable for JSON.
  String toJson() => _value;

  /// Returns the instance of [StorageRoutingStatusEntryDtoRoutedToEnum] that was successfully decoded
  /// from the passed [value] on success, null otherwise.
  static StorageRoutingStatusEntryDtoRoutedToEnum? fromJson(dynamic value) => StorageRoutingStatusEntryDtoRoutedToEnumTypeTransformer().decode(value);

  /// Returns a [List] containing instances of [StorageRoutingStatusEntryDtoRoutedToEnum]
  /// that were successfully decoded from the passed [JSON][json].
  static List<StorageRoutingStatusEntryDtoRoutedToEnum> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <StorageRoutingStatusEntryDtoRoutedToEnum>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = StorageRoutingStatusEntryDtoRoutedToEnum.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }
}

/// Transformation class that can [encode] an instance of [StorageRoutingStatusEntryDtoRoutedToEnum] to String,
/// and [decode] dynamic data back to [StorageRoutingStatusEntryDtoRoutedToEnum].
class StorageRoutingStatusEntryDtoRoutedToEnumTypeTransformer {
  factory StorageRoutingStatusEntryDtoRoutedToEnumTypeTransformer() => _instance ??= const StorageRoutingStatusEntryDtoRoutedToEnumTypeTransformer._();

  const StorageRoutingStatusEntryDtoRoutedToEnumTypeTransformer._();

  String encode(StorageRoutingStatusEntryDtoRoutedToEnum data) => data._value;

  /// Returns the instance of [StorageRoutingStatusEntryDtoRoutedToEnum] that was successfully decoded
  /// from the passed [data] value on success, null otherwise.
  ///
  /// If [allowNull] is true and the [dynamic value][data] cannot be decoded successfully,
  /// then null is returned. However, if [allowNull] is false and the [dynamic value][data]
  /// cannot be decoded successfully, then an [UnimplementedError] is thrown.
  ///
  /// The [allowNull] is very handy when an API changes and a new enum value is added or removed,
  /// and users are still using an old app with the old code.
  StorageRoutingStatusEntryDtoRoutedToEnum? decode(dynamic data, {bool allowNull = true}) {
    if (data is StorageRoutingStatusEntryDtoRoutedToEnum) {
      return data;
    }
    if (data != null) {
      switch (data) {
        case r'disk': return StorageRoutingStatusEntryDtoRoutedToEnum.disk;
        case r's3': return StorageRoutingStatusEntryDtoRoutedToEnum.s3;
        default:
          if (!allowNull) {
            throw ArgumentError('Unknown enum value to decode: $data');
          }
      }
    }
    return null;
  }

  /// The singleton instance of this transformer.
  static StorageRoutingStatusEntryDtoRoutedToEnumTypeTransformer? _instance;
}


