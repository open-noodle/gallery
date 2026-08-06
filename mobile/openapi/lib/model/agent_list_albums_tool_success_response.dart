//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

class AgentListAlbumsToolSuccessResponse {
  /// Returns a new [AgentListAlbumsToolSuccessResponse] instance.
  AgentListAlbumsToolSuccessResponse({
    this.albums = const [],
    required this.resultSize,
    required this.status,
    required this.toolCall,
  });

  List<AgentAlbumSummary> albums;

  AgentToolResultSize resultSize;

  AgentListAlbumsToolSuccessResponseStatusEnum status;

  AgentToolCallResponseDto toolCall;

  @override
  bool operator ==(Object other) => identical(this, other) || other is AgentListAlbumsToolSuccessResponse &&
    _deepEquality.equals(other.albums, albums) &&
    other.resultSize == resultSize &&
    other.status == status &&
    other.toolCall == toolCall;

  @override
  int get hashCode =>
    // ignore: unnecessary_parenthesis
    (albums.hashCode) +
    (resultSize.hashCode) +
    (status.hashCode) +
    (toolCall.hashCode);

  @override
  String toString() => 'AgentListAlbumsToolSuccessResponse[albums=$albums, resultSize=$resultSize, status=$status, toolCall=$toolCall]';

  Map<String, dynamic> toJson() {
    final json = <String, dynamic>{};
      json[r'albums'] = this.albums;
      json[r'resultSize'] = this.resultSize;
      json[r'status'] = this.status;
      json[r'toolCall'] = this.toolCall;
    return json;
  }

  /// Returns a new [AgentListAlbumsToolSuccessResponse] instance and imports its values from
  /// [value] if it's a [Map], null otherwise.
  // ignore: prefer_constructors_over_static_methods
  static AgentListAlbumsToolSuccessResponse? fromJson(dynamic value) {
    upgradeDto(value, "AgentListAlbumsToolSuccessResponse");
    if (value is Map) {
      final json = value.cast<String, dynamic>();

      return AgentListAlbumsToolSuccessResponse(
        albums: AgentAlbumSummary.listFromJson(json[r'albums']),
        resultSize: AgentToolResultSize.fromJson(json[r'resultSize'])!,
        status: AgentListAlbumsToolSuccessResponseStatusEnum.fromJson(json[r'status'])!,
        toolCall: AgentToolCallResponseDto.fromJson(json[r'toolCall'])!,
      );
    }
    return null;
  }

  static List<AgentListAlbumsToolSuccessResponse> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <AgentListAlbumsToolSuccessResponse>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = AgentListAlbumsToolSuccessResponse.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }

  static Map<String, AgentListAlbumsToolSuccessResponse> mapFromJson(dynamic json) {
    final map = <String, AgentListAlbumsToolSuccessResponse>{};
    if (json is Map && json.isNotEmpty) {
      json = json.cast<String, dynamic>(); // ignore: parameter_assignments
      for (final entry in json.entries) {
        final value = AgentListAlbumsToolSuccessResponse.fromJson(entry.value);
        if (value != null) {
          map[entry.key] = value;
        }
      }
    }
    return map;
  }

  // maps a json object with a list of AgentListAlbumsToolSuccessResponse-objects as value to a dart map
  static Map<String, List<AgentListAlbumsToolSuccessResponse>> mapListFromJson(dynamic json, {bool growable = false,}) {
    final map = <String, List<AgentListAlbumsToolSuccessResponse>>{};
    if (json is Map && json.isNotEmpty) {
      // ignore: parameter_assignments
      json = json.cast<String, dynamic>();
      for (final entry in json.entries) {
        map[entry.key] = AgentListAlbumsToolSuccessResponse.listFromJson(entry.value, growable: growable,);
      }
    }
    return map;
  }

  /// The list of required keys that must be present in a JSON.
  static const requiredKeys = <String>{
    'albums',
    'resultSize',
    'status',
    'toolCall',
  };
}


class AgentListAlbumsToolSuccessResponseStatusEnum {
  /// Instantiate a new enum with the provided [value].
  const AgentListAlbumsToolSuccessResponseStatusEnum._(this.value);

  /// The underlying value of this enum member.
  final String value;

  @override
  String toString() => value;

  String toJson() => value;

  static const success = AgentListAlbumsToolSuccessResponseStatusEnum._(r'success');

  /// List of all possible values in this [enum][AgentListAlbumsToolSuccessResponseStatusEnum].
  static const values = <AgentListAlbumsToolSuccessResponseStatusEnum>[
    success,
  ];

  static AgentListAlbumsToolSuccessResponseStatusEnum? fromJson(dynamic value) => AgentListAlbumsToolSuccessResponseStatusEnumTypeTransformer().decode(value);

  static List<AgentListAlbumsToolSuccessResponseStatusEnum> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <AgentListAlbumsToolSuccessResponseStatusEnum>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = AgentListAlbumsToolSuccessResponseStatusEnum.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }
}

/// Transformation class that can [encode] an instance of [AgentListAlbumsToolSuccessResponseStatusEnum] to String,
/// and [decode] dynamic data back to [AgentListAlbumsToolSuccessResponseStatusEnum].
class AgentListAlbumsToolSuccessResponseStatusEnumTypeTransformer {
  factory AgentListAlbumsToolSuccessResponseStatusEnumTypeTransformer() => _instance ??= const AgentListAlbumsToolSuccessResponseStatusEnumTypeTransformer._();

  const AgentListAlbumsToolSuccessResponseStatusEnumTypeTransformer._();

  String encode(AgentListAlbumsToolSuccessResponseStatusEnum data) => data.value;

  /// Decodes a [dynamic value][data] to a AgentListAlbumsToolSuccessResponseStatusEnum.
  ///
  /// If [allowNull] is true and the [dynamic value][data] cannot be decoded successfully,
  /// then null is returned. However, if [allowNull] is false and the [dynamic value][data]
  /// cannot be decoded successfully, then an [UnimplementedError] is thrown.
  ///
  /// The [allowNull] is very handy when an API changes and a new enum value is added or removed,
  /// and users are still using an old app with the old code.
  AgentListAlbumsToolSuccessResponseStatusEnum? decode(dynamic data, {bool allowNull = true}) {
    if (data != null) {
      switch (data) {
        case r'success': return AgentListAlbumsToolSuccessResponseStatusEnum.success;
        default:
          if (!allowNull) {
            throw ArgumentError('Unknown enum value to decode: $data');
          }
      }
    }
    return null;
  }

  /// Singleton [AgentListAlbumsToolSuccessResponseStatusEnumTypeTransformer] instance.
  static AgentListAlbumsToolSuccessResponseStatusEnumTypeTransformer? _instance;
}


