//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

class AgentProviderCredentialCreateDto {
  /// Returns a new [AgentProviderCredentialCreateDto] instance.
  AgentProviderCredentialCreateDto({
    this.baseUrl = const Optional.absent(),
    this.defaultModel = const Optional.absent(),
    required this.label,
    this.models = const Optional.present(const []),
    required this.providerType,
    required this.secret,
  });

  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  Optional<String?> baseUrl;

  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  Optional<String?> defaultModel;

  String label;

  Optional<List<String>?> models;

  AgentProviderCredentialCreateDtoProviderTypeEnum providerType;

  String secret;

  @override
  bool operator ==(Object other) => identical(this, other) || other is AgentProviderCredentialCreateDto &&
    other.baseUrl == baseUrl &&
    other.defaultModel == defaultModel &&
    other.label == label &&
    _deepEquality.equals(other.models, models) &&
    other.providerType == providerType &&
    other.secret == secret;

  @override
  int get hashCode =>
    // ignore: unnecessary_parenthesis
    (baseUrl == null ? 0 : baseUrl!.hashCode) +
    (defaultModel == null ? 0 : defaultModel!.hashCode) +
    (label.hashCode) +
    (models.hashCode) +
    (providerType.hashCode) +
    (secret.hashCode);

  @override
  String toString() => 'AgentProviderCredentialCreateDto[baseUrl=$baseUrl, defaultModel=$defaultModel, label=$label, models=$models, providerType=$providerType, secret=$secret]';

  Map<String, dynamic> toJson() {
    final json = <String, dynamic>{};
    if (this.baseUrl.isPresent) {
      final value = this.baseUrl.value;
      json[r'baseUrl'] = value;
    }
    if (this.defaultModel.isPresent) {
      final value = this.defaultModel.value;
      json[r'defaultModel'] = value;
    }
      json[r'label'] = this.label;
    if (this.models.isPresent) {
      final value = this.models.value;
      json[r'models'] = value;
    }
      json[r'providerType'] = this.providerType;
      json[r'secret'] = this.secret;
    return json;
  }

  /// Returns a new [AgentProviderCredentialCreateDto] instance and imports its values from
  /// [value] if it's a [Map], null otherwise.
  // ignore: prefer_constructors_over_static_methods
  static AgentProviderCredentialCreateDto? fromJson(dynamic value) {
    upgradeDto(value, "AgentProviderCredentialCreateDto");
    if (value is Map) {
      final json = value.cast<String, dynamic>();

      return AgentProviderCredentialCreateDto(
        baseUrl: json.containsKey(r'baseUrl') ? Optional.present(mapValueOfType<String>(json, r'baseUrl')) : const Optional.absent(),
        defaultModel: json.containsKey(r'defaultModel') ? Optional.present(mapValueOfType<String>(json, r'defaultModel')) : const Optional.absent(),
        label: mapValueOfType<String>(json, r'label')!,
        models: json.containsKey(r'models') ? Optional.present(json[r'models'] is Iterable
            ? (json[r'models'] as Iterable).cast<String>().toList(growable: false)
            : const []) : const Optional.absent(),
        providerType: AgentProviderCredentialCreateDtoProviderTypeEnum.fromJson(json[r'providerType'])!,
        secret: mapValueOfType<String>(json, r'secret')!,
      );
    }
    return null;
  }

  static List<AgentProviderCredentialCreateDto> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <AgentProviderCredentialCreateDto>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = AgentProviderCredentialCreateDto.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }

  static Map<String, AgentProviderCredentialCreateDto> mapFromJson(dynamic json) {
    final map = <String, AgentProviderCredentialCreateDto>{};
    if (json is Map && json.isNotEmpty) {
      json = json.cast<String, dynamic>(); // ignore: parameter_assignments
      for (final entry in json.entries) {
        final value = AgentProviderCredentialCreateDto.fromJson(entry.value);
        if (value != null) {
          map[entry.key] = value;
        }
      }
    }
    return map;
  }

  // maps a json object with a list of AgentProviderCredentialCreateDto-objects as value to a dart map
  static Map<String, List<AgentProviderCredentialCreateDto>> mapListFromJson(dynamic json, {bool growable = false,}) {
    final map = <String, List<AgentProviderCredentialCreateDto>>{};
    if (json is Map && json.isNotEmpty) {
      // ignore: parameter_assignments
      json = json.cast<String, dynamic>();
      for (final entry in json.entries) {
        map[entry.key] = AgentProviderCredentialCreateDto.listFromJson(entry.value, growable: growable,);
      }
    }
    return map;
  }

  /// The list of required keys that must be present in a JSON.
  static const requiredKeys = <String>{
    'label',
    'providerType',
    'secret',
  };
}


class AgentProviderCredentialCreateDtoProviderTypeEnum {
  /// Instantiate a new enum with the provided [value].
  const AgentProviderCredentialCreateDtoProviderTypeEnum._(this.value);

  /// The underlying value of this enum member.
  final String value;

  @override
  String toString() => value;

  String toJson() => value;

  static const openai = AgentProviderCredentialCreateDtoProviderTypeEnum._(r'openai');
  static const anthropic = AgentProviderCredentialCreateDtoProviderTypeEnum._(r'anthropic');
  static const openaiCompatible = AgentProviderCredentialCreateDtoProviderTypeEnum._(r'openai-compatible');

  /// List of all possible values in this [enum][AgentProviderCredentialCreateDtoProviderTypeEnum].
  static const values = <AgentProviderCredentialCreateDtoProviderTypeEnum>[
    openai,
    anthropic,
    openaiCompatible,
  ];

  static AgentProviderCredentialCreateDtoProviderTypeEnum? fromJson(dynamic value) => AgentProviderCredentialCreateDtoProviderTypeEnumTypeTransformer().decode(value);

  static List<AgentProviderCredentialCreateDtoProviderTypeEnum> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <AgentProviderCredentialCreateDtoProviderTypeEnum>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = AgentProviderCredentialCreateDtoProviderTypeEnum.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }
}

/// Transformation class that can [encode] an instance of [AgentProviderCredentialCreateDtoProviderTypeEnum] to String,
/// and [decode] dynamic data back to [AgentProviderCredentialCreateDtoProviderTypeEnum].
class AgentProviderCredentialCreateDtoProviderTypeEnumTypeTransformer {
  factory AgentProviderCredentialCreateDtoProviderTypeEnumTypeTransformer() => _instance ??= const AgentProviderCredentialCreateDtoProviderTypeEnumTypeTransformer._();

  const AgentProviderCredentialCreateDtoProviderTypeEnumTypeTransformer._();

  String encode(AgentProviderCredentialCreateDtoProviderTypeEnum data) => data.value;

  /// Decodes a [dynamic value][data] to a AgentProviderCredentialCreateDtoProviderTypeEnum.
  ///
  /// If [allowNull] is true and the [dynamic value][data] cannot be decoded successfully,
  /// then null is returned. However, if [allowNull] is false and the [dynamic value][data]
  /// cannot be decoded successfully, then an [UnimplementedError] is thrown.
  ///
  /// The [allowNull] is very handy when an API changes and a new enum value is added or removed,
  /// and users are still using an old app with the old code.
  AgentProviderCredentialCreateDtoProviderTypeEnum? decode(dynamic data, {bool allowNull = true}) {
    if (data != null) {
      switch (data) {
        case r'openai': return AgentProviderCredentialCreateDtoProviderTypeEnum.openai;
        case r'anthropic': return AgentProviderCredentialCreateDtoProviderTypeEnum.anthropic;
        case r'openai-compatible': return AgentProviderCredentialCreateDtoProviderTypeEnum.openaiCompatible;
        default:
          if (!allowNull) {
            throw ArgumentError('Unknown enum value to decode: $data');
          }
      }
    }
    return null;
  }

  /// Singleton [AgentProviderCredentialCreateDtoProviderTypeEnumTypeTransformer] instance.
  static AgentProviderCredentialCreateDtoProviderTypeEnumTypeTransformer? _instance;
}


