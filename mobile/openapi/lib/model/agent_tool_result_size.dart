//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

class AgentToolResultSize {
  /// Returns a new [AgentToolResultSize] instance.
  AgentToolResultSize({
    required this.estimatedBytes,
    required this.hasMore,
    required this.nextPage,
    this.omittedFields = const [],
    required this.returnedItems,
    required this.truncated,
  });

  /// Minimum value: 0
  /// Maximum value: 9007199254740991
  int? estimatedBytes;

  bool hasMore;

  String? nextPage;

  List<String> omittedFields;

  /// Minimum value: 0
  /// Maximum value: 9007199254740991
  int returnedItems;

  bool truncated;

  @override
  bool operator ==(Object other) => identical(this, other) || other is AgentToolResultSize &&
    other.estimatedBytes == estimatedBytes &&
    other.hasMore == hasMore &&
    other.nextPage == nextPage &&
    _deepEquality.equals(other.omittedFields, omittedFields) &&
    other.returnedItems == returnedItems &&
    other.truncated == truncated;

  @override
  int get hashCode =>
    // ignore: unnecessary_parenthesis
    (estimatedBytes == null ? 0 : estimatedBytes!.hashCode) +
    (hasMore.hashCode) +
    (nextPage == null ? 0 : nextPage!.hashCode) +
    (omittedFields.hashCode) +
    (returnedItems.hashCode) +
    (truncated.hashCode);

  @override
  String toString() => 'AgentToolResultSize[estimatedBytes=$estimatedBytes, hasMore=$hasMore, nextPage=$nextPage, omittedFields=$omittedFields, returnedItems=$returnedItems, truncated=$truncated]';

  Map<String, dynamic> toJson() {
    final json = <String, dynamic>{};
    if (this.estimatedBytes != null) {
      json[r'estimatedBytes'] = this.estimatedBytes;
    } else {
    //  json[r'estimatedBytes'] = null;
    }
      json[r'hasMore'] = this.hasMore;
    if (this.nextPage != null) {
      json[r'nextPage'] = this.nextPage;
    } else {
    //  json[r'nextPage'] = null;
    }
      json[r'omittedFields'] = this.omittedFields;
      json[r'returnedItems'] = this.returnedItems;
      json[r'truncated'] = this.truncated;
    return json;
  }

  /// Returns a new [AgentToolResultSize] instance and imports its values from
  /// [value] if it's a [Map], null otherwise.
  // ignore: prefer_constructors_over_static_methods
  static AgentToolResultSize? fromJson(dynamic value) {
    upgradeDto(value, "AgentToolResultSize");
    if (value is Map) {
      final json = value.cast<String, dynamic>();

      return AgentToolResultSize(
        estimatedBytes: mapValueOfType<int>(json, r'estimatedBytes'),
        hasMore: mapValueOfType<bool>(json, r'hasMore')!,
        nextPage: mapValueOfType<String>(json, r'nextPage'),
        omittedFields: json[r'omittedFields'] is Iterable
            ? (json[r'omittedFields'] as Iterable).cast<String>().toList(growable: false)
            : const [],
        returnedItems: mapValueOfType<int>(json, r'returnedItems')!,
        truncated: mapValueOfType<bool>(json, r'truncated')!,
      );
    }
    return null;
  }

  static List<AgentToolResultSize> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <AgentToolResultSize>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = AgentToolResultSize.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }

  static Map<String, AgentToolResultSize> mapFromJson(dynamic json) {
    final map = <String, AgentToolResultSize>{};
    if (json is Map && json.isNotEmpty) {
      json = json.cast<String, dynamic>(); // ignore: parameter_assignments
      for (final entry in json.entries) {
        final value = AgentToolResultSize.fromJson(entry.value);
        if (value != null) {
          map[entry.key] = value;
        }
      }
    }
    return map;
  }

  // maps a json object with a list of AgentToolResultSize-objects as value to a dart map
  static Map<String, List<AgentToolResultSize>> mapListFromJson(dynamic json, {bool growable = false,}) {
    final map = <String, List<AgentToolResultSize>>{};
    if (json is Map && json.isNotEmpty) {
      // ignore: parameter_assignments
      json = json.cast<String, dynamic>();
      for (final entry in json.entries) {
        map[entry.key] = AgentToolResultSize.listFromJson(entry.value, growable: growable,);
      }
    }
    return map;
  }

  /// The list of required keys that must be present in a JSON.
  static const requiredKeys = <String>{
    'estimatedBytes',
    'hasMore',
    'nextPage',
    'omittedFields',
    'returnedItems',
    'truncated',
  };
}

