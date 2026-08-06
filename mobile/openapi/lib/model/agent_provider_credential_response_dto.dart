//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

class AgentProviderCredentialResponseDto {
  /// Returns a new [AgentProviderCredentialResponseDto] instance.
  AgentProviderCredentialResponseDto({
    required this.baseUrl,
    required this.createdAt,
    required this.defaultModel,
    required this.id,
    required this.label,
    required this.lastUsedAt,
    this.models = const [],
    required this.providerType,
    required this.updatedAt,
  });

  String? baseUrl;

  DateTime createdAt;

  String? defaultModel;

  String id;

  String label;

  DateTime? lastUsedAt;

  List<String> models;

  AgentProviderCredentialResponseDtoProviderTypeEnum providerType;

  DateTime updatedAt;

  @override
  bool operator ==(Object other) => identical(this, other) || other is AgentProviderCredentialResponseDto &&
    other.baseUrl == baseUrl &&
    other.createdAt == createdAt &&
    other.defaultModel == defaultModel &&
    other.id == id &&
    other.label == label &&
    other.lastUsedAt == lastUsedAt &&
    _deepEquality.equals(other.models, models) &&
    other.providerType == providerType &&
    other.updatedAt == updatedAt;

  @override
  int get hashCode =>
    // ignore: unnecessary_parenthesis
    (baseUrl == null ? 0 : baseUrl!.hashCode) +
    (createdAt.hashCode) +
    (defaultModel == null ? 0 : defaultModel!.hashCode) +
    (id.hashCode) +
    (label.hashCode) +
    (lastUsedAt == null ? 0 : lastUsedAt!.hashCode) +
    (models.hashCode) +
    (providerType.hashCode) +
    (updatedAt.hashCode);

  @override
  String toString() => 'AgentProviderCredentialResponseDto[baseUrl=$baseUrl, createdAt=$createdAt, defaultModel=$defaultModel, id=$id, label=$label, lastUsedAt=$lastUsedAt, models=$models, providerType=$providerType, updatedAt=$updatedAt]';

  Map<String, dynamic> toJson() {
    final json = <String, dynamic>{};
    if (this.baseUrl != null) {
      json[r'baseUrl'] = this.baseUrl;
    } else {
    //  json[r'baseUrl'] = null;
    }
      json[r'createdAt'] = _isEpochMarker(r'/^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))T(?:(?:[01]\\d|2[0-3]):[0-5]\\d(?::[0-5]\\d(?:\\.\\d+)?)?(?:Z|([+-](?:[01]\\d|2[0-3]):[0-5]\\d)))$/')
        ? this.createdAt.millisecondsSinceEpoch
        : this.createdAt.toUtc().toIso8601String();
    if (this.defaultModel != null) {
      json[r'defaultModel'] = this.defaultModel;
    } else {
    //  json[r'defaultModel'] = null;
    }
      json[r'id'] = this.id;
      json[r'label'] = this.label;
    if (this.lastUsedAt != null) {
      json[r'lastUsedAt'] = _isEpochMarker(r'/^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))T(?:(?:[01]\\d|2[0-3]):[0-5]\\d(?::[0-5]\\d(?:\\.\\d+)?)?(?:Z|([+-](?:[01]\\d|2[0-3]):[0-5]\\d)))$/')
        ? this.lastUsedAt!.millisecondsSinceEpoch
        : this.lastUsedAt!.toUtc().toIso8601String();
    } else {
    //  json[r'lastUsedAt'] = null;
    }
      json[r'models'] = this.models;
      json[r'providerType'] = this.providerType;
      json[r'updatedAt'] = _isEpochMarker(r'/^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))T(?:(?:[01]\\d|2[0-3]):[0-5]\\d(?::[0-5]\\d(?:\\.\\d+)?)?(?:Z|([+-](?:[01]\\d|2[0-3]):[0-5]\\d)))$/')
        ? this.updatedAt.millisecondsSinceEpoch
        : this.updatedAt.toUtc().toIso8601String();
    return json;
  }

  /// Returns a new [AgentProviderCredentialResponseDto] instance and imports its values from
  /// [value] if it's a [Map], null otherwise.
  // ignore: prefer_constructors_over_static_methods
  static AgentProviderCredentialResponseDto? fromJson(dynamic value) {
    upgradeDto(value, "AgentProviderCredentialResponseDto");
    if (value is Map) {
      final json = value.cast<String, dynamic>();

      return AgentProviderCredentialResponseDto(
        baseUrl: mapValueOfType<String>(json, r'baseUrl'),
        createdAt: mapDateTime(json, r'createdAt', r'/^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))T(?:(?:[01]\\d|2[0-3]):[0-5]\\d(?::[0-5]\\d(?:\\.\\d+)?)?(?:Z|([+-](?:[01]\\d|2[0-3]):[0-5]\\d)))$/')!,
        defaultModel: mapValueOfType<String>(json, r'defaultModel'),
        id: mapValueOfType<String>(json, r'id')!,
        label: mapValueOfType<String>(json, r'label')!,
        lastUsedAt: mapDateTime(json, r'lastUsedAt', r'/^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))T(?:(?:[01]\\d|2[0-3]):[0-5]\\d(?::[0-5]\\d(?:\\.\\d+)?)?(?:Z|([+-](?:[01]\\d|2[0-3]):[0-5]\\d)))$/'),
        models: json[r'models'] is Iterable
            ? (json[r'models'] as Iterable).cast<String>().toList(growable: false)
            : const [],
        providerType: AgentProviderCredentialResponseDtoProviderTypeEnum.fromJson(json[r'providerType'])!,
        updatedAt: mapDateTime(json, r'updatedAt', r'/^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))T(?:(?:[01]\\d|2[0-3]):[0-5]\\d(?::[0-5]\\d(?:\\.\\d+)?)?(?:Z|([+-](?:[01]\\d|2[0-3]):[0-5]\\d)))$/')!,
      );
    }
    return null;
  }

  static List<AgentProviderCredentialResponseDto> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <AgentProviderCredentialResponseDto>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = AgentProviderCredentialResponseDto.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }

  static Map<String, AgentProviderCredentialResponseDto> mapFromJson(dynamic json) {
    final map = <String, AgentProviderCredentialResponseDto>{};
    if (json is Map && json.isNotEmpty) {
      json = json.cast<String, dynamic>(); // ignore: parameter_assignments
      for (final entry in json.entries) {
        final value = AgentProviderCredentialResponseDto.fromJson(entry.value);
        if (value != null) {
          map[entry.key] = value;
        }
      }
    }
    return map;
  }

  // maps a json object with a list of AgentProviderCredentialResponseDto-objects as value to a dart map
  static Map<String, List<AgentProviderCredentialResponseDto>> mapListFromJson(dynamic json, {bool growable = false,}) {
    final map = <String, List<AgentProviderCredentialResponseDto>>{};
    if (json is Map && json.isNotEmpty) {
      // ignore: parameter_assignments
      json = json.cast<String, dynamic>();
      for (final entry in json.entries) {
        map[entry.key] = AgentProviderCredentialResponseDto.listFromJson(entry.value, growable: growable,);
      }
    }
    return map;
  }

  /// The list of required keys that must be present in a JSON.
  static const requiredKeys = <String>{
    'baseUrl',
    'createdAt',
    'defaultModel',
    'id',
    'label',
    'lastUsedAt',
    'models',
    'providerType',
    'updatedAt',
  };
}


class AgentProviderCredentialResponseDtoProviderTypeEnum {
  /// Instantiate a new enum with the provided [value].
  const AgentProviderCredentialResponseDtoProviderTypeEnum._(this.value);

  /// The underlying value of this enum member.
  final String value;

  @override
  String toString() => value;

  String toJson() => value;

  static const openai = AgentProviderCredentialResponseDtoProviderTypeEnum._(r'openai');
  static const anthropic = AgentProviderCredentialResponseDtoProviderTypeEnum._(r'anthropic');
  static const openaiCompatible = AgentProviderCredentialResponseDtoProviderTypeEnum._(r'openai-compatible');

  /// List of all possible values in this [enum][AgentProviderCredentialResponseDtoProviderTypeEnum].
  static const values = <AgentProviderCredentialResponseDtoProviderTypeEnum>[
    openai,
    anthropic,
    openaiCompatible,
  ];

  static AgentProviderCredentialResponseDtoProviderTypeEnum? fromJson(dynamic value) => AgentProviderCredentialResponseDtoProviderTypeEnumTypeTransformer().decode(value);

  static List<AgentProviderCredentialResponseDtoProviderTypeEnum> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <AgentProviderCredentialResponseDtoProviderTypeEnum>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = AgentProviderCredentialResponseDtoProviderTypeEnum.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }
}

/// Transformation class that can [encode] an instance of [AgentProviderCredentialResponseDtoProviderTypeEnum] to String,
/// and [decode] dynamic data back to [AgentProviderCredentialResponseDtoProviderTypeEnum].
class AgentProviderCredentialResponseDtoProviderTypeEnumTypeTransformer {
  factory AgentProviderCredentialResponseDtoProviderTypeEnumTypeTransformer() => _instance ??= const AgentProviderCredentialResponseDtoProviderTypeEnumTypeTransformer._();

  const AgentProviderCredentialResponseDtoProviderTypeEnumTypeTransformer._();

  String encode(AgentProviderCredentialResponseDtoProviderTypeEnum data) => data.value;

  /// Decodes a [dynamic value][data] to a AgentProviderCredentialResponseDtoProviderTypeEnum.
  ///
  /// If [allowNull] is true and the [dynamic value][data] cannot be decoded successfully,
  /// then null is returned. However, if [allowNull] is false and the [dynamic value][data]
  /// cannot be decoded successfully, then an [UnimplementedError] is thrown.
  ///
  /// The [allowNull] is very handy when an API changes and a new enum value is added or removed,
  /// and users are still using an old app with the old code.
  AgentProviderCredentialResponseDtoProviderTypeEnum? decode(dynamic data, {bool allowNull = true}) {
    if (data != null) {
      switch (data) {
        case r'openai': return AgentProviderCredentialResponseDtoProviderTypeEnum.openai;
        case r'anthropic': return AgentProviderCredentialResponseDtoProviderTypeEnum.anthropic;
        case r'openai-compatible': return AgentProviderCredentialResponseDtoProviderTypeEnum.openaiCompatible;
        default:
          if (!allowNull) {
            throw ArgumentError('Unknown enum value to decode: $data');
          }
      }
    }
    return null;
  }

  /// Singleton [AgentProviderCredentialResponseDtoProviderTypeEnumTypeTransformer] instance.
  static AgentProviderCredentialResponseDtoProviderTypeEnumTypeTransformer? _instance;
}


