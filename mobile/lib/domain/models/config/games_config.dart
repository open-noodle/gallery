class GamesConfig {
  final bool dailyReminderEnabled;

  /// Minutes since local midnight. 18:00 — not UTC midnight, which is 1-2 am across Europe.
  final int dailyReminderMinuteOfDay;

  /// The UTC `YYYY-MM-DD` of the last DAILY challenge finished on this device, or null.
  ///
  /// One date, not a per-space map: the rule is "you have already played today", so a single day is
  /// all it needs. A per-space map would require reading every opted-in space's daily to evaluate —
  /// and that read GENERATES the daily server-side.
  final String? dailyLastPlayed;

  const GamesConfig({this.dailyReminderEnabled = false, this.dailyReminderMinuteOfDay = 18 * 60, this.dailyLastPlayed});

  GamesConfig copyWith({bool? dailyReminderEnabled, int? dailyReminderMinuteOfDay, String? dailyLastPlayed}) =>
      GamesConfig(
        dailyReminderEnabled: dailyReminderEnabled ?? this.dailyReminderEnabled,
        dailyReminderMinuteOfDay: dailyReminderMinuteOfDay ?? this.dailyReminderMinuteOfDay,
        dailyLastPlayed: dailyLastPlayed ?? this.dailyLastPlayed,
      );

  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      (other is GamesConfig &&
          other.dailyReminderEnabled == dailyReminderEnabled &&
          other.dailyReminderMinuteOfDay == dailyReminderMinuteOfDay &&
          other.dailyLastPlayed == dailyLastPlayed);

  @override
  int get hashCode => Object.hash(dailyReminderEnabled, dailyReminderMinuteOfDay, dailyLastPlayed);

  @override
  String toString() =>
      'GamesConfig(dailyReminderEnabled: $dailyReminderEnabled, '
      'dailyReminderMinuteOfDay: $dailyReminderMinuteOfDay, dailyLastPlayed: $dailyLastPlayed)';
}
