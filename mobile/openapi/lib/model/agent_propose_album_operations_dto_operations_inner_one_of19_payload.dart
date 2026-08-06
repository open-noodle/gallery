//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

class AgentProposeAlbumOperationsDtoOperationsInnerOneOf19Payload {
  /// Returns a new [AgentProposeAlbumOperationsDtoOperationsInnerOneOf19Payload] instance.
  AgentProposeAlbumOperationsDtoOperationsInnerOneOf19Payload({
    this.brightness = const Optional.absent(),
    this.contrast = const Optional.absent(),
    this.saturation = const Optional.absent(),
    this.autoEnhance = const Optional.absent(),
  });

  Optional<AgentProposeAlbumOperationsDtoOperationsInnerOneOf19PayloadBrightnessEnum?> brightness;

  Optional<AgentProposeAlbumOperationsDtoOperationsInnerOneOf19PayloadContrastEnum?> contrast;

  Optional<AgentProposeAlbumOperationsDtoOperationsInnerOneOf19PayloadSaturationEnum?> saturation;

  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  Optional<bool?> autoEnhance;

  @override
  bool operator ==(Object other) => identical(this, other) || other is AgentProposeAlbumOperationsDtoOperationsInnerOneOf19Payload &&
    other.brightness == brightness &&
    other.contrast == contrast &&
    other.saturation == saturation &&
    other.autoEnhance == autoEnhance;

  @override
  int get hashCode =>
    // ignore: unnecessary_parenthesis
    (brightness == null ? 0 : brightness!.hashCode) +
    (contrast == null ? 0 : contrast!.hashCode) +
    (saturation == null ? 0 : saturation!.hashCode) +
    (autoEnhance == null ? 0 : autoEnhance!.hashCode);

  @override
  String toString() => 'AgentProposeAlbumOperationsDtoOperationsInnerOneOf19Payload[brightness=$brightness, contrast=$contrast, saturation=$saturation, autoEnhance=$autoEnhance]';

  Map<String, dynamic> toJson() {
    final json = <String, dynamic>{};
    if (this.brightness.isPresent) {
      final value = this.brightness.value;
      json[r'brightness'] = value;
    }
    if (this.contrast.isPresent) {
      final value = this.contrast.value;
      json[r'contrast'] = value;
    }
    if (this.saturation.isPresent) {
      final value = this.saturation.value;
      json[r'saturation'] = value;
    }
    if (this.autoEnhance.isPresent) {
      final value = this.autoEnhance.value;
      json[r'autoEnhance'] = value;
    }
    return json;
  }

  /// Returns a new [AgentProposeAlbumOperationsDtoOperationsInnerOneOf19Payload] instance and imports its values from
  /// [value] if it's a [Map], null otherwise.
  // ignore: prefer_constructors_over_static_methods
  static AgentProposeAlbumOperationsDtoOperationsInnerOneOf19Payload? fromJson(dynamic value) {
    upgradeDto(value, "AgentProposeAlbumOperationsDtoOperationsInnerOneOf19Payload");
    if (value is Map) {
      final json = value.cast<String, dynamic>();

      return AgentProposeAlbumOperationsDtoOperationsInnerOneOf19Payload(
        brightness: json.containsKey(r'brightness') ? Optional.present(AgentProposeAlbumOperationsDtoOperationsInnerOneOf19PayloadBrightnessEnum.fromJson(json[r'brightness'])) : const Optional.absent(),
        contrast: json.containsKey(r'contrast') ? Optional.present(AgentProposeAlbumOperationsDtoOperationsInnerOneOf19PayloadContrastEnum.fromJson(json[r'contrast'])) : const Optional.absent(),
        saturation: json.containsKey(r'saturation') ? Optional.present(AgentProposeAlbumOperationsDtoOperationsInnerOneOf19PayloadSaturationEnum.fromJson(json[r'saturation'])) : const Optional.absent(),
        autoEnhance: json.containsKey(r'autoEnhance') ? Optional.present(mapValueOfType<bool>(json, r'autoEnhance')) : const Optional.absent(),
      );
    }
    return null;
  }

  static List<AgentProposeAlbumOperationsDtoOperationsInnerOneOf19Payload> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <AgentProposeAlbumOperationsDtoOperationsInnerOneOf19Payload>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = AgentProposeAlbumOperationsDtoOperationsInnerOneOf19Payload.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }

  static Map<String, AgentProposeAlbumOperationsDtoOperationsInnerOneOf19Payload> mapFromJson(dynamic json) {
    final map = <String, AgentProposeAlbumOperationsDtoOperationsInnerOneOf19Payload>{};
    if (json is Map && json.isNotEmpty) {
      json = json.cast<String, dynamic>(); // ignore: parameter_assignments
      for (final entry in json.entries) {
        final value = AgentProposeAlbumOperationsDtoOperationsInnerOneOf19Payload.fromJson(entry.value);
        if (value != null) {
          map[entry.key] = value;
        }
      }
    }
    return map;
  }

  // maps a json object with a list of AgentProposeAlbumOperationsDtoOperationsInnerOneOf19Payload-objects as value to a dart map
  static Map<String, List<AgentProposeAlbumOperationsDtoOperationsInnerOneOf19Payload>> mapListFromJson(dynamic json, {bool growable = false,}) {
    final map = <String, List<AgentProposeAlbumOperationsDtoOperationsInnerOneOf19Payload>>{};
    if (json is Map && json.isNotEmpty) {
      // ignore: parameter_assignments
      json = json.cast<String, dynamic>();
      for (final entry in json.entries) {
        map[entry.key] = AgentProposeAlbumOperationsDtoOperationsInnerOneOf19Payload.listFromJson(entry.value, growable: growable,);
      }
    }
    return map;
  }

  /// The list of required keys that must be present in a JSON.
  static const requiredKeys = <String>{
  };
}


class AgentProposeAlbumOperationsDtoOperationsInnerOneOf19PayloadBrightnessEnum {
  /// Instantiate a new enum with the provided [value].
  const AgentProposeAlbumOperationsDtoOperationsInnerOneOf19PayloadBrightnessEnum._(this.value);

  /// The underlying value of this enum member.
  final String value;

  @override
  String toString() => value;

  String toJson() => value;

  static const strongDecrease = AgentProposeAlbumOperationsDtoOperationsInnerOneOf19PayloadBrightnessEnum._(r'strong_decrease');
  static const moderateDecrease = AgentProposeAlbumOperationsDtoOperationsInnerOneOf19PayloadBrightnessEnum._(r'moderate_decrease');
  static const slightDecrease = AgentProposeAlbumOperationsDtoOperationsInnerOneOf19PayloadBrightnessEnum._(r'slight_decrease');
  static const slightIncrease = AgentProposeAlbumOperationsDtoOperationsInnerOneOf19PayloadBrightnessEnum._(r'slight_increase');
  static const moderateIncrease = AgentProposeAlbumOperationsDtoOperationsInnerOneOf19PayloadBrightnessEnum._(r'moderate_increase');
  static const strongIncrease = AgentProposeAlbumOperationsDtoOperationsInnerOneOf19PayloadBrightnessEnum._(r'strong_increase');

  /// List of all possible values in this [enum][AgentProposeAlbumOperationsDtoOperationsInnerOneOf19PayloadBrightnessEnum].
  static const values = <AgentProposeAlbumOperationsDtoOperationsInnerOneOf19PayloadBrightnessEnum>[
    strongDecrease,
    moderateDecrease,
    slightDecrease,
    slightIncrease,
    moderateIncrease,
    strongIncrease,
  ];

  static AgentProposeAlbumOperationsDtoOperationsInnerOneOf19PayloadBrightnessEnum? fromJson(dynamic value) => AgentProposeAlbumOperationsDtoOperationsInnerOneOf19PayloadBrightnessEnumTypeTransformer().decode(value);

  static List<AgentProposeAlbumOperationsDtoOperationsInnerOneOf19PayloadBrightnessEnum> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <AgentProposeAlbumOperationsDtoOperationsInnerOneOf19PayloadBrightnessEnum>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = AgentProposeAlbumOperationsDtoOperationsInnerOneOf19PayloadBrightnessEnum.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }
}

/// Transformation class that can [encode] an instance of [AgentProposeAlbumOperationsDtoOperationsInnerOneOf19PayloadBrightnessEnum] to Optional<String?>,
/// and [decode] dynamic data back to [AgentProposeAlbumOperationsDtoOperationsInnerOneOf19PayloadBrightnessEnum].
class AgentProposeAlbumOperationsDtoOperationsInnerOneOf19PayloadBrightnessEnumTypeTransformer {
  factory AgentProposeAlbumOperationsDtoOperationsInnerOneOf19PayloadBrightnessEnumTypeTransformer() => _instance ??= const AgentProposeAlbumOperationsDtoOperationsInnerOneOf19PayloadBrightnessEnumTypeTransformer._();

  const AgentProposeAlbumOperationsDtoOperationsInnerOneOf19PayloadBrightnessEnumTypeTransformer._();

  String encode(AgentProposeAlbumOperationsDtoOperationsInnerOneOf19PayloadBrightnessEnum data) => data.value;

  /// Decodes a [dynamic value][data] to a AgentProposeAlbumOperationsDtoOperationsInnerOneOf19PayloadBrightnessEnum.
  ///
  /// If [allowNull] is true and the [dynamic value][data] cannot be decoded successfully,
  /// then null is returned. However, if [allowNull] is false and the [dynamic value][data]
  /// cannot be decoded successfully, then an [UnimplementedError] is thrown.
  ///
  /// The [allowNull] is very handy when an API changes and a new enum value is added or removed,
  /// and users are still using an old app with the old code.
  AgentProposeAlbumOperationsDtoOperationsInnerOneOf19PayloadBrightnessEnum? decode(dynamic data, {bool allowNull = true}) {
    if (data != null) {
      switch (data) {
        case r'strong_decrease': return AgentProposeAlbumOperationsDtoOperationsInnerOneOf19PayloadBrightnessEnum.strongDecrease;
        case r'moderate_decrease': return AgentProposeAlbumOperationsDtoOperationsInnerOneOf19PayloadBrightnessEnum.moderateDecrease;
        case r'slight_decrease': return AgentProposeAlbumOperationsDtoOperationsInnerOneOf19PayloadBrightnessEnum.slightDecrease;
        case r'slight_increase': return AgentProposeAlbumOperationsDtoOperationsInnerOneOf19PayloadBrightnessEnum.slightIncrease;
        case r'moderate_increase': return AgentProposeAlbumOperationsDtoOperationsInnerOneOf19PayloadBrightnessEnum.moderateIncrease;
        case r'strong_increase': return AgentProposeAlbumOperationsDtoOperationsInnerOneOf19PayloadBrightnessEnum.strongIncrease;
        default:
          if (!allowNull) {
            throw ArgumentError('Unknown enum value to decode: $data');
          }
      }
    }
    return null;
  }

  /// Singleton [AgentProposeAlbumOperationsDtoOperationsInnerOneOf19PayloadBrightnessEnumTypeTransformer] instance.
  static AgentProposeAlbumOperationsDtoOperationsInnerOneOf19PayloadBrightnessEnumTypeTransformer? _instance;
}



class AgentProposeAlbumOperationsDtoOperationsInnerOneOf19PayloadContrastEnum {
  /// Instantiate a new enum with the provided [value].
  const AgentProposeAlbumOperationsDtoOperationsInnerOneOf19PayloadContrastEnum._(this.value);

  /// The underlying value of this enum member.
  final String value;

  @override
  String toString() => value;

  String toJson() => value;

  static const strongDecrease = AgentProposeAlbumOperationsDtoOperationsInnerOneOf19PayloadContrastEnum._(r'strong_decrease');
  static const moderateDecrease = AgentProposeAlbumOperationsDtoOperationsInnerOneOf19PayloadContrastEnum._(r'moderate_decrease');
  static const slightDecrease = AgentProposeAlbumOperationsDtoOperationsInnerOneOf19PayloadContrastEnum._(r'slight_decrease');
  static const slightIncrease = AgentProposeAlbumOperationsDtoOperationsInnerOneOf19PayloadContrastEnum._(r'slight_increase');
  static const moderateIncrease = AgentProposeAlbumOperationsDtoOperationsInnerOneOf19PayloadContrastEnum._(r'moderate_increase');
  static const strongIncrease = AgentProposeAlbumOperationsDtoOperationsInnerOneOf19PayloadContrastEnum._(r'strong_increase');

  /// List of all possible values in this [enum][AgentProposeAlbumOperationsDtoOperationsInnerOneOf19PayloadContrastEnum].
  static const values = <AgentProposeAlbumOperationsDtoOperationsInnerOneOf19PayloadContrastEnum>[
    strongDecrease,
    moderateDecrease,
    slightDecrease,
    slightIncrease,
    moderateIncrease,
    strongIncrease,
  ];

  static AgentProposeAlbumOperationsDtoOperationsInnerOneOf19PayloadContrastEnum? fromJson(dynamic value) => AgentProposeAlbumOperationsDtoOperationsInnerOneOf19PayloadContrastEnumTypeTransformer().decode(value);

  static List<AgentProposeAlbumOperationsDtoOperationsInnerOneOf19PayloadContrastEnum> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <AgentProposeAlbumOperationsDtoOperationsInnerOneOf19PayloadContrastEnum>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = AgentProposeAlbumOperationsDtoOperationsInnerOneOf19PayloadContrastEnum.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }
}

/// Transformation class that can [encode] an instance of [AgentProposeAlbumOperationsDtoOperationsInnerOneOf19PayloadContrastEnum] to Optional<String?>,
/// and [decode] dynamic data back to [AgentProposeAlbumOperationsDtoOperationsInnerOneOf19PayloadContrastEnum].
class AgentProposeAlbumOperationsDtoOperationsInnerOneOf19PayloadContrastEnumTypeTransformer {
  factory AgentProposeAlbumOperationsDtoOperationsInnerOneOf19PayloadContrastEnumTypeTransformer() => _instance ??= const AgentProposeAlbumOperationsDtoOperationsInnerOneOf19PayloadContrastEnumTypeTransformer._();

  const AgentProposeAlbumOperationsDtoOperationsInnerOneOf19PayloadContrastEnumTypeTransformer._();

  String encode(AgentProposeAlbumOperationsDtoOperationsInnerOneOf19PayloadContrastEnum data) => data.value;

  /// Decodes a [dynamic value][data] to a AgentProposeAlbumOperationsDtoOperationsInnerOneOf19PayloadContrastEnum.
  ///
  /// If [allowNull] is true and the [dynamic value][data] cannot be decoded successfully,
  /// then null is returned. However, if [allowNull] is false and the [dynamic value][data]
  /// cannot be decoded successfully, then an [UnimplementedError] is thrown.
  ///
  /// The [allowNull] is very handy when an API changes and a new enum value is added or removed,
  /// and users are still using an old app with the old code.
  AgentProposeAlbumOperationsDtoOperationsInnerOneOf19PayloadContrastEnum? decode(dynamic data, {bool allowNull = true}) {
    if (data != null) {
      switch (data) {
        case r'strong_decrease': return AgentProposeAlbumOperationsDtoOperationsInnerOneOf19PayloadContrastEnum.strongDecrease;
        case r'moderate_decrease': return AgentProposeAlbumOperationsDtoOperationsInnerOneOf19PayloadContrastEnum.moderateDecrease;
        case r'slight_decrease': return AgentProposeAlbumOperationsDtoOperationsInnerOneOf19PayloadContrastEnum.slightDecrease;
        case r'slight_increase': return AgentProposeAlbumOperationsDtoOperationsInnerOneOf19PayloadContrastEnum.slightIncrease;
        case r'moderate_increase': return AgentProposeAlbumOperationsDtoOperationsInnerOneOf19PayloadContrastEnum.moderateIncrease;
        case r'strong_increase': return AgentProposeAlbumOperationsDtoOperationsInnerOneOf19PayloadContrastEnum.strongIncrease;
        default:
          if (!allowNull) {
            throw ArgumentError('Unknown enum value to decode: $data');
          }
      }
    }
    return null;
  }

  /// Singleton [AgentProposeAlbumOperationsDtoOperationsInnerOneOf19PayloadContrastEnumTypeTransformer] instance.
  static AgentProposeAlbumOperationsDtoOperationsInnerOneOf19PayloadContrastEnumTypeTransformer? _instance;
}



class AgentProposeAlbumOperationsDtoOperationsInnerOneOf19PayloadSaturationEnum {
  /// Instantiate a new enum with the provided [value].
  const AgentProposeAlbumOperationsDtoOperationsInnerOneOf19PayloadSaturationEnum._(this.value);

  /// The underlying value of this enum member.
  final String value;

  @override
  String toString() => value;

  String toJson() => value;

  static const strongDecrease = AgentProposeAlbumOperationsDtoOperationsInnerOneOf19PayloadSaturationEnum._(r'strong_decrease');
  static const moderateDecrease = AgentProposeAlbumOperationsDtoOperationsInnerOneOf19PayloadSaturationEnum._(r'moderate_decrease');
  static const slightDecrease = AgentProposeAlbumOperationsDtoOperationsInnerOneOf19PayloadSaturationEnum._(r'slight_decrease');
  static const slightIncrease = AgentProposeAlbumOperationsDtoOperationsInnerOneOf19PayloadSaturationEnum._(r'slight_increase');
  static const moderateIncrease = AgentProposeAlbumOperationsDtoOperationsInnerOneOf19PayloadSaturationEnum._(r'moderate_increase');
  static const strongIncrease = AgentProposeAlbumOperationsDtoOperationsInnerOneOf19PayloadSaturationEnum._(r'strong_increase');

  /// List of all possible values in this [enum][AgentProposeAlbumOperationsDtoOperationsInnerOneOf19PayloadSaturationEnum].
  static const values = <AgentProposeAlbumOperationsDtoOperationsInnerOneOf19PayloadSaturationEnum>[
    strongDecrease,
    moderateDecrease,
    slightDecrease,
    slightIncrease,
    moderateIncrease,
    strongIncrease,
  ];

  static AgentProposeAlbumOperationsDtoOperationsInnerOneOf19PayloadSaturationEnum? fromJson(dynamic value) => AgentProposeAlbumOperationsDtoOperationsInnerOneOf19PayloadSaturationEnumTypeTransformer().decode(value);

  static List<AgentProposeAlbumOperationsDtoOperationsInnerOneOf19PayloadSaturationEnum> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <AgentProposeAlbumOperationsDtoOperationsInnerOneOf19PayloadSaturationEnum>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = AgentProposeAlbumOperationsDtoOperationsInnerOneOf19PayloadSaturationEnum.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }
}

/// Transformation class that can [encode] an instance of [AgentProposeAlbumOperationsDtoOperationsInnerOneOf19PayloadSaturationEnum] to Optional<String?>,
/// and [decode] dynamic data back to [AgentProposeAlbumOperationsDtoOperationsInnerOneOf19PayloadSaturationEnum].
class AgentProposeAlbumOperationsDtoOperationsInnerOneOf19PayloadSaturationEnumTypeTransformer {
  factory AgentProposeAlbumOperationsDtoOperationsInnerOneOf19PayloadSaturationEnumTypeTransformer() => _instance ??= const AgentProposeAlbumOperationsDtoOperationsInnerOneOf19PayloadSaturationEnumTypeTransformer._();

  const AgentProposeAlbumOperationsDtoOperationsInnerOneOf19PayloadSaturationEnumTypeTransformer._();

  String encode(AgentProposeAlbumOperationsDtoOperationsInnerOneOf19PayloadSaturationEnum data) => data.value;

  /// Decodes a [dynamic value][data] to a AgentProposeAlbumOperationsDtoOperationsInnerOneOf19PayloadSaturationEnum.
  ///
  /// If [allowNull] is true and the [dynamic value][data] cannot be decoded successfully,
  /// then null is returned. However, if [allowNull] is false and the [dynamic value][data]
  /// cannot be decoded successfully, then an [UnimplementedError] is thrown.
  ///
  /// The [allowNull] is very handy when an API changes and a new enum value is added or removed,
  /// and users are still using an old app with the old code.
  AgentProposeAlbumOperationsDtoOperationsInnerOneOf19PayloadSaturationEnum? decode(dynamic data, {bool allowNull = true}) {
    if (data != null) {
      switch (data) {
        case r'strong_decrease': return AgentProposeAlbumOperationsDtoOperationsInnerOneOf19PayloadSaturationEnum.strongDecrease;
        case r'moderate_decrease': return AgentProposeAlbumOperationsDtoOperationsInnerOneOf19PayloadSaturationEnum.moderateDecrease;
        case r'slight_decrease': return AgentProposeAlbumOperationsDtoOperationsInnerOneOf19PayloadSaturationEnum.slightDecrease;
        case r'slight_increase': return AgentProposeAlbumOperationsDtoOperationsInnerOneOf19PayloadSaturationEnum.slightIncrease;
        case r'moderate_increase': return AgentProposeAlbumOperationsDtoOperationsInnerOneOf19PayloadSaturationEnum.moderateIncrease;
        case r'strong_increase': return AgentProposeAlbumOperationsDtoOperationsInnerOneOf19PayloadSaturationEnum.strongIncrease;
        default:
          if (!allowNull) {
            throw ArgumentError('Unknown enum value to decode: $data');
          }
      }
    }
    return null;
  }

  /// Singleton [AgentProposeAlbumOperationsDtoOperationsInnerOneOf19PayloadSaturationEnumTypeTransformer] instance.
  static AgentProposeAlbumOperationsDtoOperationsInnerOneOf19PayloadSaturationEnumTypeTransformer? _instance;
}


