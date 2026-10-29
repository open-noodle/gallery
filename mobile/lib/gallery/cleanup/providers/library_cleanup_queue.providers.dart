import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/gallery/cleanup/models/library_cleanup_filters.dart';
import 'package:immich_mobile/gallery/cleanup/models/library_cleanup_queue.dart';
import 'package:immich_mobile/gallery/cleanup/providers/library_cleanup.providers.dart';
import 'package:openapi/api.dart';

/// The queues with filters in the ⋯ menu, as on web: Blurry's strictness, reason and hide faces, Space hogs' type and
/// minimum size. Screenshots has none.
bool libraryCleanupHasFilters(LibraryCleanupQueue queue) =>
    queue == LibraryCleanupQueue.blurry || queue == LibraryCleanupQueue.spaceHogs;

/// The queue screen's total ("Blurry · 12 of 87"): the queue's count with the filters its pages use, as the web's
/// queue header counts. Keyed by the filters, so changing them counts again.
final libraryCleanupQueueTotalProvider = FutureProvider.autoDispose
    .family<CleanupCountResponseDto, LibraryCleanupFilters>((ref, filters) {
      ref.watch(libraryCleanupUserIdProvider);
      return ref.watch(libraryCleanupRepositoryProvider).queueCount(filters.queue, filters: filters);
    });
