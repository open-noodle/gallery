//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

class AgentAssetSourceInput {
  /// Returns a new [AgentAssetSourceInput] instance.
  AgentAssetSourceInput({
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

  AgentAssetSourceInputKindEnum kind;

  /// Minimum value: 1
  /// Maximum value: 10000
  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  Optional<int?> limit;

  Optional<AgentAssetSourceInputMaterializationEnum?> materialization;

  Optional<AgentAssetSourceInputModeEnum?> mode;

  Optional<AgentAssetSourceInputOrderEnum?> order;

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
  bool operator ==(Object other) => identical(this, other) || other is AgentAssetSourceInput &&
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
  String toString() => 'AgentAssetSourceInput[filters=$filters, kind=$kind, limit=$limit, materialization=$materialization, mode=$mode, order=$order, page=$page, query=$query, sourceRef=$sourceRef, selectionHandleId=$selectionHandleId, assetIds=$assetIds]';

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

  /// Returns a new [AgentAssetSourceInput] instance and imports its values from
  /// [value] if it's a [Map], null otherwise.
  // ignore: prefer_constructors_over_static_methods
  static AgentAssetSourceInput? fromJson(dynamic value) {
    upgradeDto(value, "AgentAssetSourceInput");
    if (value is Map) {
      final json = value.cast<String, dynamic>();

      return AgentAssetSourceInput(
        filters: json.containsKey(r'filters') ? Optional.present(AgentDeclarativeAssetFilters.fromJson(json[r'filters'])) : const Optional.absent(),
        kind: AgentAssetSourceInputKindEnum.fromJson(json[r'kind'])!,
        limit: json.containsKey(r'limit') ? Optional.present(json[r'limit'] == null ? null : int.parse('${json[r'limit']}')) : const Optional.absent(),
        materialization: json.containsKey(r'materialization') ? Optional.present(AgentAssetSourceInputMaterializationEnum.fromJson(json[r'materialization'])) : const Optional.absent(),
        mode: json.containsKey(r'mode') ? Optional.present(AgentAssetSourceInputModeEnum.fromJson(json[r'mode'])) : const Optional.absent(),
        order: json.containsKey(r'order') ? Optional.present(AgentAssetSourceInputOrderEnum.fromJson(json[r'order'])) : const Optional.absent(),
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

  static List<AgentAssetSourceInput> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <AgentAssetSourceInput>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = AgentAssetSourceInput.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }

  static Map<String, AgentAssetSourceInput> mapFromJson(dynamic json) {
    final map = <String, AgentAssetSourceInput>{};
    if (json is Map && json.isNotEmpty) {
      json = json.cast<String, dynamic>(); // ignore: parameter_assignments
      for (final entry in json.entries) {
        final value = AgentAssetSourceInput.fromJson(entry.value);
        if (value != null) {
          map[entry.key] = value;
        }
      }
    }
    return map;
  }

  // maps a json object with a list of AgentAssetSourceInput-objects as value to a dart map
  static Map<String, List<AgentAssetSourceInput>> mapListFromJson(dynamic json, {bool growable = false,}) {
    final map = <String, List<AgentAssetSourceInput>>{};
    if (json is Map && json.isNotEmpty) {
      // ignore: parameter_assignments
      json = json.cast<String, dynamic>();
      for (final entry in json.entries) {
        map[entry.key] = AgentAssetSourceInput.listFromJson(entry.value, growable: growable,);
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


enum AgentAssetSourceInputKindEnum {
  explicitAssets._(r'explicitAssets'),
  ;

  /// Instantiate a new enum with the provided value.
  const AgentAssetSourceInputKindEnum._(this._value);

  /// The underlying value of this enum member.
  final String _value;

  @override
  String toString() => _value;

  /// Encodes this enum as a value suitable for JSON.
  String toJson() => _value;

  /// Returns the instance of [AgentAssetSourceInputKindEnum] that was successfully decoded
  /// from the passed [value] on success, null otherwise.
  static AgentAssetSourceInputKindEnum? fromJson(dynamic value) => AgentAssetSourceInputKindEnumTypeTransformer().decode(value);

  /// Returns a [List] containing instances of [AgentAssetSourceInputKindEnum]
  /// that were successfully decoded from the passed [JSON][json].
  static List<AgentAssetSourceInputKindEnum> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <AgentAssetSourceInputKindEnum>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = AgentAssetSourceInputKindEnum.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }
}

/// Transformation class that can [encode] an instance of [AgentAssetSourceInputKindEnum] to String,
/// and [decode] dynamic data back to [AgentAssetSourceInputKindEnum].
class AgentAssetSourceInputKindEnumTypeTransformer {
  factory AgentAssetSourceInputKindEnumTypeTransformer() => _instance ??= const AgentAssetSourceInputKindEnumTypeTransformer._();

  const AgentAssetSourceInputKindEnumTypeTransformer._();

  String encode(AgentAssetSourceInputKindEnum data) => data._value;

  /// Returns the instance of [AgentAssetSourceInputKindEnum] that was successfully decoded
  /// from the passed [data] value on success, null otherwise.
  ///
  /// If [allowNull] is true and the [dynamic value][data] cannot be decoded successfully,
  /// then null is returned. However, if [allowNull] is false and the [dynamic value][data]
  /// cannot be decoded successfully, then an [UnimplementedError] is thrown.
  ///
  /// The [allowNull] is very handy when an API changes and a new enum value is added or removed,
  /// and users are still using an old app with the old code.
  AgentAssetSourceInputKindEnum? decode(dynamic data, {bool allowNull = true}) {
    if (data is AgentAssetSourceInputKindEnum) {
      return data;
    }
    if (data != null) {
      switch (data) {
        case r'explicitAssets': return AgentAssetSourceInputKindEnum.explicitAssets;
        default:
          if (!allowNull) {
            throw ArgumentError('Unknown enum value to decode: $data');
          }
      }
    }
    return null;
  }

  /// The singleton instance of this transformer.
  static AgentAssetSourceInputKindEnumTypeTransformer? _instance;
}



enum AgentAssetSourceInputMaterializationEnum {
  boundedPage._(r'bounded-page'),
  allMatchesWithLimit._(r'all-matches-with-limit'),
  ;

  /// Instantiate a new enum with the provided value.
  const AgentAssetSourceInputMaterializationEnum._(this._value);

  /// The underlying value of this enum member.
  final String _value;

  @override
  String toString() => _value;

  /// Encodes this enum as a value suitable for JSON.
  String toJson() => _value;

  /// Returns the instance of [AgentAssetSourceInputMaterializationEnum] that was successfully decoded
  /// from the passed [value] on success, null otherwise.
  static AgentAssetSourceInputMaterializationEnum? fromJson(dynamic value) => AgentAssetSourceInputMaterializationEnumTypeTransformer().decode(value);

  /// Returns a [List] containing instances of [AgentAssetSourceInputMaterializationEnum]
  /// that were successfully decoded from the passed [JSON][json].
  static List<AgentAssetSourceInputMaterializationEnum> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <AgentAssetSourceInputMaterializationEnum>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = AgentAssetSourceInputMaterializationEnum.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }
}

/// Transformation class that can [encode] an instance of [AgentAssetSourceInputMaterializationEnum] to Optional<String?>,
/// and [decode] dynamic data back to [AgentAssetSourceInputMaterializationEnum].
class AgentAssetSourceInputMaterializationEnumTypeTransformer {
  factory AgentAssetSourceInputMaterializationEnumTypeTransformer() => _instance ??= const AgentAssetSourceInputMaterializationEnumTypeTransformer._();

  const AgentAssetSourceInputMaterializationEnumTypeTransformer._();

  String encode(AgentAssetSourceInputMaterializationEnum data) => data._value;

  /// Returns the instance of [AgentAssetSourceInputMaterializationEnum] that was successfully decoded
  /// from the passed [data] value on success, null otherwise.
  ///
  /// If [allowNull] is true and the [dynamic value][data] cannot be decoded successfully,
  /// then null is returned. However, if [allowNull] is false and the [dynamic value][data]
  /// cannot be decoded successfully, then an [UnimplementedError] is thrown.
  ///
  /// The [allowNull] is very handy when an API changes and a new enum value is added or removed,
  /// and users are still using an old app with the old code.
  AgentAssetSourceInputMaterializationEnum? decode(dynamic data, {bool allowNull = true}) {
    if (data is AgentAssetSourceInputMaterializationEnum) {
      return data;
    }
    if (data != null) {
      switch (data) {
        case r'bounded-page': return AgentAssetSourceInputMaterializationEnum.boundedPage;
        case r'all-matches-with-limit': return AgentAssetSourceInputMaterializationEnum.allMatchesWithLimit;
        default:
          if (!allowNull) {
            throw ArgumentError('Unknown enum value to decode: $data');
          }
      }
    }
    return null;
  }

  /// The singleton instance of this transformer.
  static AgentAssetSourceInputMaterializationEnumTypeTransformer? _instance;
}



enum AgentAssetSourceInputModeEnum {
  metadata._(r'metadata'),
  smart._(r'smart'),
  description._(r'description'),
  ocr._(r'ocr'),
  filename._(r'filename'),
  ;

  /// Instantiate a new enum with the provided value.
  const AgentAssetSourceInputModeEnum._(this._value);

  /// The underlying value of this enum member.
  final String _value;

  @override
  String toString() => _value;

  /// Encodes this enum as a value suitable for JSON.
  String toJson() => _value;

  /// Returns the instance of [AgentAssetSourceInputModeEnum] that was successfully decoded
  /// from the passed [value] on success, null otherwise.
  static AgentAssetSourceInputModeEnum? fromJson(dynamic value) => AgentAssetSourceInputModeEnumTypeTransformer().decode(value);

  /// Returns a [List] containing instances of [AgentAssetSourceInputModeEnum]
  /// that were successfully decoded from the passed [JSON][json].
  static List<AgentAssetSourceInputModeEnum> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <AgentAssetSourceInputModeEnum>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = AgentAssetSourceInputModeEnum.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }
}

/// Transformation class that can [encode] an instance of [AgentAssetSourceInputModeEnum] to Optional<String?>,
/// and [decode] dynamic data back to [AgentAssetSourceInputModeEnum].
class AgentAssetSourceInputModeEnumTypeTransformer {
  factory AgentAssetSourceInputModeEnumTypeTransformer() => _instance ??= const AgentAssetSourceInputModeEnumTypeTransformer._();

  const AgentAssetSourceInputModeEnumTypeTransformer._();

  String encode(AgentAssetSourceInputModeEnum data) => data._value;

  /// Returns the instance of [AgentAssetSourceInputModeEnum] that was successfully decoded
  /// from the passed [data] value on success, null otherwise.
  ///
  /// If [allowNull] is true and the [dynamic value][data] cannot be decoded successfully,
  /// then null is returned. However, if [allowNull] is false and the [dynamic value][data]
  /// cannot be decoded successfully, then an [UnimplementedError] is thrown.
  ///
  /// The [allowNull] is very handy when an API changes and a new enum value is added or removed,
  /// and users are still using an old app with the old code.
  AgentAssetSourceInputModeEnum? decode(dynamic data, {bool allowNull = true}) {
    if (data is AgentAssetSourceInputModeEnum) {
      return data;
    }
    if (data != null) {
      switch (data) {
        case r'metadata': return AgentAssetSourceInputModeEnum.metadata;
        case r'smart': return AgentAssetSourceInputModeEnum.smart;
        case r'description': return AgentAssetSourceInputModeEnum.description;
        case r'ocr': return AgentAssetSourceInputModeEnum.ocr;
        case r'filename': return AgentAssetSourceInputModeEnum.filename;
        default:
          if (!allowNull) {
            throw ArgumentError('Unknown enum value to decode: $data');
          }
      }
    }
    return null;
  }

  /// The singleton instance of this transformer.
  static AgentAssetSourceInputModeEnumTypeTransformer? _instance;
}



enum AgentAssetSourceInputOrderEnum {
  asc._(r'asc'),
  desc._(r'desc'),
  relevance._(r'relevance'),
  ;

  /// Instantiate a new enum with the provided value.
  const AgentAssetSourceInputOrderEnum._(this._value);

  /// The underlying value of this enum member.
  final String _value;

  @override
  String toString() => _value;

  /// Encodes this enum as a value suitable for JSON.
  String toJson() => _value;

  /// Returns the instance of [AgentAssetSourceInputOrderEnum] that was successfully decoded
  /// from the passed [value] on success, null otherwise.
  static AgentAssetSourceInputOrderEnum? fromJson(dynamic value) => AgentAssetSourceInputOrderEnumTypeTransformer().decode(value);

  /// Returns a [List] containing instances of [AgentAssetSourceInputOrderEnum]
  /// that were successfully decoded from the passed [JSON][json].
  static List<AgentAssetSourceInputOrderEnum> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <AgentAssetSourceInputOrderEnum>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = AgentAssetSourceInputOrderEnum.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }
}

/// Transformation class that can [encode] an instance of [AgentAssetSourceInputOrderEnum] to Optional<String?>,
/// and [decode] dynamic data back to [AgentAssetSourceInputOrderEnum].
class AgentAssetSourceInputOrderEnumTypeTransformer {
  factory AgentAssetSourceInputOrderEnumTypeTransformer() => _instance ??= const AgentAssetSourceInputOrderEnumTypeTransformer._();

  const AgentAssetSourceInputOrderEnumTypeTransformer._();

  String encode(AgentAssetSourceInputOrderEnum data) => data._value;

  /// Returns the instance of [AgentAssetSourceInputOrderEnum] that was successfully decoded
  /// from the passed [data] value on success, null otherwise.
  ///
  /// If [allowNull] is true and the [dynamic value][data] cannot be decoded successfully,
  /// then null is returned. However, if [allowNull] is false and the [dynamic value][data]
  /// cannot be decoded successfully, then an [UnimplementedError] is thrown.
  ///
  /// The [allowNull] is very handy when an API changes and a new enum value is added or removed,
  /// and users are still using an old app with the old code.
  AgentAssetSourceInputOrderEnum? decode(dynamic data, {bool allowNull = true}) {
    if (data is AgentAssetSourceInputOrderEnum) {
      return data;
    }
    if (data != null) {
      switch (data) {
        case r'asc': return AgentAssetSourceInputOrderEnum.asc;
        case r'desc': return AgentAssetSourceInputOrderEnum.desc;
        case r'relevance': return AgentAssetSourceInputOrderEnum.relevance;
        default:
          if (!allowNull) {
            throw ArgumentError('Unknown enum value to decode: $data');
          }
      }
    }
    return null;
  }

  /// The singleton instance of this transformer.
  static AgentAssetSourceInputOrderEnumTypeTransformer? _instance;
}


