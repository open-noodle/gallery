import 'package:flutter/material.dart';
import 'package:immich_mobile/constants/colors.dart';
import 'package:immich_mobile/constants/enums.dart';
import 'package:immich_mobile/domain/models/log.model.dart';
import 'package:immich_mobile/domain/models/person.model.dart';
import 'package:immich_mobile/domain/models/timeline.model.dart';
import 'package:immich_mobile/domain/models/value_codec.dart';
import 'package:immich_mobile/pages/library/spaces/collection_sort.dart';
import 'package:immich_mobile/providers/album/album_sort_by_options.provider.dart';
import 'package:immich_mobile/utils/semver.dart';

enum SettingsKey<T> {
  // Theme
  themePrimaryColor<ImmichColorPreset>(codec: EnumCodec(ImmichColorPreset.values)),
  themeMode<ThemeMode>(codec: EnumCodec(ThemeMode.values)),
  themeDynamic<bool>(),
  themeColorfulInterface<bool>(),

  // Image
  imagePreferRemote<bool>(),
  imageLoadOriginal<bool>(),

  // Viewer
  viewerLoopVideo<bool>(),
  viewerLoadOriginalVideo<bool>(),
  viewerAutoPlayVideo<bool>(),
  viewerTapToNavigate<bool>(),

  // Network
  networkAutoEndpointSwitching<bool>(),
  networkExternalEndpointList<List<String>>(codec: ListCodec(PrimitiveCodec.string)),
  networkCustomHeaders<Map<String, String>>(codec: MapCodec(PrimitiveCodec.string, PrimitiveCodec.string)),
  networkPreferredWifiName<String?>(),
  networkLocalEndpoint<String?>(),

  // Album
  albumSortMode<AlbumSortMode>(codec: EnumCodec(AlbumSortMode.values)),
  albumIsReverse<bool>(),
  albumIsGrid<bool>(),

  // People
  peopleSortBy<PeopleSortBy>(codec: EnumCodec(PeopleSortBy.values)),

  // Spaces
  spaceAlbumsSortMode<SpaceAlbumSortMode>(
    codec: EnumCodec(SpaceAlbumSortMode.values, fallback: SpaceAlbumSortMode.recentlyLinked),
  ),
  spaceAlbumsIsReverse<bool>(),
  spacesSortMode<SpaceSortMode>(codec: EnumCodec(SpaceSortMode.values, fallback: SpaceSortMode.recentActivity)),
  spacesIsReverse<bool>(),

  // Games
  gameDailyReminderEnabled<bool>(),
  gameDailyReminderMinuteOfDay<int>(),
  // Split from a single gameDailyLastPlayed: a space daily and the solo daily are separate streaks
  // computed server-side, so finishing one must not be recorded as if it satisfied the other — see
  // dailyReminderOccurrences's doc for what that used to cost the player. The old key's value is
  // abandoned, not migrated, on upgrade: it is at most one day's worth of "already played" state,
  // so the worst case is a single redundant reminder before these two keys are written fresh.
  gameSpaceDailyLastPlayed<String?>(),
  gameSoloDailyLastPlayed<String?>(),
  // The UTC day the solo daily was last CONFIRMED unavailable (the player's library could not
  // fill one) — written from wherever the solo daily is actually fetched (see
  // DailyReminderController.recordSoloDailyUnavailable's doc), never read here directly. Day-
  // keyed, not a standing flag: a library that cannot fill a daily today may fill one tomorrow,
  // and comparing against a specific day is what makes this re-evaluate rather than latch.
  gameSoloDailyUnavailableOn<String?>(),

  // Backup
  backupEnabled<bool>(),
  backupUseCellularForVideos<bool>(),
  backupUseCellularForPhotos<bool>(),
  backupRequireCharging<bool>(),
  backupTriggerDelay<int>(),
  backupSyncAlbums<bool>(),

  // Timeline
  timelineTilesPerRow<int>(),
  timelineGroupAssetsBy<GroupAssetsBy>(codec: EnumCodec(GroupAssetsBy.values)),
  timelineStorageIndicator<bool>(),

  // Log
  logLevel<LogLevel>(codec: EnumCodec(LogLevel.values)),

  // Map
  mapShowFavoriteOnly<bool>(),
  mapRelativeDate<int>(),
  mapCustomFrom<DateTime?>(),
  mapCustomTo<DateTime?>(),
  mapIncludeArchived<bool>(),
  mapThemeMode<ThemeMode>(codec: EnumCodec(ThemeMode.values)),
  mapWithPartners<bool>(),

  // Cleanup
  cleanupKeepFavorites<bool>(),
  cleanupKeepMediaType<AssetKeepType>(codec: EnumCodec(AssetKeepType.values)),
  cleanupKeepAlbumIds<List<String>>(codec: ListCodec(PrimitiveCodec.string)),
  cleanupCutoffDaysAgo<int>(),
  cleanupDefaultsInitialized<bool>(),

  // Share
  shareFileType<ShareAssetType>(codec: EnumCodec(ShareAssetType.values)),

  // Slideshow
  slideshowRepeat<bool>(),
  slideshowDuration<int>(),
  slideshowLook<SlideshowLook>(codec: EnumCodec(SlideshowLook.values)),
  slideshowDirection<SlideshowDirection>(codec: EnumCodec(SlideshowDirection.values)),

  // Feature message
  featureMessageSeenRelease<SemVer>(codec: SemVerCodec());

  final ValueCodec<T>? _codecOverride;

  const SettingsKey({ValueCodec<T>? codec}) : _codecOverride = codec;

  ValueCodec<T> get _codec => _codecOverride ?? ValueCodec.forType(T);

  String encode(T value) => _codec.encode(value);

  T decode(String raw) => _codec.decode(raw);
}
