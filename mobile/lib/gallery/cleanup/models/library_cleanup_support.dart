import 'package:openapi/api.dart';

enum LibraryCleanupSupportStatus {
  /// The server version is not known yet; nothing has been asked.
  unknown,

  /// The server answered the probe: it has Library Cleanup.
  supported,

  /// A stock Immich server, or a Gallery server that answered 404 (no cleanup) or 403 (no permission).
  unsupported,

  /// The probe failed on the network or with a 5xx: hidden for now, asked again when Library next opens.
  unavailable,
}

/// Whether the connected server has Library Cleanup. Supported carries the calendar the probe fetched, which the
/// overview reuses instead of asking again.
class LibraryCleanupSupport {
  const LibraryCleanupSupport._(this.status, this.calendar);

  const LibraryCleanupSupport.unknown() : this._(LibraryCleanupSupportStatus.unknown, null);
  const LibraryCleanupSupport.unsupported() : this._(LibraryCleanupSupportStatus.unsupported, null);
  const LibraryCleanupSupport.unavailable() : this._(LibraryCleanupSupportStatus.unavailable, null);
  const LibraryCleanupSupport.supported(CleanupCalendarResponseDto calendar)
    : this._(LibraryCleanupSupportStatus.supported, calendar);

  final LibraryCleanupSupportStatus status;
  final CleanupCalendarResponseDto? calendar;

  bool get isSupported => status == LibraryCleanupSupportStatus.supported;
}
