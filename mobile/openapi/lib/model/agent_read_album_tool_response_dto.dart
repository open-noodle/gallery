//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

class AgentReadAlbumToolResponseDto {
  /// Returns a new [AgentReadAlbumToolResponseDto] instance.
  AgentReadAlbumToolResponseDto({
    required this.status,
    required this.toolCall,
    this.reason,
    this.album,
  });

  AgentReadAlbumToolResponseDtoStatusEnum status;

  AgentToolCallResponseDto toolCall;

  String? reason;

  AgentAlbumDetail? album;

  @override
  bool operator ==(Object other) => identical(this, other) || other is AgentReadAlbumToolResponseDto &&
    other.status == status &&
    other.toolCall == toolCall &&
    other.reason == reason &&
    other.album == album;

  @override
  int get hashCode =>
    // ignore: unnecessary_parenthesis
    (status.hashCode) +
    (toolCall.hashCode) +
    (reason == null ? 0 : reason!.hashCode) +
    (album == null ? 0 : album!.hashCode);

  @override
  String toString() => 'AgentReadAlbumToolResponseDto[status=$status, toolCall=$toolCall, reason=$reason, album=$album]';

  Map<String, dynamic> toJson() {
    final json = <String, dynamic>{};
      json[r'status'] = this.status;
      json[r'toolCall'] = this.toolCall;
    if (this.reason != null) {
      json[r'reason'] = this.reason;
    }
    if (this.album != null) {
      json[r'album'] = this.album;
    }
    return json;
  }

  /// Returns a new [AgentReadAlbumToolResponseDto] instance and imports its values from
  /// [value] if it's a [Map], null otherwise.
  // ignore: prefer_constructors_over_static_methods
  static AgentReadAlbumToolResponseDto? fromJson(dynamic value) {
    upgradeDto(value, "AgentReadAlbumToolResponseDto");
    if (value is Map) {
      final json = value.cast<String, dynamic>();

      return AgentReadAlbumToolResponseDto(
        status: AgentReadAlbumToolResponseDtoStatusEnum.fromJson(json[r'status'])!,
        toolCall: AgentToolCallResponseDto.fromJson(json[r'toolCall'])!,
        reason: mapValueOfType<String>(json, r'reason'),
        album: AgentAlbumDetail.fromJson(json[r'album']),
      );
    }
    return null;
  }

  static List<AgentReadAlbumToolResponseDto> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <AgentReadAlbumToolResponseDto>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = AgentReadAlbumToolResponseDto.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }

  static Map<String, AgentReadAlbumToolResponseDto> mapFromJson(dynamic json) {
    final map = <String, AgentReadAlbumToolResponseDto>{};
    if (json is Map && json.isNotEmpty) {
      json = json.cast<String, dynamic>(); // ignore: parameter_assignments
      for (final entry in json.entries) {
        final value = AgentReadAlbumToolResponseDto.fromJson(entry.value);
        if (value != null) {
          map[entry.key] = value;
        }
      }
    }
    return map;
  }

  // maps a json object with a list of AgentReadAlbumToolResponseDto-objects as value to a dart map
  static Map<String, List<AgentReadAlbumToolResponseDto>> mapListFromJson(dynamic json, {bool growable = false,}) {
    final map = <String, List<AgentReadAlbumToolResponseDto>>{};
    if (json is Map && json.isNotEmpty) {
      // ignore: parameter_assignments
      json = json.cast<String, dynamic>();
      for (final entry in json.entries) {
        map[entry.key] = AgentReadAlbumToolResponseDto.listFromJson(entry.value, growable: growable,);
      }
    }
    return map;
  }

  /// The list of required keys that must be present in a JSON.
  static const requiredKeys = <String>{
    'status',
    'toolCall',
  };
}


class AgentReadAlbumToolResponseDtoStatusEnum {
  /// Instantiate a new enum with the provided [value].
  const AgentReadAlbumToolResponseDtoStatusEnum._(this.value);

  /// The underlying value of this enum member.
  final String value;

  @override
  String toString() => value;

  String toJson() => value;

  static const approvalRequired = AgentReadAlbumToolResponseDtoStatusEnum._(r'approval-required');
  static const denied = AgentReadAlbumToolResponseDtoStatusEnum._(r'denied');
  static const success = AgentReadAlbumToolResponseDtoStatusEnum._(r'success');

  /// List of all possible values in this [enum][AgentReadAlbumToolResponseDtoStatusEnum].
  static const values = <AgentReadAlbumToolResponseDtoStatusEnum>[
    approvalRequired,
    denied,
    success,
  ];

  static AgentReadAlbumToolResponseDtoStatusEnum? fromJson(dynamic value) => AgentReadAlbumToolResponseDtoStatusEnumTypeTransformer().decode(value);

  static List<AgentReadAlbumToolResponseDtoStatusEnum> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <AgentReadAlbumToolResponseDtoStatusEnum>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = AgentReadAlbumToolResponseDtoStatusEnum.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }
}

/// Transformation class that can [encode] an instance of [AgentReadAlbumToolResponseDtoStatusEnum] to String,
/// and [decode] dynamic data back to [AgentReadAlbumToolResponseDtoStatusEnum].
class AgentReadAlbumToolResponseDtoStatusEnumTypeTransformer {
  factory AgentReadAlbumToolResponseDtoStatusEnumTypeTransformer() => _instance ??= const AgentReadAlbumToolResponseDtoStatusEnumTypeTransformer._();

  const AgentReadAlbumToolResponseDtoStatusEnumTypeTransformer._();

  String encode(AgentReadAlbumToolResponseDtoStatusEnum data) => data.value;

  /// Decodes a [dynamic value][data] to a AgentReadAlbumToolResponseDtoStatusEnum.
  ///
  /// If [allowNull] is true and the [dynamic value][data] cannot be decoded successfully,
  /// then null is returned. However, if [allowNull] is false and the [dynamic value][data]
  /// cannot be decoded successfully, then an [UnimplementedError] is thrown.
  ///
  /// The [allowNull] is very handy when an API changes and a new enum value is added or removed,
  /// and users are still using an old app with the old code.
  AgentReadAlbumToolResponseDtoStatusEnum? decode(dynamic data, {bool allowNull = true}) {
    if (data != null) {
      switch (data) {
        case r'approval-required': return AgentReadAlbumToolResponseDtoStatusEnum.approvalRequired;
        case r'denied': return AgentReadAlbumToolResponseDtoStatusEnum.denied;
        case r'success': return AgentReadAlbumToolResponseDtoStatusEnum.success;
        default:
          if (!allowNull) {
            throw ArgumentError('Unknown enum value to decode: $data');
          }
      }
    }
    return null;
  }

  /// Singleton [AgentReadAlbumToolResponseDtoStatusEnumTypeTransformer] instance.
  static AgentReadAlbumToolResponseDtoStatusEnumTypeTransformer? _instance;
}

