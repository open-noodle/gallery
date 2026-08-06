//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

class AgentOperationPlanningAssetSourceInput {
  /// Returns a new [AgentOperationPlanningAssetSourceInput] instance.
  AgentOperationPlanningAssetSourceInput({
    this.filters = const Optional.absent(),
    required this.kind,
    this.limit = const Optional.absent(),
    this.materialization = const Optional.absent(),
    this.mode = const Optional.absent(),
    this.order = const Optional.absent(),
    this.page = const Optional.absent(),
    this.query = const Optional.absent(),
    required this.sourceRef,
    required this.selectionHandleId,
    this.assetIds = const [],
  });

  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  Optional<AgentDeclarativeAssetFilters?> filters;

  AgentOperationPlanningAssetSourceInputKindEnum kind;

  /// Minimum value: 1
  /// Maximum value: 10000
  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  Optional<int?> limit;

  Optional<AgentOperationPlanningAssetSourceInputMaterializationEnum?> materialization;

  Optional<AgentOperationPlanningAssetSourceInputModeEnum?> mode;

  Optional<AgentOperationPlanningAssetSourceInputOrderEnum?> order;

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

  String sourceRef;

  String selectionHandleId;

  List<String> assetIds;

  @override
  bool operator ==(Object other) => identical(this, other) || other is AgentOperationPlanningAssetSourceInput &&
    other.filters == filters &&
    other.kind == kind &&
    other.limit == limit &&
    other.materialization == materialization &&
    other.mode == mode &&
    other.order == order &&
    other.page == page &&
    other.query == query &&
    other.sourceRef == sourceRef &&
    other.selectionHandleId == selectionHandleId &&
    _deepEquality.equals(other.assetIds, assetIds);

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
    (query == null ? 0 : query!.hashCode) +
    (sourceRef.hashCode) +
    (selectionHandleId.hashCode) +
    (assetIds.hashCode);

  @override
  String toString() => 'AgentOperationPlanningAssetSourceInput[filters=$filters, kind=$kind, limit=$limit, materialization=$materialization, mode=$mode, order=$order, page=$page, query=$query, sourceRef=$sourceRef, selectionHandleId=$selectionHandleId, assetIds=$assetIds]';

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
      json[r'sourceRef'] = this.sourceRef;
      json[r'selectionHandleId'] = this.selectionHandleId;
      json[r'assetIds'] = this.assetIds;
    return json;
  }

  /// Returns a new [AgentOperationPlanningAssetSourceInput] instance and imports its values from
  /// [value] if it's a [Map], null otherwise.
  // ignore: prefer_constructors_over_static_methods
  static AgentOperationPlanningAssetSourceInput? fromJson(dynamic value) {
    upgradeDto(value, "AgentOperationPlanningAssetSourceInput");
    if (value is Map) {
      final json = value.cast<String, dynamic>();

      return AgentOperationPlanningAssetSourceInput(
        filters: json.containsKey(r'filters') ? Optional.present(AgentDeclarativeAssetFilters.fromJson(json[r'filters'])) : const Optional.absent(),
        kind: AgentOperationPlanningAssetSourceInputKindEnum.fromJson(json[r'kind'])!,
        limit: json.containsKey(r'limit') ? Optional.present(json[r'limit'] == null ? null : int.parse('${json[r'limit']}')) : const Optional.absent(),
        materialization: json.containsKey(r'materialization') ? Optional.present(AgentOperationPlanningAssetSourceInputMaterializationEnum.fromJson(json[r'materialization'])) : const Optional.absent(),
        mode: json.containsKey(r'mode') ? Optional.present(AgentOperationPlanningAssetSourceInputModeEnum.fromJson(json[r'mode'])) : const Optional.absent(),
        order: json.containsKey(r'order') ? Optional.present(AgentOperationPlanningAssetSourceInputOrderEnum.fromJson(json[r'order'])) : const Optional.absent(),
        page: json.containsKey(r'page') ? Optional.present(json[r'page'] == null ? null : int.parse('${json[r'page']}')) : const Optional.absent(),
        query: json.containsKey(r'query') ? Optional.present(mapValueOfType<String>(json, r'query')) : const Optional.absent(),
        sourceRef: mapValueOfType<String>(json, r'sourceRef')!,
        selectionHandleId: mapValueOfType<String>(json, r'selectionHandleId')!,
        assetIds: json[r'assetIds'] is Iterable
            ? (json[r'assetIds'] as Iterable).cast<String>().toList(growable: false)
            : const [],
      );
    }
    return null;
  }

  static List<AgentOperationPlanningAssetSourceInput> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <AgentOperationPlanningAssetSourceInput>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = AgentOperationPlanningAssetSourceInput.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }

  static Map<String, AgentOperationPlanningAssetSourceInput> mapFromJson(dynamic json) {
    final map = <String, AgentOperationPlanningAssetSourceInput>{};
    if (json is Map && json.isNotEmpty) {
      json = json.cast<String, dynamic>(); // ignore: parameter_assignments
      for (final entry in json.entries) {
        final value = AgentOperationPlanningAssetSourceInput.fromJson(entry.value);
        if (value != null) {
          map[entry.key] = value;
        }
      }
    }
    return map;
  }

  // maps a json object with a list of AgentOperationPlanningAssetSourceInput-objects as value to a dart map
  static Map<String, List<AgentOperationPlanningAssetSourceInput>> mapListFromJson(dynamic json, {bool growable = false,}) {
    final map = <String, List<AgentOperationPlanningAssetSourceInput>>{};
    if (json is Map && json.isNotEmpty) {
      // ignore: parameter_assignments
      json = json.cast<String, dynamic>();
      for (final entry in json.entries) {
        map[entry.key] = AgentOperationPlanningAssetSourceInput.listFromJson(entry.value, growable: growable,);
      }
    }
    return map;
  }

  /// The list of required keys that must be present in a JSON.
  static const requiredKeys = <String>{
    'kind',
    'sourceRef',
    'selectionHandleId',
    'assetIds',
  };
}


class AgentOperationPlanningAssetSourceInputKindEnum {
  /// Instantiate a new enum with the provided [value].
  const AgentOperationPlanningAssetSourceInputKindEnum._(this.value);

  /// The underlying value of this enum member.
  final String value;

  @override
  String toString() => value;

  String toJson() => value;

  static const explicitAssets = AgentOperationPlanningAssetSourceInputKindEnum._(r'explicitAssets');

  /// List of all possible values in this [enum][AgentOperationPlanningAssetSourceInputKindEnum].
  static const values = <AgentOperationPlanningAssetSourceInputKindEnum>[
    explicitAssets,
  ];

  static AgentOperationPlanningAssetSourceInputKindEnum? fromJson(dynamic value) => AgentOperationPlanningAssetSourceInputKindEnumTypeTransformer().decode(value);

  static List<AgentOperationPlanningAssetSourceInputKindEnum> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <AgentOperationPlanningAssetSourceInputKindEnum>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = AgentOperationPlanningAssetSourceInputKindEnum.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }
}

/// Transformation class that can [encode] an instance of [AgentOperationPlanningAssetSourceInputKindEnum] to String,
/// and [decode] dynamic data back to [AgentOperationPlanningAssetSourceInputKindEnum].
class AgentOperationPlanningAssetSourceInputKindEnumTypeTransformer {
  factory AgentOperationPlanningAssetSourceInputKindEnumTypeTransformer() => _instance ??= const AgentOperationPlanningAssetSourceInputKindEnumTypeTransformer._();

  const AgentOperationPlanningAssetSourceInputKindEnumTypeTransformer._();

  String encode(AgentOperationPlanningAssetSourceInputKindEnum data) => data.value;

  /// Decodes a [dynamic value][data] to a AgentOperationPlanningAssetSourceInputKindEnum.
  ///
  /// If [allowNull] is true and the [dynamic value][data] cannot be decoded successfully,
  /// then null is returned. However, if [allowNull] is false and the [dynamic value][data]
  /// cannot be decoded successfully, then an [UnimplementedError] is thrown.
  ///
  /// The [allowNull] is very handy when an API changes and a new enum value is added or removed,
  /// and users are still using an old app with the old code.
  AgentOperationPlanningAssetSourceInputKindEnum? decode(dynamic data, {bool allowNull = true}) {
    if (data != null) {
      switch (data) {
        case r'explicitAssets': return AgentOperationPlanningAssetSourceInputKindEnum.explicitAssets;
        default:
          if (!allowNull) {
            throw ArgumentError('Unknown enum value to decode: $data');
          }
      }
    }
    return null;
  }

  /// Singleton [AgentOperationPlanningAssetSourceInputKindEnumTypeTransformer] instance.
  static AgentOperationPlanningAssetSourceInputKindEnumTypeTransformer? _instance;
}



class AgentOperationPlanningAssetSourceInputMaterializationEnum {
  /// Instantiate a new enum with the provided [value].
  const AgentOperationPlanningAssetSourceInputMaterializationEnum._(this.value);

  /// The underlying value of this enum member.
  final String value;

  @override
  String toString() => value;

  String toJson() => value;

  static const boundedPage = AgentOperationPlanningAssetSourceInputMaterializationEnum._(r'bounded-page');
  static const allMatchesWithLimit = AgentOperationPlanningAssetSourceInputMaterializationEnum._(r'all-matches-with-limit');

  /// List of all possible values in this [enum][AgentOperationPlanningAssetSourceInputMaterializationEnum].
  static const values = <AgentOperationPlanningAssetSourceInputMaterializationEnum>[
    boundedPage,
    allMatchesWithLimit,
  ];

  static AgentOperationPlanningAssetSourceInputMaterializationEnum? fromJson(dynamic value) => AgentOperationPlanningAssetSourceInputMaterializationEnumTypeTransformer().decode(value);

  static List<AgentOperationPlanningAssetSourceInputMaterializationEnum> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <AgentOperationPlanningAssetSourceInputMaterializationEnum>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = AgentOperationPlanningAssetSourceInputMaterializationEnum.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }
}

/// Transformation class that can [encode] an instance of [AgentOperationPlanningAssetSourceInputMaterializationEnum] to Optional<String?>,
/// and [decode] dynamic data back to [AgentOperationPlanningAssetSourceInputMaterializationEnum].
class AgentOperationPlanningAssetSourceInputMaterializationEnumTypeTransformer {
  factory AgentOperationPlanningAssetSourceInputMaterializationEnumTypeTransformer() => _instance ??= const AgentOperationPlanningAssetSourceInputMaterializationEnumTypeTransformer._();

  const AgentOperationPlanningAssetSourceInputMaterializationEnumTypeTransformer._();

  String encode(AgentOperationPlanningAssetSourceInputMaterializationEnum data) => data.value;

  /// Decodes a [dynamic value][data] to a AgentOperationPlanningAssetSourceInputMaterializationEnum.
  ///
  /// If [allowNull] is true and the [dynamic value][data] cannot be decoded successfully,
  /// then null is returned. However, if [allowNull] is false and the [dynamic value][data]
  /// cannot be decoded successfully, then an [UnimplementedError] is thrown.
  ///
  /// The [allowNull] is very handy when an API changes and a new enum value is added or removed,
  /// and users are still using an old app with the old code.
  AgentOperationPlanningAssetSourceInputMaterializationEnum? decode(dynamic data, {bool allowNull = true}) {
    if (data != null) {
      switch (data) {
        case r'bounded-page': return AgentOperationPlanningAssetSourceInputMaterializationEnum.boundedPage;
        case r'all-matches-with-limit': return AgentOperationPlanningAssetSourceInputMaterializationEnum.allMatchesWithLimit;
        default:
          if (!allowNull) {
            throw ArgumentError('Unknown enum value to decode: $data');
          }
      }
    }
    return null;
  }

  /// Singleton [AgentOperationPlanningAssetSourceInputMaterializationEnumTypeTransformer] instance.
  static AgentOperationPlanningAssetSourceInputMaterializationEnumTypeTransformer? _instance;
}



class AgentOperationPlanningAssetSourceInputModeEnum {
  /// Instantiate a new enum with the provided [value].
  const AgentOperationPlanningAssetSourceInputModeEnum._(this.value);

  /// The underlying value of this enum member.
  final String value;

  @override
  String toString() => value;

  String toJson() => value;

  static const metadata = AgentOperationPlanningAssetSourceInputModeEnum._(r'metadata');
  static const smart = AgentOperationPlanningAssetSourceInputModeEnum._(r'smart');
  static const description = AgentOperationPlanningAssetSourceInputModeEnum._(r'description');
  static const ocr = AgentOperationPlanningAssetSourceInputModeEnum._(r'ocr');
  static const filename = AgentOperationPlanningAssetSourceInputModeEnum._(r'filename');

  /// List of all possible values in this [enum][AgentOperationPlanningAssetSourceInputModeEnum].
  static const values = <AgentOperationPlanningAssetSourceInputModeEnum>[
    metadata,
    smart,
    description,
    ocr,
    filename,
  ];

  static AgentOperationPlanningAssetSourceInputModeEnum? fromJson(dynamic value) => AgentOperationPlanningAssetSourceInputModeEnumTypeTransformer().decode(value);

  static List<AgentOperationPlanningAssetSourceInputModeEnum> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <AgentOperationPlanningAssetSourceInputModeEnum>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = AgentOperationPlanningAssetSourceInputModeEnum.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }
}

/// Transformation class that can [encode] an instance of [AgentOperationPlanningAssetSourceInputModeEnum] to Optional<String?>,
/// and [decode] dynamic data back to [AgentOperationPlanningAssetSourceInputModeEnum].
class AgentOperationPlanningAssetSourceInputModeEnumTypeTransformer {
  factory AgentOperationPlanningAssetSourceInputModeEnumTypeTransformer() => _instance ??= const AgentOperationPlanningAssetSourceInputModeEnumTypeTransformer._();

  const AgentOperationPlanningAssetSourceInputModeEnumTypeTransformer._();

  String encode(AgentOperationPlanningAssetSourceInputModeEnum data) => data.value;

  /// Decodes a [dynamic value][data] to a AgentOperationPlanningAssetSourceInputModeEnum.
  ///
  /// If [allowNull] is true and the [dynamic value][data] cannot be decoded successfully,
  /// then null is returned. However, if [allowNull] is false and the [dynamic value][data]
  /// cannot be decoded successfully, then an [UnimplementedError] is thrown.
  ///
  /// The [allowNull] is very handy when an API changes and a new enum value is added or removed,
  /// and users are still using an old app with the old code.
  AgentOperationPlanningAssetSourceInputModeEnum? decode(dynamic data, {bool allowNull = true}) {
    if (data != null) {
      switch (data) {
        case r'metadata': return AgentOperationPlanningAssetSourceInputModeEnum.metadata;
        case r'smart': return AgentOperationPlanningAssetSourceInputModeEnum.smart;
        case r'description': return AgentOperationPlanningAssetSourceInputModeEnum.description;
        case r'ocr': return AgentOperationPlanningAssetSourceInputModeEnum.ocr;
        case r'filename': return AgentOperationPlanningAssetSourceInputModeEnum.filename;
        default:
          if (!allowNull) {
            throw ArgumentError('Unknown enum value to decode: $data');
          }
      }
    }
    return null;
  }

  /// Singleton [AgentOperationPlanningAssetSourceInputModeEnumTypeTransformer] instance.
  static AgentOperationPlanningAssetSourceInputModeEnumTypeTransformer? _instance;
}



class AgentOperationPlanningAssetSourceInputOrderEnum {
  /// Instantiate a new enum with the provided [value].
  const AgentOperationPlanningAssetSourceInputOrderEnum._(this.value);

  /// The underlying value of this enum member.
  final String value;

  @override
  String toString() => value;

  String toJson() => value;

  static const asc = AgentOperationPlanningAssetSourceInputOrderEnum._(r'asc');
  static const desc = AgentOperationPlanningAssetSourceInputOrderEnum._(r'desc');
  static const relevance = AgentOperationPlanningAssetSourceInputOrderEnum._(r'relevance');

  /// List of all possible values in this [enum][AgentOperationPlanningAssetSourceInputOrderEnum].
  static const values = <AgentOperationPlanningAssetSourceInputOrderEnum>[
    asc,
    desc,
    relevance,
  ];

  static AgentOperationPlanningAssetSourceInputOrderEnum? fromJson(dynamic value) => AgentOperationPlanningAssetSourceInputOrderEnumTypeTransformer().decode(value);

  static List<AgentOperationPlanningAssetSourceInputOrderEnum> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <AgentOperationPlanningAssetSourceInputOrderEnum>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = AgentOperationPlanningAssetSourceInputOrderEnum.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }
}

/// Transformation class that can [encode] an instance of [AgentOperationPlanningAssetSourceInputOrderEnum] to Optional<String?>,
/// and [decode] dynamic data back to [AgentOperationPlanningAssetSourceInputOrderEnum].
class AgentOperationPlanningAssetSourceInputOrderEnumTypeTransformer {
  factory AgentOperationPlanningAssetSourceInputOrderEnumTypeTransformer() => _instance ??= const AgentOperationPlanningAssetSourceInputOrderEnumTypeTransformer._();

  const AgentOperationPlanningAssetSourceInputOrderEnumTypeTransformer._();

  String encode(AgentOperationPlanningAssetSourceInputOrderEnum data) => data.value;

  /// Decodes a [dynamic value][data] to a AgentOperationPlanningAssetSourceInputOrderEnum.
  ///
  /// If [allowNull] is true and the [dynamic value][data] cannot be decoded successfully,
  /// then null is returned. However, if [allowNull] is false and the [dynamic value][data]
  /// cannot be decoded successfully, then an [UnimplementedError] is thrown.
  ///
  /// The [allowNull] is very handy when an API changes and a new enum value is added or removed,
  /// and users are still using an old app with the old code.
  AgentOperationPlanningAssetSourceInputOrderEnum? decode(dynamic data, {bool allowNull = true}) {
    if (data != null) {
      switch (data) {
        case r'asc': return AgentOperationPlanningAssetSourceInputOrderEnum.asc;
        case r'desc': return AgentOperationPlanningAssetSourceInputOrderEnum.desc;
        case r'relevance': return AgentOperationPlanningAssetSourceInputOrderEnum.relevance;
        default:
          if (!allowNull) {
            throw ArgumentError('Unknown enum value to decode: $data');
          }
      }
    }
    return null;
  }

  /// Singleton [AgentOperationPlanningAssetSourceInputOrderEnumTypeTransformer] instance.
  static AgentOperationPlanningAssetSourceInputOrderEnumTypeTransformer? _instance;
}


