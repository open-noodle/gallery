import 'dart:io';

import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/gallery/cleanup/models/library_cleanup_queue.dart';
import 'package:immich_mobile/gallery/cleanup/models/library_cleanup_support.dart';
import 'package:immich_mobile/gallery/cleanup/repositories/library_cleanup.repository.dart';
import 'package:immich_mobile/gallery/cleanup/repositories/library_cleanup_marks_store.dart';
import 'package:immich_mobile/providers/api.provider.dart';
import 'package:immich_mobile/providers/server_info.provider.dart';
import 'package:immich_mobile/providers/user.provider.dart';
import 'package:immich_mobile/utils/semver.dart';
import 'package:openapi/api.dart';
import 'package:path_provider/path_provider.dart';

/// What the app knows of the connected server, before any cleanup request is made.
enum LibraryCleanupServerKind {
  /// The version is still the `0.0.0` placeholder and no sync types have arrived.
  unknown,
  stock,
  gallery,
}

/// Classifies the server the way the sync request list does (`SyncApiRepository._forkSyncTypes`, mirrored by
/// `serverSupportsSpaces`): its declared sync types when they have arrived, else a fork version above 5.0.0. Unlike
/// `serverSupportsSpaces`, which keeps its Spaces entry while the version is unknown, the cleanup probe waits.
LibraryCleanupServerKind libraryCleanupServerKind(SemVer version, Set<String>? declaredSyncTypes) {
  if (declaredSyncTypes != null) {
    return declaredSyncTypes.contains(SyncRequestType.sharedSpacesV1.toJson())
        ? LibraryCleanupServerKind.gallery
        : LibraryCleanupServerKind.stock;
  }
  if (version == const SemVer(major: 0, minor: 0, patch: 0)) {
    return LibraryCleanupServerKind.unknown;
  }
  return version > const SemVer(major: 5, minor: 0, patch: 0)
      ? LibraryCleanupServerKind.gallery
      : LibraryCleanupServerKind.stock;
}

final libraryCleanupServerKindProvider = Provider<LibraryCleanupServerKind>(
  (ref) => ref.watch(
    serverInfoProvider.select(
      (info) => libraryCleanupServerKind(info.serverVersion, info.serverFeatures.syncRequestTypes),
    ),
  ),
);

/// Whether the server's trash is on, from the features the app already reads. With it off a Cleanup trash deletes
/// permanently.
final libraryCleanupTrashEnabledProvider = Provider<bool>(
  (ref) => ref.watch(serverInfoProvider.select((info) => info.serverFeatures.trash)),
);

/// The signed-in user, which keys the saved marks.
final libraryCleanupUserIdProvider = Provider<String?>((ref) => ref.watch(currentUserProvider)?.id);

final libraryCleanupTimeZoneProvider = Provider<LibraryCleanupTimeZoneReader>((ref) => readDeviceTimeZone);

/// How many photos a queue page asks for (the web asks for 100). Tests make it small to page through short queues.
final libraryCleanupPageSizeProvider = Provider<int>((ref) => libraryCleanupPageSize);

final libraryCleanupRepositoryProvider = Provider<LibraryCleanupRepository>((ref) {
  final api = ref.watch(apiServiceProvider);
  return LibraryCleanupRepository(
    cleanupApi: api.cleanupApi,
    trashApi: api.trashApi,
    duplicatesApi: api.duplicatesApi,
    stacksApi: api.stacksApi,
    timeZone: ref.watch(libraryCleanupTimeZoneProvider),
  );
});

/// Where the saved marks live; tests point it at a temporary folder.
final libraryCleanupMarksDirectoryProvider = Provider<Future<Directory> Function()>(
  (ref) => getApplicationDocumentsDirectory,
);

final libraryCleanupMarksStoreProvider = Provider<LibraryCleanupMarksStore>(
  (ref) => LibraryCleanupMarksStore(ref.watch(libraryCleanupMarksDirectoryProvider)),
);

/// Whether the server has Library Cleanup, asked once per server connection with `GET /cleanup/calendar`.
///
/// - A server whose version is not known yet gets no request; the provider rebuilds once it is.
/// - A stock Immich server gets none either.
/// - 404 and 403 are a lasting "no". A network error or 5xx is "unavailable": hidden for now, and [refreshIfFailed]
///   asks again the next time Library opens.
class LibraryCleanupSupportNotifier extends AsyncNotifier<LibraryCleanupSupport> {
  @override
  Future<LibraryCleanupSupport> build() async {
    // A new user is a new session on the same server; a new server kind is a new connection.
    ref.watch(libraryCleanupUserIdProvider);
    return switch (ref.watch(libraryCleanupServerKindProvider)) {
      LibraryCleanupServerKind.unknown => const LibraryCleanupSupport.unknown(),
      LibraryCleanupServerKind.stock => const LibraryCleanupSupport.unsupported(),
      LibraryCleanupServerKind.gallery => ref.read(libraryCleanupRepositoryProvider).probe(),
    };
  }

  /// Library calls this when it opens: a probe that failed on the network or a 5xx is asked again.
  void refreshIfFailed() {
    if (state.valueOrNull?.status == LibraryCleanupSupportStatus.unavailable) {
      ref.invalidateSelf();
    }
  }

  /// Reads the calendar again (pull to refresh, or a day just finished) and keeps the old one if that fails.
  Future<void> refreshCalendar() async {
    if (state.valueOrNull?.isSupported != true) {
      return;
    }
    try {
      final calendar = await ref.read(libraryCleanupRepositoryProvider).calendar();
      state = AsyncData(LibraryCleanupSupport.supported(calendar));
    } catch (_) {}
  }
}

final libraryCleanupSupportProvider = AsyncNotifierProvider<LibraryCleanupSupportNotifier, LibraryCleanupSupport>(
  LibraryCleanupSupportNotifier.new,
);

/// The calendar the probe fetched, shared with the overview so it asks nothing twice. Null until the server is known
/// to have Library Cleanup.
final libraryCleanupCalendarProvider = Provider<CleanupCalendarResponseDto?>(
  (ref) => ref.watch(libraryCleanupSupportProvider).valueOrNull?.calendar,
);
