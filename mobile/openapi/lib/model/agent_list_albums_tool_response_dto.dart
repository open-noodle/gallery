//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

class AgentListAlbumsToolResponseDto {
  /// Returns a new [AgentListAlbumsToolResponseDto] instance.
  AgentListAlbumsToolResponseDto({
    required this.status,
    required this.toolCall,
    this.reason,
    this.albums = const [],
  });

  AgentListAlbumsToolResponseDtoStatusEnum status;

  AgentToolCallResponseDto toolCall;

  String? reason;

  List<AgentAlbumSummary> albums;

  @override
  bool operator ==(Object other) => identical(this, other) || other is AgentListAlbumsToolResponseDto &&
    other.status == status &&
    other.toolCall == toolCall &&
    other.reason == reason &&
    _deepEquality.equals(other.albums, albums);

  @override
  int get hashCode =>
    // ignore: unnecessary_parenthesis
    (status.hashCode) +
    (toolCall.hashCode) +
    (reason == null ? 0 : reason!.hashCode) +
    (albums.hashCode);

  @override
  String toString() => 'AgentListAlbumsToolResponseDto[status=$status, toolCall=$toolCall, reason=$reason, albums=$albums]';

  Map<String, dynamic> toJson() {
    final json = <String, dynamic>{};
      json[r'status'] = this.status;
      json[r'toolCall'] = this.toolCall;
    if (this.reason != null) {
      json[r'reason'] = this.reason;
    }
      json[r'albums'] = this.albums;
    return json;
  }

  /// Returns a new [AgentListAlbumsToolResponseDto] instance and imports its values from
  /// [value] if it's a [Map], null otherwise.
  // ignore: prefer_constructors_over_static_methods
  static AgentListAlbumsToolResponseDto? fromJson(dynamic value) {
    upgradeDto(value, "AgentListAlbumsToolResponseDto");
    if (value is Map) {
      final json = value.cast<String, dynamic>();

      return AgentListAlbumsToolResponseDto(
        status: AgentListAlbumsToolResponseDtoStatusEnum.fromJson(json[r'status'])!,
        toolCall: AgentToolCallResponseDto.fromJson(json[r'toolCall'])!,
        reason: mapValueOfType<String>(json, r'reason'),
        albums: AgentAlbumSummary.listFromJson(json[r'albums']),
      );
    }
    return null;
  }

  static List<AgentListAlbumsToolResponseDto> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <AgentListAlbumsToolResponseDto>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = AgentListAlbumsToolResponseDto.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }

  static Map<String, AgentListAlbumsToolResponseDto> mapFromJson(dynamic json) {
    final map = <String, AgentListAlbumsToolResponseDto>{};
    if (json is Map && json.isNotEmpty) {
      json = json.cast<String, dynamic>(); // ignore: parameter_assignments
      for (final entry in json.entries) {
        final value = AgentListAlbumsToolResponseDto.fromJson(entry.value);
        if (value != null) {
          map[entry.key] = value;
        }
      }
    }
    return map;
  }

  // maps a json object with a list of AgentListAlbumsToolResponseDto-objects as value to a dart map
  static Map<String, List<AgentListAlbumsToolResponseDto>> mapListFromJson(dynamic json, {bool growable = false,}) {
    final map = <String, List<AgentListAlbumsToolResponseDto>>{};
    if (json is Map && json.isNotEmpty) {
      // ignore: parameter_assignments
      json = json.cast<String, dynamic>();
      for (final entry in json.entries) {
        map[entry.key] = AgentListAlbumsToolResponseDto.listFromJson(entry.value, growable: growable,);
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


class AgentListAlbumsToolResponseDtoStatusEnum {
  /// Instantiate a new enum with the provided [value].
  const AgentListAlbumsToolResponseDtoStatusEnum._(this.value);

  /// The underlying value of this enum member.
  final String value;

  @override
  String toString() => value;

  String toJson() => value;

  static const approvalRequired = AgentListAlbumsToolResponseDtoStatusEnum._(r'approval-required');
  static const denied = AgentListAlbumsToolResponseDtoStatusEnum._(r'denied');
  static const success = AgentListAlbumsToolResponseDtoStatusEnum._(r'success');

  /// List of all possible values in this [enum][AgentListAlbumsToolResponseDtoStatusEnum].
  static const values = <AgentListAlbumsToolResponseDtoStatusEnum>[
    approvalRequired,
    denied,
    success,
  ];

  static AgentListAlbumsToolResponseDtoStatusEnum? fromJson(dynamic value) => AgentListAlbumsToolResponseDtoStatusEnumTypeTransformer().decode(value);

  static List<AgentListAlbumsToolResponseDtoStatusEnum> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <AgentListAlbumsToolResponseDtoStatusEnum>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = AgentListAlbumsToolResponseDtoStatusEnum.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }
}

/// Transformation class that can [encode] an instance of [AgentListAlbumsToolResponseDtoStatusEnum] to String,
/// and [decode] dynamic data back to [AgentListAlbumsToolResponseDtoStatusEnum].
class AgentListAlbumsToolResponseDtoStatusEnumTypeTransformer {
  factory AgentListAlbumsToolResponseDtoStatusEnumTypeTransformer() => _instance ??= const AgentListAlbumsToolResponseDtoStatusEnumTypeTransformer._();

  const AgentListAlbumsToolResponseDtoStatusEnumTypeTransformer._();

  String encode(AgentListAlbumsToolResponseDtoStatusEnum data) => data.value;

  /// Decodes a [dynamic value][data] to a AgentListAlbumsToolResponseDtoStatusEnum.
  ///
  /// If [allowNull] is true and the [dynamic value][data] cannot be decoded successfully,
  /// then null is returned. However, if [allowNull] is false and the [dynamic value][data]
  /// cannot be decoded successfully, then an [UnimplementedError] is thrown.
  ///
  /// The [allowNull] is very handy when an API changes and a new enum value is added or removed,
  /// and users are still using an old app with the old code.
  AgentListAlbumsToolResponseDtoStatusEnum? decode(dynamic data, {bool allowNull = true}) {
    if (data != null) {
      switch (data) {
        case r'approval-required': return AgentListAlbumsToolResponseDtoStatusEnum.approvalRequired;
        case r'denied': return AgentListAlbumsToolResponseDtoStatusEnum.denied;
        case r'success': return AgentListAlbumsToolResponseDtoStatusEnum.success;
        default:
          if (!allowNull) {
            throw ArgumentError('Unknown enum value to decode: $data');
          }
      }
    }
    return null;
  }

  /// Singleton [AgentListAlbumsToolResponseDtoStatusEnumTypeTransformer] instance.
  static AgentListAlbumsToolResponseDtoStatusEnumTypeTransformer? _instance;
}

