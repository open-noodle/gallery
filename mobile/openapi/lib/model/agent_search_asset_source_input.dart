//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

class AgentSearchAssetSourceInput {
  /// Returns a new [AgentSearchAssetSourceInput] instance.
  AgentSearchAssetSourceInput({
    this.filters = const Optional.absent(),
    required this.kind,
    this.limit = const Optional.absent(),
    this.materialization = const Optional.absent(),
    this.mode = const Optional.absent(),
    this.order = const Optional.absent(),
    this.page = const Optional.absent(),
    this.query = const Optional.absent(),
  });

  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  Optional<AgentDeclarativeAssetFilters?> filters;

  AgentSearchAssetSourceInputKindEnum kind;

  /// Minimum value: 1
  /// Maximum value: 10000
  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  Optional<int?> limit;

  Optional<AgentSearchAssetSourceInputMaterializationEnum?> materialization;

  Optional<AgentSearchAssetSourceInputModeEnum?> mode;

  Optional<AgentSearchAssetSourceInputOrderEnum?> order;

  /// Minimum value: 1
  /// Maximum value: 9007199254740991
  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  Optional<int?> page;

  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  Optional<String?> query;

  @override
  bool operator ==(Object other) => identical(this, other) || other is AgentSearchAssetSourceInput &&
    other.filters == filters &&
    other.kind == kind &&
    other.limit == limit &&
    other.materialization == materialization &&
    other.mode == mode &&
    other.order == order &&
    other.page == page &&
    other.query == query;

  @override
  int get hashCode =>
    // ignore: unnecessary_parenthesis
    (filters == null ? 0 : filters!.hashCode) +
    (kind.hashCode) +
    (limit == null ? 0 : limit!.hashCode) +
    (materialization == null ? 0 : materialization!.hashCode) +
    (mode == null ? 0 : mode!.hashCode) +
    (order == null ? 0 : order!.hashCode) +
    (page == null ? 0 : page!.hashCode) +
    (query == null ? 0 : query!.hashCode);

  @override
  String toString() => 'AgentSearchAssetSourceInput[filters=$filters, kind=$kind, limit=$limit, materialization=$materialization, mode=$mode, order=$order, page=$page, query=$query]';

  Map<String, dynamic> toJson() {
    final json = <String, dynamic>{};
    if (this.filters.isPresent) {
      final value = this.filters.value;
      json[r'filters'] = value;
    }
      json[r'kind'] = this.kind;
    if (this.limit.isPresent) {
      final value = this.limit.value;
      json[r'limit'] = value;
    }
    if (this.materialization.isPresent) {
      final value = this.materialization.value;
      json[r'materialization'] = value;
    }
    if (this.mode.isPresent) {
      final value = this.mode.value;
      json[r'mode'] = value;
    }
    if (this.order.isPresent) {
      final value = this.order.value;
      json[r'order'] = value;
    }
    if (this.page.isPresent) {
      final value = this.page.value;
      json[r'page'] = value;
    }
    if (this.query.isPresent) {
      final value = this.query.value;
      json[r'query'] = value;
    }
    return json;
  }

  /// Returns a new [AgentSearchAssetSourceInput] instance and imports its values from
  /// [value] if it's a [Map], null otherwise.
  // ignore: prefer_constructors_over_static_methods
  static AgentSearchAssetSourceInput? fromJson(dynamic value) {
    upgradeDto(value, "AgentSearchAssetSourceInput");
    if (value is Map) {
      final json = value.cast<String, dynamic>();

      return AgentSearchAssetSourceInput(
        filters: json.containsKey(r'filters') ? Optional.present(AgentDeclarativeAssetFilters.fromJson(json[r'filters'])) : const Optional.absent(),
        kind: AgentSearchAssetSourceInputKindEnum.fromJson(json[r'kind'])!,
        limit: json.containsKey(r'limit') ? Optional.present(json[r'limit'] == null ? null : int.parse('${json[r'limit']}')) : const Optional.absent(),
        materialization: json.containsKey(r'materialization') ? Optional.present(AgentSearchAssetSourceInputMaterializationEnum.fromJson(json[r'materialization'])) : const Optional.absent(),
        mode: json.containsKey(r'mode') ? Optional.present(AgentSearchAssetSourceInputModeEnum.fromJson(json[r'mode'])) : const Optional.absent(),
        order: json.containsKey(r'order') ? Optional.present(AgentSearchAssetSourceInputOrderEnum.fromJson(json[r'order'])) : const Optional.absent(),
        page: json.containsKey(r'page') ? Optional.present(json[r'page'] == null ? null : int.parse('${json[r'page']}')) : const Optional.absent(),
        query: json.containsKey(r'query') ? Optional.present(mapValueOfType<String>(json, r'query')) : const Optional.absent(),
      );
    }
    return null;
  }

  static List<AgentSearchAssetSourceInput> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <AgentSearchAssetSourceInput>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = AgentSearchAssetSourceInput.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }

  static Map<String, AgentSearchAssetSourceInput> mapFromJson(dynamic json) {
    final map = <String, AgentSearchAssetSourceInput>{};
    if (json is Map && json.isNotEmpty) {
      json = json.cast<String, dynamic>(); // ignore: parameter_assignments
      for (final entry in json.entries) {
        final value = AgentSearchAssetSourceInput.fromJson(entry.value);
        if (value != null) {
          map[entry.key] = value;
        }
      }
    }
    return map;
  }

  // maps a json object with a list of AgentSearchAssetSourceInput-objects as value to a dart map
  static Map<String, List<AgentSearchAssetSourceInput>> mapListFromJson(dynamic json, {bool growable = false,}) {
    final map = <String, List<AgentSearchAssetSourceInput>>{};
    if (json is Map && json.isNotEmpty) {
      // ignore: parameter_assignments
      json = json.cast<String, dynamic>();
      for (final entry in json.entries) {
        map[entry.key] = AgentSearchAssetSourceInput.listFromJson(entry.value, growable: growable,);
      }
    }
    return map;
  }

  /// The list of required keys that must be present in a JSON.
  static const requiredKeys = <String>{
    'kind',
  };
}


class AgentSearchAssetSourceInputKindEnum {
  /// Instantiate a new enum with the provided [value].
  const AgentSearchAssetSourceInputKindEnum._(this.value);

  /// The underlying value of this enum member.
  final String value;

  @override
  String toString() => value;

  String toJson() => value;

  static const search = AgentSearchAssetSourceInputKindEnum._(r'search');

  /// List of all possible values in this [enum][AgentSearchAssetSourceInputKindEnum].
  static const values = <AgentSearchAssetSourceInputKindEnum>[
    search,
  ];

  static AgentSearchAssetSourceInputKindEnum? fromJson(dynamic value) => AgentSearchAssetSourceInputKindEnumTypeTransformer().decode(value);

  static List<AgentSearchAssetSourceInputKindEnum> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <AgentSearchAssetSourceInputKindEnum>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = AgentSearchAssetSourceInputKindEnum.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }
}

/// Transformation class that can [encode] an instance of [AgentSearchAssetSourceInputKindEnum] to String,
/// and [decode] dynamic data back to [AgentSearchAssetSourceInputKindEnum].
class AgentSearchAssetSourceInputKindEnumTypeTransformer {
  factory AgentSearchAssetSourceInputKindEnumTypeTransformer() => _instance ??= const AgentSearchAssetSourceInputKindEnumTypeTransformer._();

  const AgentSearchAssetSourceInputKindEnumTypeTransformer._();

  String encode(AgentSearchAssetSourceInputKindEnum data) => data.value;

  /// Decodes a [dynamic value][data] to a AgentSearchAssetSourceInputKindEnum.
  ///
  /// If [allowNull] is true and the [dynamic value][data] cannot be decoded successfully,
  /// then null is returned. However, if [allowNull] is false and the [dynamic value][data]
  /// cannot be decoded successfully, then an [UnimplementedError] is thrown.
  ///
  /// The [allowNull] is very handy when an API changes and a new enum value is added or removed,
  /// and users are still using an old app with the old code.
  AgentSearchAssetSourceInputKindEnum? decode(dynamic data, {bool allowNull = true}) {
    if (data != null) {
      switch (data) {
        case r'search': return AgentSearchAssetSourceInputKindEnum.search;
        default:
          if (!allowNull) {
            throw ArgumentError('Unknown enum value to decode: $data');
          }
      }
    }
    return null;
  }

  /// Singleton [AgentSearchAssetSourceInputKindEnumTypeTransformer] instance.
  static AgentSearchAssetSourceInputKindEnumTypeTransformer? _instance;
}



class AgentSearchAssetSourceInputMaterializationEnum {
  /// Instantiate a new enum with the provided [value].
  const AgentSearchAssetSourceInputMaterializationEnum._(this.value);

  /// The underlying value of this enum member.
  final String value;

  @override
  String toString() => value;

  String toJson() => value;

  static const boundedPage = AgentSearchAssetSourceInputMaterializationEnum._(r'bounded-page');
  static const allMatchesWithLimit = AgentSearchAssetSourceInputMaterializationEnum._(r'all-matches-with-limit');

  /// List of all possible values in this [enum][AgentSearchAssetSourceInputMaterializationEnum].
  static const values = <AgentSearchAssetSourceInputMaterializationEnum>[
    boundedPage,
    allMatchesWithLimit,
  ];

  static AgentSearchAssetSourceInputMaterializationEnum? fromJson(dynamic value) => AgentSearchAssetSourceInputMaterializationEnumTypeTransformer().decode(value);

  static List<AgentSearchAssetSourceInputMaterializationEnum> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <AgentSearchAssetSourceInputMaterializationEnum>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = AgentSearchAssetSourceInputMaterializationEnum.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }
}

/// Transformation class that can [encode] an instance of [AgentSearchAssetSourceInputMaterializationEnum] to Optional<String?>,
/// and [decode] dynamic data back to [AgentSearchAssetSourceInputMaterializationEnum].
class AgentSearchAssetSourceInputMaterializationEnumTypeTransformer {
  factory AgentSearchAssetSourceInputMaterializationEnumTypeTransformer() => _instance ??= const AgentSearchAssetSourceInputMaterializationEnumTypeTransformer._();

  const AgentSearchAssetSourceInputMaterializationEnumTypeTransformer._();

  String encode(AgentSearchAssetSourceInputMaterializationEnum data) => data.value;

  /// Decodes a [dynamic value][data] to a AgentSearchAssetSourceInputMaterializationEnum.
  ///
  /// If [allowNull] is true and the [dynamic value][data] cannot be decoded successfully,
  /// then null is returned. However, if [allowNull] is false and the [dynamic value][data]
  /// cannot be decoded successfully, then an [UnimplementedError] is thrown.
  ///
  /// The [allowNull] is very handy when an API changes and a new enum value is added or removed,
  /// and users are still using an old app with the old code.
  AgentSearchAssetSourceInputMaterializationEnum? decode(dynamic data, {bool allowNull = true}) {
    if (data != null) {
      switch (data) {
        case r'bounded-page': return AgentSearchAssetSourceInputMaterializationEnum.boundedPage;
        case r'all-matches-with-limit': return AgentSearchAssetSourceInputMaterializationEnum.allMatchesWithLimit;
        default:
          if (!allowNull) {
            throw ArgumentError('Unknown enum value to decode: $data');
          }
      }
    }
    return null;
  }

  /// Singleton [AgentSearchAssetSourceInputMaterializationEnumTypeTransformer] instance.
  static AgentSearchAssetSourceInputMaterializationEnumTypeTransformer? _instance;
}



class AgentSearchAssetSourceInputModeEnum {
  /// Instantiate a new enum with the provided [value].
  const AgentSearchAssetSourceInputModeEnum._(this.value);

  /// The underlying value of this enum member.
  final String value;

  @override
  String toString() => value;

  String toJson() => value;

  static const metadata = AgentSearchAssetSourceInputModeEnum._(r'metadata');
  static const smart = AgentSearchAssetSourceInputModeEnum._(r'smart');
  static const description = AgentSearchAssetSourceInputModeEnum._(r'description');
  static const ocr = AgentSearchAssetSourceInputModeEnum._(r'ocr');
  static const filename = AgentSearchAssetSourceInputModeEnum._(r'filename');

  /// List of all possible values in this [enum][AgentSearchAssetSourceInputModeEnum].
  static const values = <AgentSearchAssetSourceInputModeEnum>[
    metadata,
    smart,
    description,
    ocr,
    filename,
  ];

  static AgentSearchAssetSourceInputModeEnum? fromJson(dynamic value) => AgentSearchAssetSourceInputModeEnumTypeTransformer().decode(value);

  static List<AgentSearchAssetSourceInputModeEnum> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <AgentSearchAssetSourceInputModeEnum>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = AgentSearchAssetSourceInputModeEnum.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }
}

/// Transformation class that can [encode] an instance of [AgentSearchAssetSourceInputModeEnum] to Optional<String?>,
/// and [decode] dynamic data back to [AgentSearchAssetSourceInputModeEnum].
class AgentSearchAssetSourceInputModeEnumTypeTransformer {
  factory AgentSearchAssetSourceInputModeEnumTypeTransformer() => _instance ??= const AgentSearchAssetSourceInputModeEnumTypeTransformer._();

  const AgentSearchAssetSourceInputModeEnumTypeTransformer._();

  String encode(AgentSearchAssetSourceInputModeEnum data) => data.value;

  /// Decodes a [dynamic value][data] to a AgentSearchAssetSourceInputModeEnum.
  ///
  /// If [allowNull] is true and the [dynamic value][data] cannot be decoded successfully,
  /// then null is returned. However, if [allowNull] is false and the [dynamic value][data]
  /// cannot be decoded successfully, then an [UnimplementedError] is thrown.
  ///
  /// The [allowNull] is very handy when an API changes and a new enum value is added or removed,
  /// and users are still using an old app with the old code.
  AgentSearchAssetSourceInputModeEnum? decode(dynamic data, {bool allowNull = true}) {
    if (data != null) {
      switch (data) {
        case r'metadata': return AgentSearchAssetSourceInputModeEnum.metadata;
        case r'smart': return AgentSearchAssetSourceInputModeEnum.smart;
        case r'description': return AgentSearchAssetSourceInputModeEnum.description;
        case r'ocr': return AgentSearchAssetSourceInputModeEnum.ocr;
        case r'filename': return AgentSearchAssetSourceInputModeEnum.filename;
        default:
          if (!allowNull) {
            throw ArgumentError('Unknown enum value to decode: $data');
          }
      }
    }
    return null;
  }

  /// Singleton [AgentSearchAssetSourceInputModeEnumTypeTransformer] instance.
  static AgentSearchAssetSourceInputModeEnumTypeTransformer? _instance;
}



class AgentSearchAssetSourceInputOrderEnum {
  /// Instantiate a new enum with the provided [value].
  const AgentSearchAssetSourceInputOrderEnum._(this.value);

  /// The underlying value of this enum member.
  final String value;

  @override
  String toString() => value;

  String toJson() => value;

  static const asc = AgentSearchAssetSourceInputOrderEnum._(r'asc');
  static const desc = AgentSearchAssetSourceInputOrderEnum._(r'desc');
  static const relevance = AgentSearchAssetSourceInputOrderEnum._(r'relevance');

  /// List of all possible values in this [enum][AgentSearchAssetSourceInputOrderEnum].
  static const values = <AgentSearchAssetSourceInputOrderEnum>[
    asc,
    desc,
    relevance,
  ];

  static AgentSearchAssetSourceInputOrderEnum? fromJson(dynamic value) => AgentSearchAssetSourceInputOrderEnumTypeTransformer().decode(value);

  static List<AgentSearchAssetSourceInputOrderEnum> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <AgentSearchAssetSourceInputOrderEnum>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = AgentSearchAssetSourceInputOrderEnum.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }
}

/// Transformation class that can [encode] an instance of [AgentSearchAssetSourceInputOrderEnum] to Optional<String?>,
/// and [decode] dynamic data back to [AgentSearchAssetSourceInputOrderEnum].
class AgentSearchAssetSourceInputOrderEnumTypeTransformer {
  factory AgentSearchAssetSourceInputOrderEnumTypeTransformer() => _instance ??= const AgentSearchAssetSourceInputOrderEnumTypeTransformer._();

  const AgentSearchAssetSourceInputOrderEnumTypeTransformer._();

  String encode(AgentSearchAssetSourceInputOrderEnum data) => data.value;

  /// Decodes a [dynamic value][data] to a AgentSearchAssetSourceInputOrderEnum.
  ///
  /// If [allowNull] is true and the [dynamic value][data] cannot be decoded successfully,
  /// then null is returned. However, if [allowNull] is false and the [dynamic value][data]
  /// cannot be decoded successfully, then an [UnimplementedError] is thrown.
  ///
  /// The [allowNull] is very handy when an API changes and a new enum value is added or removed,
  /// and users are still using an old app with the old code.
  AgentSearchAssetSourceInputOrderEnum? decode(dynamic data, {bool allowNull = true}) {
    if (data != null) {
      switch (data) {
        case r'asc': return AgentSearchAssetSourceInputOrderEnum.asc;
        case r'desc': return AgentSearchAssetSourceInputOrderEnum.desc;
        case r'relevance': return AgentSearchAssetSourceInputOrderEnum.relevance;
        default:
          if (!allowNull) {
            throw ArgumentError('Unknown enum value to decode: $data');
          }
      }
    }
    return null;
  }

  /// Singleton [AgentSearchAssetSourceInputOrderEnumTypeTransformer] instance.
  static AgentSearchAssetSourceInputOrderEnumTypeTransformer? _instance;
}


