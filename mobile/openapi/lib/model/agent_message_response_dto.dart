//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

class AgentMessageResponseDto {
  /// Returns a new [AgentMessageResponseDto] instance.
  AgentMessageResponseDto({
    required this.content,
    required this.createdAt,
    required this.id,
    required this.providerMessageId,
    required this.role,
    required this.sessionId,
    required this.toolCallId,
  });

  AgentMessageContent content;

  DateTime createdAt;

  String id;

  String? providerMessageId;

  AgentMessageRole role;

  String sessionId;

  String? toolCallId;

  @override
  bool operator ==(Object other) => identical(this, other) || other is AgentMessageResponseDto &&
    other.content == content &&
    other.createdAt == createdAt &&
    other.id == id &&
    other.providerMessageId == providerMessageId &&
    other.role == role &&
    other.sessionId == sessionId &&
    other.toolCallId == toolCallId;

  @override
  int get hashCode =>
    // ignore: unnecessary_parenthesis
    (content.hashCode) +
    (createdAt.hashCode) +
    (id.hashCode) +
    (providerMessageId == null ? 0 : providerMessageId!.hashCode) +
    (role.hashCode) +
    (sessionId.hashCode) +
    (toolCallId == null ? 0 : toolCallId!.hashCode);

  @override
  String toString() => 'AgentMessageResponseDto[content=$content, createdAt=$createdAt, id=$id, providerMessageId=$providerMessageId, role=$role, sessionId=$sessionId, toolCallId=$toolCallId]';

  Map<String, dynamic> toJson() {
    final json = <String, dynamic>{};
      json[r'content'] = this.content;
      json[r'createdAt'] = _isEpochMarker(r'/^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))T(?:(?:[01]\\d|2[0-3]):[0-5]\\d(?::[0-5]\\d(?:\\.\\d+)?)?(?:Z|([+-](?:[01]\\d|2[0-3]):[0-5]\\d)))$/')
        ? this.createdAt.millisecondsSinceEpoch
        : this.createdAt.toUtc().toIso8601String();
      json[r'id'] = this.id;
    if (this.providerMessageId != null) {
      json[r'providerMessageId'] = this.providerMessageId;
    } else {
      json[r'providerMessageId'] = null;
    }
      json[r'role'] = this.role;
      json[r'sessionId'] = this.sessionId;
    if (this.toolCallId != null) {
      json[r'toolCallId'] = this.toolCallId;
    } else {
      json[r'toolCallId'] = null;
    }
    return json;
  }

  /// Returns a new [AgentMessageResponseDto] instance and imports its values from
  /// [value] if it's a [Map], null otherwise.
  // ignore: prefer_constructors_over_static_methods
  static AgentMessageResponseDto? fromJson(dynamic value) {
    upgradeDto(value, "AgentMessageResponseDto");
    if (value is Map) {
      final json = value.cast<String, dynamic>();

      return AgentMessageResponseDto(
        content: AgentMessageContent.fromJson(json[r'content'])!,
        createdAt: mapDateTime(json, r'createdAt', r'/^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))T(?:(?:[01]\\d|2[0-3]):[0-5]\\d(?::[0-5]\\d(?:\\.\\d+)?)?(?:Z|([+-](?:[01]\\d|2[0-3]):[0-5]\\d)))$/')!,
        id: mapValueOfType<String>(json, r'id')!,
        providerMessageId: mapValueOfType<String>(json, r'providerMessageId'),
        role: AgentMessageRole.fromJson(json[r'role'])!,
        sessionId: mapValueOfType<String>(json, r'sessionId')!,
        toolCallId: mapValueOfType<String>(json, r'toolCallId'),
      );
    }
    return null;
  }

  static List<AgentMessageResponseDto> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <AgentMessageResponseDto>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = AgentMessageResponseDto.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }

  static Map<String, AgentMessageResponseDto> mapFromJson(dynamic json) {
    final map = <String, AgentMessageResponseDto>{};
    if (json is Map && json.isNotEmpty) {
      json = json.cast<String, dynamic>(); // ignore: parameter_assignments
      for (final entry in json.entries) {
        final value = AgentMessageResponseDto.fromJson(entry.value);
        if (value != null) {
          map[entry.key] = value;
        }
      }
    }
    return map;
  }

  // maps a json object with a list of AgentMessageResponseDto-objects as value to a dart map
  static Map<String, List<AgentMessageResponseDto>> mapListFromJson(dynamic json, {bool growable = false,}) {
    final map = <String, List<AgentMessageResponseDto>>{};
    if (json is Map && json.isNotEmpty) {
      // ignore: parameter_assignments
      json = json.cast<String, dynamic>();
      for (final entry in json.entries) {
        map[entry.key] = AgentMessageResponseDto.listFromJson(entry.value, growable: growable,);
      }
    }
    return map;
  }

  /// The list of required keys that must be present in a JSON.
  static const requiredKeys = <String>{
    'content',
    'createdAt',
    'id',
    'providerMessageId',
    'role',
    'sessionId',
    'toolCallId',
  };
}

