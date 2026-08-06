//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

class AgentReadAlbumToolSuccessResponse {
  /// Returns a new [AgentReadAlbumToolSuccessResponse] instance.
  AgentReadAlbumToolSuccessResponse({
    required this.album,
    required this.resultSize,
    required this.status,
    required this.toolCall,
  });

  AgentAlbumDetail album;

  AgentToolResultSize resultSize;

  AgentReadAlbumToolSuccessResponseStatusEnum status;

  AgentToolCallResponseDto toolCall;

  @override
  bool operator ==(Object other) => identical(this, other) || other is AgentReadAlbumToolSuccessResponse &&
    other.album == album &&
    other.resultSize == resultSize &&
    other.status == status &&
    other.toolCall == toolCall;

  @override
  int get hashCode =>
    // ignore: unnecessary_parenthesis
    (album.hashCode) +
    (resultSize.hashCode) +
    (status.hashCode) +
    (toolCall.hashCode);

  @override
  String toString() => 'AgentReadAlbumToolSuccessResponse[album=$album, resultSize=$resultSize, status=$status, toolCall=$toolCall]';

  Map<String, dynamic> toJson() {
    final json = <String, dynamic>{};
      json[r'album'] = this.album;
      json[r'resultSize'] = this.resultSize;
      json[r'status'] = this.status;
      json[r'toolCall'] = this.toolCall;
    return json;
  }

  /// Returns a new [AgentReadAlbumToolSuccessResponse] instance and imports its values from
  /// [value] if it's a [Map], null otherwise.
  // ignore: prefer_constructors_over_static_methods
  static AgentReadAlbumToolSuccessResponse? fromJson(dynamic value) {
    upgradeDto(value, "AgentReadAlbumToolSuccessResponse");
    if (value is Map) {
      final json = value.cast<String, dynamic>();

      return AgentReadAlbumToolSuccessResponse(
        album: AgentAlbumDetail.fromJson(json[r'album'])!,
        resultSize: AgentToolResultSize.fromJson(json[r'resultSize'])!,
        status: AgentReadAlbumToolSuccessResponseStatusEnum.fromJson(json[r'status'])!,
        toolCall: AgentToolCallResponseDto.fromJson(json[r'toolCall'])!,
      );
    }
    return null;
  }

  static List<AgentReadAlbumToolSuccessResponse> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <AgentReadAlbumToolSuccessResponse>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = AgentReadAlbumToolSuccessResponse.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }

  static Map<String, AgentReadAlbumToolSuccessResponse> mapFromJson(dynamic json) {
    final map = <String, AgentReadAlbumToolSuccessResponse>{};
    if (json is Map && json.isNotEmpty) {
      json = json.cast<String, dynamic>(); // ignore: parameter_assignments
      for (final entry in json.entries) {
        final value = AgentReadAlbumToolSuccessResponse.fromJson(entry.value);
        if (value != null) {
          map[entry.key] = value;
        }
      }
    }
    return map;
  }

  // maps a json object with a list of AgentReadAlbumToolSuccessResponse-objects as value to a dart map
  static Map<String, List<AgentReadAlbumToolSuccessResponse>> mapListFromJson(dynamic json, {bool growable = false,}) {
    final map = <String, List<AgentReadAlbumToolSuccessResponse>>{};
    if (json is Map && json.isNotEmpty) {
      // ignore: parameter_assignments
      json = json.cast<String, dynamic>();
      for (final entry in json.entries) {
        map[entry.key] = AgentReadAlbumToolSuccessResponse.listFromJson(entry.value, growable: growable,);
      }
    }
    return map;
  }

  /// The list of required keys that must be present in a JSON.
  static const requiredKeys = <String>{
    'album',
    'resultSize',
    'status',
    'toolCall',
  };
}


class AgentReadAlbumToolSuccessResponseStatusEnum {
  /// Instantiate a new enum with the provided [value].
  const AgentReadAlbumToolSuccessResponseStatusEnum._(this.value);

  /// The underlying value of this enum member.
  final String value;

  @override
  String toString() => value;

  String toJson() => value;

  static const success = AgentReadAlbumToolSuccessResponseStatusEnum._(r'success');

  /// List of all possible values in this [enum][AgentReadAlbumToolSuccessResponseStatusEnum].
  static const values = <AgentReadAlbumToolSuccessResponseStatusEnum>[
    success,
  ];

  static AgentReadAlbumToolSuccessResponseStatusEnum? fromJson(dynamic value) => AgentReadAlbumToolSuccessResponseStatusEnumTypeTransformer().decode(value);

  static List<AgentReadAlbumToolSuccessResponseStatusEnum> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <AgentReadAlbumToolSuccessResponseStatusEnum>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = AgentReadAlbumToolSuccessResponseStatusEnum.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }
}

/// Transformation class that can [encode] an instance of [AgentReadAlbumToolSuccessResponseStatusEnum] to String,
/// and [decode] dynamic data back to [AgentReadAlbumToolSuccessResponseStatusEnum].
class AgentReadAlbumToolSuccessResponseStatusEnumTypeTransformer {
  factory AgentReadAlbumToolSuccessResponseStatusEnumTypeTransformer() => _instance ??= const AgentReadAlbumToolSuccessResponseStatusEnumTypeTransformer._();

  const AgentReadAlbumToolSuccessResponseStatusEnumTypeTransformer._();

  String encode(AgentReadAlbumToolSuccessResponseStatusEnum data) => data.value;

  /// Decodes a [dynamic value][data] to a AgentReadAlbumToolSuccessResponseStatusEnum.
  ///
  /// If [allowNull] is true and the [dynamic value][data] cannot be decoded successfully,
  /// then null is returned. However, if [allowNull] is false and the [dynamic value][data]
  /// cannot be decoded successfully, then an [UnimplementedError] is thrown.
  ///
  /// The [allowNull] is very handy when an API changes and a new enum value is added or removed,
  /// and users are still using an old app with the old code.
  AgentReadAlbumToolSuccessResponseStatusEnum? decode(dynamic data, {bool allowNull = true}) {
    if (data != null) {
      switch (data) {
        case r'success': return AgentReadAlbumToolSuccessResponseStatusEnum.success;
        default:
          if (!allowNull) {
            throw ArgumentError('Unknown enum value to decode: $data');
          }
      }
    }
    return null;
  }

  /// Singleton [AgentReadAlbumToolSuccessResponseStatusEnumTypeTransformer] instance.
  static AgentReadAlbumToolSuccessResponseStatusEnumTypeTransformer? _instance;
}


