//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

class AgentSearchAssetsToolRequestDto {
  /// Returns a new [AgentSearchAssetsToolRequestDto] instance.
  AgentSearchAssetsToolRequestDto({
    this.createSelectionHandle = const Optional.absent(),
    this.detail = const Optional.absent(),
    this.fields = const Optional.present(const []),
    this.filters = const Optional.absent(),
    this.limit = const Optional.absent(),
    this.mode = const Optional.absent(),
    this.order = const Optional.absent(),
    this.page = const Optional.absent(),
    this.query = const Optional.absent(),
    this.sampleSize = const Optional.absent(),
    this.toolCallId = const Optional.absent(),
  });

  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  Optional<bool?> createSelectionHandle;

  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  Optional<AgentSearchAssetsRequestDetail?> detail;

  Optional<List<AgentSearchAssetsField>?> fields;

  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  Optional<AgentSearchAssetsFilters?> filters;

  /// Minimum value: 1
  /// Maximum value: 10000
  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  Optional<int?> limit;

  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  Optional<AgentSearchAssetsMode?> mode;

  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  Optional<AgentSearchAssetsOrder?> order;

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

  /// Minimum value: 0
  /// Maximum value: 25
  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  Optional<int?> sampleSize;

  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  Optional<String?> toolCallId;

  @override
  bool operator ==(Object other) => identical(this, other) || other is AgentSearchAssetsToolRequestDto &&
    other.createSelectionHandle == createSelectionHandle &&
    other.detail == detail &&
    _deepEquality.equals(other.fields, fields) &&
    other.filters == filters &&
    other.limit == limit &&
    other.mode == mode &&
    other.order == order &&
    other.page == page &&
    other.query == query &&
    other.sampleSize == sampleSize &&
    other.toolCallId == toolCallId;

  @override
  int get hashCode =>
    // ignore: unnecessary_parenthesis
    (createSelectionHandle == null ? 0 : createSelectionHandle!.hashCode) +
    (detail == null ? 0 : detail!.hashCode) +
    (fields.hashCode) +
    (filters == null ? 0 : filters!.hashCode) +
    (limit == null ? 0 : limit!.hashCode) +
    (mode == null ? 0 : mode!.hashCode) +
    (order == null ? 0 : order!.hashCode) +
    (page == null ? 0 : page!.hashCode) +
    (query == null ? 0 : query!.hashCode) +
    (sampleSize == null ? 0 : sampleSize!.hashCode) +
    (toolCallId == null ? 0 : toolCallId!.hashCode);

  @override
  String toString() => 'AgentSearchAssetsToolRequestDto[createSelectionHandle=$createSelectionHandle, detail=$detail, fields=$fields, filters=$filters, limit=$limit, mode=$mode, order=$order, page=$page, query=$query, sampleSize=$sampleSize, toolCallId=$toolCallId]';

  Map<String, dynamic> toJson() {
    final json = <String, dynamic>{};
    if (this.createSelectionHandle.isPresent) {
      final value = this.createSelectionHandle.value;
      json[r'createSelectionHandle'] = value;
    }
    if (this.detail.isPresent) {
      final value = this.detail.value;
      json[r'detail'] = value;
    }
    if (this.fields.isPresent) {
      final value = this.fields.value;
      json[r'fields'] = value;
    }
    if (this.filters.isPresent) {
      final value = this.filters.value;
      json[r'filters'] = value;
    }
    if (this.limit.isPresent) {
      final value = this.limit.value;
      json[r'limit'] = value;
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
    if (this.sampleSize.isPresent) {
      final value = this.sampleSize.value;
      json[r'sampleSize'] = value;
    }
    if (this.toolCallId.isPresent) {
      final value = this.toolCallId.value;
      json[r'toolCallId'] = value;
    }
    return json;
  }

  /// Returns a new [AgentSearchAssetsToolRequestDto] instance and imports its values from
  /// [value] if it's a [Map], null otherwise.
  // ignore: prefer_constructors_over_static_methods
  static AgentSearchAssetsToolRequestDto? fromJson(dynamic value) {
    upgradeDto(value, "AgentSearchAssetsToolRequestDto");
    if (value is Map) {
      final json = value.cast<String, dynamic>();

      return AgentSearchAssetsToolRequestDto(
        createSelectionHandle: json.containsKey(r'createSelectionHandle') ? Optional.present(mapValueOfType<bool>(json, r'createSelectionHandle')) : const Optional.absent(),
        detail: json.containsKey(r'detail') ? Optional.present(AgentSearchAssetsRequestDetail.fromJson(json[r'detail'])) : const Optional.absent(),
        fields: json.containsKey(r'fields') ? Optional.present(AgentSearchAssetsField.listFromJson(json[r'fields'])) : const Optional.absent(),
        filters: json.containsKey(r'filters') ? Optional.present(AgentSearchAssetsFilters.fromJson(json[r'filters'])) : const Optional.absent(),
        limit: json.containsKey(r'limit') ? Optional.present(json[r'limit'] == null ? null : int.parse('${json[r'limit']}')) : const Optional.absent(),
        mode: json.containsKey(r'mode') ? Optional.present(AgentSearchAssetsMode.fromJson(json[r'mode'])) : const Optional.absent(),
        order: json.containsKey(r'order') ? Optional.present(AgentSearchAssetsOrder.fromJson(json[r'order'])) : const Optional.absent(),
        page: json.containsKey(r'page') ? Optional.present(json[r'page'] == null ? null : int.parse('${json[r'page']}')) : const Optional.absent(),
        query: json.containsKey(r'query') ? Optional.present(mapValueOfType<String>(json, r'query')) : const Optional.absent(),
        sampleSize: json.containsKey(r'sampleSize') ? Optional.present(json[r'sampleSize'] == null ? null : int.parse('${json[r'sampleSize']}')) : const Optional.absent(),
        toolCallId: json.containsKey(r'toolCallId') ? Optional.present(mapValueOfType<String>(json, r'toolCallId')) : const Optional.absent(),
      );
    }
    return null;
  }

  static List<AgentSearchAssetsToolRequestDto> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <AgentSearchAssetsToolRequestDto>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = AgentSearchAssetsToolRequestDto.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }

  static Map<String, AgentSearchAssetsToolRequestDto> mapFromJson(dynamic json) {
    final map = <String, AgentSearchAssetsToolRequestDto>{};
    if (json is Map && json.isNotEmpty) {
      json = json.cast<String, dynamic>(); // ignore: parameter_assignments
      for (final entry in json.entries) {
        final value = AgentSearchAssetsToolRequestDto.fromJson(entry.value);
        if (value != null) {
          map[entry.key] = value;
        }
      }
    }
    return map;
  }

  // maps a json object with a list of AgentSearchAssetsToolRequestDto-objects as value to a dart map
  static Map<String, List<AgentSearchAssetsToolRequestDto>> mapListFromJson(dynamic json, {bool growable = false,}) {
    final map = <String, List<AgentSearchAssetsToolRequestDto>>{};
    if (json is Map && json.isNotEmpty) {
      // ignore: parameter_assignments
      json = json.cast<String, dynamic>();
      for (final entry in json.entries) {
        map[entry.key] = AgentSearchAssetsToolRequestDto.listFromJson(entry.value, growable: growable,);
      }
    }
    return map;
  }

  /// The list of required keys that must be present in a JSON.
  static const requiredKeys = <String>{
  };
}

