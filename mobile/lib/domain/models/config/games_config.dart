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

  /// The UTC `YYYY-MM-DD` the solo daily was last CONFIRMED unavailable — the player's library
  /// could not fill one that day — or null.
  ///
  /// Without this, [soloDailyLastPlayed] can never equal that day's key either (nothing to have
  /// played), so the reminder would treat the day as permanently unplayed and keep reminding about
  /// a daily that does not exist. Day-keyed rather than a standing "solo is off" flag so a library
  /// that fills again tomorrow is not locked out by yesterday's finding — see
  /// `dailyReminderOccurrences`'s doc for how this is folded into the skip.
  final String? soloDailyUnavailableOn;

  const GamesConfig({
    this.dailyReminderEnabled = false,
    this.dailyReminderMinuteOfDay = 18 * 60,
    this.spaceDailyLastPlayed,
    this.soloDailyLastPlayed,
    this.soloDailyUnavailableOn,
  });

  GamesConfig copyWith({
    bool? dailyReminderEnabled,
    int? dailyReminderMinuteOfDay,
    String? spaceDailyLastPlayed,
    String? soloDailyLastPlayed,
    String? soloDailyUnavailableOn,
  }) => GamesConfig(
    dailyReminderEnabled: dailyReminderEnabled ?? this.dailyReminderEnabled,
    dailyReminderMinuteOfDay: dailyReminderMinuteOfDay ?? this.dailyReminderMinuteOfDay,
    spaceDailyLastPlayed: spaceDailyLastPlayed ?? this.spaceDailyLastPlayed,
    soloDailyLastPlayed: soloDailyLastPlayed ?? this.soloDailyLastPlayed,
    soloDailyUnavailableOn: soloDailyUnavailableOn ?? this.soloDailyUnavailableOn,
  );

  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      (other is GamesConfig &&
          other.dailyReminderEnabled == dailyReminderEnabled &&
          other.dailyReminderMinuteOfDay == dailyReminderMinuteOfDay &&
          other.spaceDailyLastPlayed == spaceDailyLastPlayed &&
          other.soloDailyLastPlayed == soloDailyLastPlayed &&
          other.soloDailyUnavailableOn == soloDailyUnavailableOn);

  @override
  int get hashCode => Object.hash(
    dailyReminderEnabled,
    dailyReminderMinuteOfDay,
    spaceDailyLastPlayed,
    soloDailyLastPlayed,
    soloDailyUnavailableOn,
  );

  @override
  String toString() =>
      'GamesConfig(dailyReminderEnabled: $dailyReminderEnabled, '
      'dailyReminderMinuteOfDay: $dailyReminderMinuteOfDay, spaceDailyLastPlayed: $spaceDailyLastPlayed, '
      'soloDailyLastPlayed: $soloDailyLastPlayed, soloDailyUnavailableOn: $soloDailyUnavailableOn)';
}
