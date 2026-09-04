//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

class GameChallengeListItemResponseDto {
  /// Returns a new [GameChallengeListItemResponseDto] instance.
  GameChallengeListItemResponseDto({
    required this.answered,
    required this.closedAt,
    required this.createdAt,
    required this.dailyOn,
    required this.id,
    required this.locationRoundCount,
    required this.name,
    required this.ownerId,
    required this.roundCount,
    required this.scaleDays,
    required this.scaleKm,
    required this.spaceId,
    required this.total,
  });

  /// Number of rounds the caller has answered
  num answered;

  /// When this challenge was closed, if at all
  DateTime? closedAt;

  /// Creation date
  DateTime createdAt;

  /// The UTC date this is the space's daily challenge for, or null for a player-created one
  DateTime? dailyOn;

  /// Challenge ID
  String id;

  /// How many of the rounds are location rounds
  num locationRoundCount;

  /// Challenge name
  String name;

  /// Owning user ID, or null for a shared-space challenge
  String? ownerId;

  /// Number of rounds actually generated (may be less than requested)
  num roundCount;

  /// Frozen day scale used to score date rounds
  num scaleDays;

  /// Frozen distance scale used to score location rounds
  num scaleKm;

  /// Shared space ID, or null for a solo challenge
  String? spaceId;

  /// The caller's total score across answered rounds
  num total;

  @override
  bool operator ==(Object other) => identical(this, other) || other is GameChallengeListItemResponseDto &&
    other.answered == answered &&
    other.closedAt == closedAt &&
    other.createdAt == createdAt &&
    other.dailyOn == dailyOn &&
    other.id == id &&
    other.locationRoundCount == locationRoundCount &&
    other.name == name &&
    other.ownerId == ownerId &&
    other.roundCount == roundCount &&
    other.scaleDays == scaleDays &&
    other.scaleKm == scaleKm &&
    other.spaceId == spaceId &&
    other.total == total;

  @override
  int get hashCode =>
    // ignore: unnecessary_parenthesis
    (answered.hashCode) +
    (closedAt == null ? 0 : closedAt!.hashCode) +
    (createdAt.hashCode) +
    (dailyOn == null ? 0 : dailyOn!.hashCode) +
    (id.hashCode) +
    (locationRoundCount.hashCode) +
    (name.hashCode) +
    (ownerId == null ? 0 : ownerId!.hashCode) +
    (roundCount.hashCode) +
    (scaleDays.hashCode) +
    (scaleKm.hashCode) +
    (spaceId == null ? 0 : spaceId!.hashCode) +
    (total.hashCode);

  @override
  String toString() => 'GameChallengeListItemResponseDto[answered=$answered, closedAt=$closedAt, createdAt=$createdAt, dailyOn=$dailyOn, id=$id, locationRoundCount=$locationRoundCount, name=$name, ownerId=$ownerId, roundCount=$roundCount, scaleDays=$scaleDays, scaleKm=$scaleKm, spaceId=$spaceId, total=$total]';

  Map<String, dynamic> toJson() {
    final json = <String, dynamic>{};
      json[r'answered'] = this.answered;
    if (this.closedAt != null) {
      json[r'closedAt'] = _isEpochMarker(r'/^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))T(?:(?:[01]\\d|2[0-3]):[0-5]\\d(?::[0-5]\\d(?:\\.\\d+)?)?(?:Z|([+-](?:[01]\\d|2[0-3]):[0-5]\\d)))$/')
        ? this.closedAt!.millisecondsSinceEpoch
        : this.closedAt!.toUtc().toIso8601String();
    } else {
      json[r'closedAt'] = null;
    }
      json[r'createdAt'] = _isEpochMarker(r'/^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))T(?:(?:[01]\\d|2[0-3]):[0-5]\\d(?::[0-5]\\d(?:\\.\\d+)?)?(?:Z|([+-](?:[01]\\d|2[0-3]):[0-5]\\d)))$/')
        ? this.createdAt.millisecondsSinceEpoch
        : this.createdAt.toUtc().toIso8601String();
    if (this.dailyOn != null) {
      json[r'dailyOn'] = _dateFormatter.format(this.dailyOn!);
    } else {
      json[r'dailyOn'] = null;
    }
      json[r'id'] = this.id;
      json[r'locationRoundCount'] = this.locationRoundCount;
      json[r'name'] = this.name;
    if (this.ownerId != null) {
      json[r'ownerId'] = this.ownerId;
    } else {
      json[r'ownerId'] = null;
    }
      json[r'roundCount'] = this.roundCount;
      json[r'scaleDays'] = this.scaleDays;
      json[r'scaleKm'] = this.scaleKm;
    if (this.spaceId != null) {
      json[r'spaceId'] = this.spaceId;
    } else {
      json[r'spaceId'] = null;
    }
      json[r'total'] = this.total;
    return json;
  }

  /// Returns a new [GameChallengeListItemResponseDto] instance and imports its values from
  /// [value] if it's a [Map], null otherwise.
  // ignore: prefer_constructors_over_static_methods
  static GameChallengeListItemResponseDto? fromJson(dynamic value) {
    upgradeDto(value, "GameChallengeListItemResponseDto");
    if (value is Map) {
      final json = value.cast<String, dynamic>();

      return GameChallengeListItemResponseDto(
        answered: num.parse('${json[r'answered']}'),
        closedAt: mapDateTime(json, r'closedAt', r'/^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))T(?:(?:[01]\\d|2[0-3]):[0-5]\\d(?::[0-5]\\d(?:\\.\\d+)?)?(?:Z|([+-](?:[01]\\d|2[0-3]):[0-5]\\d)))$/'),
        createdAt: mapDateTime(json, r'createdAt', r'/^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))T(?:(?:[01]\\d|2[0-3]):[0-5]\\d(?::[0-5]\\d(?:\\.\\d+)?)?(?:Z|([+-](?:[01]\\d|2[0-3]):[0-5]\\d)))$/')!,
        dailyOn: mapDateTime(json, r'dailyOn', r''),
        id: mapValueOfType<String>(json, r'id')!,
        locationRoundCount: num.parse('${json[r'locationRoundCount']}'),
        name: mapValueOfType<String>(json, r'name')!,
        ownerId: mapValueOfType<String>(json, r'ownerId'),
        roundCount: num.parse('${json[r'roundCount']}'),
        scaleDays: num.parse('${json[r'scaleDays']}'),
        scaleKm: num.parse('${json[r'scaleKm']}'),
        spaceId: mapValueOfType<String>(json, r'spaceId'),
        total: num.parse('${json[r'total']}'),
      );
    }
    return null;
  }

  static List<GameChallengeListItemResponseDto> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <GameChallengeListItemResponseDto>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = GameChallengeListItemResponseDto.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }

  static Map<String, GameChallengeListItemResponseDto> mapFromJson(dynamic json) {
    final map = <String, GameChallengeListItemResponseDto>{};
    if (json is Map && json.isNotEmpty) {
      json = json.cast<String, dynamic>(); // ignore: parameter_assignments
      for (final entry in json.entries) {
        final value = GameChallengeListItemResponseDto.fromJson(entry.value);
        if (value != null) {
          map[entry.key] = value;
        }
      }
    }
    return map;
  }

  // maps a json object with a list of GameChallengeListItemResponseDto-objects as value to a dart map
  static Map<String, List<GameChallengeListItemResponseDto>> mapListFromJson(dynamic json, {bool growable = false,}) {
    final map = <String, List<GameChallengeListItemResponseDto>>{};
    if (json is Map && json.isNotEmpty) {
      // ignore: parameter_assignments
      json = json.cast<String, dynamic>();
      for (final entry in json.entries) {
        map[entry.key] = GameChallengeListItemResponseDto.listFromJson(entry.value, growable: growable,);
      }
    }
    return map;
  }

  /// The list of required keys that must be present in a JSON.
  static const requiredKeys = <String>{
    'answered',
    'closedAt',
    'createdAt',
    'dailyOn',
    'id',
    'locationRoundCount',
    'name',
    'ownerId',
    'roundCount',
    'scaleDays',
    'scaleKm',
    'spaceId',
    'total',
  };
}

