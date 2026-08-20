class GamesConfig {
  final bool dailyReminderEnabled;

  /// Minutes since local midnight. 18:00 — not UTC midnight, which is 1-2 am across Europe.
  final int dailyReminderMinuteOfDay;

  /// The UTC `YYYY-MM-DD` of the last SPACE daily challenge finished on this device, or null.
  ///
  /// One date, not a per-space map: the rule is "you have already played today's space daily", so
  /// a single day is all it needs. A per-space map would require reading every opted-in space's
  /// daily to evaluate — and that read GENERATES the daily server-side.
  ///
  /// Tracked separately from [soloDailyLastPlayed]: the two are independent streaks computed
  /// server-side, so finishing one must never be read as satisfying the other. See
  /// `dailyReminderOccurrences`'s doc for what a single shared date used to cost the player.
  final String? spaceDailyLastPlayed;

  /// The UTC `YYYY-MM-DD` of the last SOLO (personal) daily challenge finished on this device, or
  /// null. The solo counterpart to [spaceDailyLastPlayed] — see its doc for why the two stay apart.
  final String? soloDailyLastPlayed;

  const GamesConfig({
    this.dailyReminderEnabled = false,
    this.dailyReminderMinuteOfDay = 18 * 60,
    this.spaceDailyLastPlayed,
    this.soloDailyLastPlayed,
  });

  GamesConfig copyWith({
    bool? dailyReminderEnabled,
    int? dailyReminderMinuteOfDay,
    String? spaceDailyLastPlayed,
    String? soloDailyLastPlayed,
  }) => GamesConfig(
    dailyReminderEnabled: dailyReminderEnabled ?? this.dailyReminderEnabled,
    dailyReminderMinuteOfDay: dailyReminderMinuteOfDay ?? this.dailyReminderMinuteOfDay,
    spaceDailyLastPlayed: spaceDailyLastPlayed ?? this.spaceDailyLastPlayed,
    soloDailyLastPlayed: soloDailyLastPlayed ?? this.soloDailyLastPlayed,
  );

  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      (other is GamesConfig &&
          other.dailyReminderEnabled == dailyReminderEnabled &&
          other.dailyReminderMinuteOfDay == dailyReminderMinuteOfDay &&
          other.spaceDailyLastPlayed == spaceDailyLastPlayed &&
          other.soloDailyLastPlayed == soloDailyLastPlayed);

  @override
  int get hashCode =>
      Object.hash(dailyReminderEnabled, dailyReminderMinuteOfDay, spaceDailyLastPlayed, soloDailyLastPlayed);

  @override
  String toString() =>
      'GamesConfig(dailyReminderEnabled: $dailyReminderEnabled, '
      'dailyReminderMinuteOfDay: $dailyReminderMinuteOfDay, spaceDailyLastPlayed: $spaceDailyLastPlayed, '
      'soloDailyLastPlayed: $soloDailyLastPlayed)';
}
