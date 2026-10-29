import 'dart:math' as math;

import 'package:easy_localization/easy_localization.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/gallery/cleanup/models/library_cleanup_marks.dart';
import 'package:immich_mobile/gallery/cleanup/repositories/library_cleanup_details.repository.dart';
import 'package:immich_mobile/gallery/cleanup/widgets/cleanup_deck_card.dart';
import 'package:immich_mobile/gallery/cleanup/widgets/cleanup_overview_bits.dart';
import 'package:immich_mobile/gallery/motion/motion_tokens.dart';
import 'package:immich_mobile/gallery/motion/pressable.dart';
import 'package:immich_mobile/generated/translations.g.dart';
import 'package:immich_mobile/utils/bytes_units.dart';
import 'package:openapi/api.dart';

// The details sheet (specs/2026-10-29-mobile-library-cleanup-design.md, "Details sheet"; mockup `2-details.html`): the
// same sheet for every cleanup, from the deck's ⓘ chip, a tap on the photo or an upward drag on the info strip, and from
// a long press in a grid. Half open it shows when, where, who and which albums, with the photo shrunk into the top of
// the screen; fully open, the camera, the file and the queue's own signal. Read-only, as on web; its pinned Keep,
// Favourite and Trash close it and decide the photo as the deck's buttons would.

/// How far the sheet opens at first, and fully, as a share of the screen's height.
const libraryCleanupDetailsHalf = 0.55;
const libraryCleanupDetailsFull = 0.92;

/// Below this the sheet has been dragged away and closes.
const _closeBelow = 0.14;

/// The hero a photo flies on into the sheet, when its card has no other.
String libraryCleanupDetailsHeroTag(String assetId) => 'library-cleanup:details:$assetId';

/// Opens the details sheet for a photo and resolves, once the sheet has gone, with the mark chosen from its pinned
/// actions, or null when it was closed without one. The caller applies the mark exactly as its own button would.
typedef LibraryCleanupDetailsOpener = Future<LibraryCleanupMark?> Function(CleanupAssetDto asset, String? heroTag);

/// What a session tells the sheet about the photo, beyond the photo itself.
class LibraryCleanupDetailsRequest {
  const LibraryCleanupDetailsRequest({
    required this.asset,
    this.subtitle,
    this.heroTag,
    this.onOpenInLibrary,
    this.onShowDay,
  });

  final CleanupAssetDto asset;

  /// Under the date: how long ago and the position in the session ("7 years ago · Photo 16 of 42").
  final String? subtitle;

  /// The hero the photo flies on from its card (null: the photo fades in).
  final String? heroTag;

  /// "Open in library" and "Show that day". The sheet closes first, so back returns to the same card.
  final VoidCallback? onOpenInLibrary;
  final VoidCallback? onShowDay;
}

/// Shows the sheet over the current screen. See [LibraryCleanupDetailsOpener].
Future<LibraryCleanupMark?> showLibraryCleanupDetails(
  BuildContext context,
  LibraryCleanupDetailsRequest request,
) async {
  final route = PageRouteBuilder<LibraryCleanupMark?>(
    opaque: false,
    transitionDuration: GalleryMotion.base,
    reverseTransitionDuration: GalleryMotion.quick,
    pageBuilder: (context, animation, _) => LibraryCleanupDetailsView(request: request, animation: animation),
  );
  final mark = await Navigator.of(context, rootNavigator: true).push(route);
  if (mark != null) {
    // The card is thrown once the sheet has gone, so the throw is seen.
    await route.completed;
  }
  return mark;
}

/// The sheet's screen: a scrim, the photo shrunk into the top (its height follows the sheet's drag), and the sheet.
class LibraryCleanupDetailsView extends StatefulWidget {
  const LibraryCleanupDetailsView({super.key, required this.request, required this.animation});

  final LibraryCleanupDetailsRequest request;
  final Animation<double> animation;

  @override
  State<LibraryCleanupDetailsView> createState() => _LibraryCleanupDetailsViewState();
}

class _LibraryCleanupDetailsViewState extends State<LibraryCleanupDetailsView> {
  final _extent = ValueNotifier<double>(libraryCleanupDetailsHalf);
  bool _closing = false;

  @override
  void dispose() {
    _extent.dispose();
    super.dispose();
  }

  void _close([LibraryCleanupMark? mark]) {
    if (_closing) {
      return;
    }
    _closing = true;
    Navigator.of(context).pop(mark);
  }

  void _leaveFor(VoidCallback? action) {
    _close();
    action?.call();
  }

  @override
  Widget build(BuildContext context) {
    final request = widget.request;
    final asset = request.asset;
    final padding = MediaQuery.paddingOf(context);
    final slide = CurvedAnimation(
      parent: widget.animation,
      curve: GalleryMotion.settle,
      reverseCurve: GalleryMotion.exit,
    );
    final photo = Image(
      image: libraryCleanupPreview(asset),
      fit: BoxFit.cover,
      gaplessPlayback: true,
      frameBuilder: (context, child, frame, sync) => frame == null && !sync
          ? Image(
              image: libraryCleanupThumbnail(asset),
              fit: BoxFit.cover,
              errorBuilder: (_, _, _) => const ColoredBox(color: Colors.black),
            )
          : child,
      errorBuilder: (_, _, _) => const ColoredBox(color: Colors.black),
    );
    return LayoutBuilder(
      builder: (context, constraints) {
        final height = constraints.maxHeight;
        return Stack(
          key: const Key('cleanup-details'),
          children: [
            Positioned.fill(
              child: FadeTransition(
                opacity: widget.animation,
                child: GestureDetector(
                  key: const Key('cleanup-details-scrim'),
                  onTap: _close,
                  child: const ColoredBox(color: Color(0xE6000000)),
                ),
              ),
            ),
            // The photo takes what the sheet leaves at the top, so it shrinks as the sheet is dragged up.
            ValueListenableBuilder<double>(
              valueListenable: _extent,
              builder: (context, extent, child) {
                final room = math.max(0.0, height * (1 - extent) - padding.top - 20);
                return Positioned(
                  left: 14,
                  right: 14,
                  top: padding.top + 8,
                  height: room,
                  child: Opacity(opacity: ((room - 24) / 72).clamp(0.0, 1.0), child: child),
                );
              },
              child: GestureDetector(
                key: const Key('cleanup-details-photo'),
                onTap: _close,
                child: ClipRRect(
                  borderRadius: BorderRadius.circular(16),
                  child: request.heroTag == null ? photo : Hero(tag: request.heroTag!, child: photo),
                ),
              ),
            ),
            Positioned.fill(
              child: SlideTransition(
                position: Tween(begin: const Offset(0, 1), end: Offset.zero).animate(slide),
                child: NotificationListener<DraggableScrollableNotification>(
                  onNotification: (notification) {
                    _extent.value = notification.extent;
                    if (notification.extent < _closeBelow) {
                      _close();
                    }
                    return false;
                  },
                  child: DraggableScrollableSheet(
                    initialChildSize: libraryCleanupDetailsHalf,
                    minChildSize: 0,
                    maxChildSize: libraryCleanupDetailsFull,
                    snap: true,
                    snapSizes: const [libraryCleanupDetailsHalf],
                    builder: (context, scroll) => _Sheet(
                      request: request,
                      scroll: scroll,
                      extent: _extent,
                      onMark: _close,
                      onOpenInLibrary: request.onOpenInLibrary == null
                          ? null
                          : () => _leaveFor(request.onOpenInLibrary),
                      onShowDay: request.onShowDay == null ? null : () => _leaveFor(request.onShowDay),
                    ),
                  ),
                ),
              ),
            ),
          ],
        );
      },
    );
  }
}

class _Sheet extends ConsumerWidget {
  const _Sheet({
    required this.request,
    required this.scroll,
    required this.extent,
    required this.onMark,
    required this.onOpenInLibrary,
    required this.onShowDay,
  });

  final LibraryCleanupDetailsRequest request;
  final ScrollController scroll;
  final ValueListenable<double> extent;
  final ValueChanged<LibraryCleanupMark> onMark;
  final VoidCallback? onOpenInLibrary;
  final VoidCallback? onShowDay;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final theme = Theme.of(context);
    final scheme = theme.colorScheme;
    final t = context.t;
    final asset = request.asset;
    // Shows the card's data at once; what the server adds fills in place. A failure adds nothing, and says nothing.
    final details = ref.watch(libraryCleanupDetailsProvider(asset.id)).valueOrNull;
    final full = details?.asset;
    final exif = full?.exifInfo.orElse(null);
    final rows = _Rows(context, asset, full, exif, details?.albums);
    final muted = theme.textTheme.bodyMedium?.copyWith(color: scheme.onSurfaceVariant);

    return Material(
      key: const Key('cleanup-details-sheet'),
      color: scheme.surfaceContainer,
      elevation: 12,
      borderRadius: const BorderRadius.vertical(top: Radius.circular(22)),
      clipBehavior: Clip.antiAlias,
      child: Column(
        children: [
          Expanded(
            child: ListView(
              controller: scroll,
              padding: const EdgeInsets.fromLTRB(18, 2, 18, 12),
              children: [
                // The grab handle, with room around it to take the drag.
                ColoredBox(
                  key: const Key('cleanup-details-handle'),
                  color: Colors.transparent,
                  child: SizedBox(
                    height: 22,
                    child: Center(
                      child: Container(
                        width: 36,
                        height: 4,
                        decoration: BoxDecoration(color: scheme.outlineVariant, borderRadius: BorderRadius.circular(2)),
                      ),
                    ),
                  ),
                ),
                const SizedBox(height: 4),
                Row(
                  children: [
                    // Fully open, the photo has left the top: a small copy joins the header instead.
                    ValueListenableBuilder<double>(
                      valueListenable: extent,
                      builder: (context, value, child) {
                        final shown = ((value - 0.78) / 0.12).clamp(0.0, 1.0);
                        return shown == 0
                            ? const SizedBox.shrink()
                            : Opacity(
                                opacity: shown,
                                child: Padding(
                                  padding: const EdgeInsets.only(right: 12),
                                  child: SizedBox.square(dimension: 48 * shown, child: child),
                                ),
                              );
                      },
                      child: ClipRRect(
                        borderRadius: BorderRadius.circular(10),
                        child: Image(
                          image: libraryCleanupThumbnail(asset),
                          fit: BoxFit.cover,
                          errorBuilder: (_, _, _) => const SizedBox.shrink(),
                        ),
                      ),
                    ),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            rows.takenAt,
                            key: const Key('cleanup-details-date'),
                            style: theme.textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w700),
                          ),
                          if (request.subtitle != null)
                            Text(request.subtitle!, key: const Key('cleanup-details-subtitle'), style: muted),
                        ],
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 6),
                if (rows.place != null)
                  _Row(keyName: 'place', icon: Icons.place_outlined, title: rows.place!, detail: rows.placeDetail),
                if (rows.people != null)
                  _Row(keyName: 'people', icon: Icons.people_outline_rounded, label: t.people, title: rows.people!),
                if (rows.albums != null)
                  _Row(keyName: 'albums', icon: Icons.photo_album_outlined, label: t.albums, title: rows.albums!),
                if (rows.camera != null || rows.exposure != null)
                  _Row(
                    keyName: 'camera',
                    icon: Icons.photo_camera_outlined,
                    title: rows.camera ?? t.camera,
                    detail: rows.exposure,
                  ),
                _Row(keyName: 'file', icon: Icons.image_outlined, title: rows.fileName, detail: rows.fileDetail),
                if (rows.signal != null) _Row(keyName: 'signal', icon: Icons.blur_on_rounded, title: rows.signal!),
                if (onOpenInLibrary != null || onShowDay != null)
                  Padding(
                    padding: const EdgeInsets.only(top: 12),
                    child: Row(
                      children: [
                        if (onOpenInLibrary != null)
                          Expanded(
                            child: OutlinedButton.icon(
                              key: const Key('cleanup-details-open'),
                              onPressed: onOpenInLibrary,
                              icon: const Icon(Icons.open_in_full_rounded, size: 18),
                              label: Text(t.cleanup_open_in_library, maxLines: 1, overflow: TextOverflow.ellipsis),
                            ),
                          ),
                        if (onOpenInLibrary != null && onShowDay != null) const SizedBox(width: 8),
                        if (onShowDay != null)
                          Expanded(
                            child: OutlinedButton.icon(
                              key: const Key('cleanup-details-show-day'),
                              onPressed: onShowDay,
                              icon: const Icon(Icons.calendar_today_outlined, size: 18),
                              label: Text(
                                t.cleanup_details_show_that_day,
                                maxLines: 1,
                                overflow: TextOverflow.ellipsis,
                              ),
                            ),
                          ),
                      ],
                    ),
                  ),
              ],
            ),
          ),
          _Actions(onMark: onMark),
        ],
      ),
    );
  }
}

/// What the sheet's rows say: the card's own data first, the server's where it has more.
class _Rows {
  _Rows(BuildContext context, CleanupAssetDto asset, AssetResponseDto? full, ExifResponseDto? exif, this._albums)
    : takenAt = _takenAt(context, asset),
      place = _place(asset, exif),
      placeDetail = null,
      people = _people(full),
      camera = _camera(exif),
      exposure = _exposure(exif),
      fileName = full?.originalFileName ?? asset.originalFileName,
      fileDetail = _fileDetail(asset, exif),
      signal = _signal(context, asset);

  final String takenAt;
  final String? place;
  final String? placeDetail;
  final String? people;
  final String? camera;
  final String? exposure;
  final String fileName;
  final String fileDetail;
  final String? signal;
  final List<AlbumResponseDto>? _albums;

  /// The albums the photo is in; no row when the call failed or it is in none.
  String? get albums {
    final albums = _albums;
    if (albums == null || albums.isEmpty) {
      return null;
    }
    return albums.map((album) => album.albumName).join(' · ');
  }

  static String _locale(BuildContext context) => Localizations.maybeLocaleOf(context)?.toLanguageTag() ?? 'en';

  /// The card's wall-clock time ("Saturday, August 15, 2020 08:00"): `localDateTime` is the local time in UTC form.
  static String _takenAt(BuildContext context, CleanupAssetDto asset) {
    final DateTime parsed;
    try {
      parsed = DateTime.parse(asset.localDateTime);
    } catch (_) {
      return asset.localDateTime;
    }
    try {
      return DateFormat.yMMMMEEEEd(_locale(context)).add_Hm().format(parsed);
    } catch (_) {
      return DateFormat.yMMMMEEEEd('en').add_Hm().format(parsed);
    }
  }

  static String? _clean(String? value) => value == null || value.trim().isEmpty ? null : value.trim();

  static String? _place(CleanupAssetDto asset, ExifResponseDto? exif) {
    final parts = [
      _clean(exif?.city.orElse(null) ?? asset.city),
      _clean(exif?.state.orElse(null)),
      _clean(exif?.country.orElse(null)),
    ].nonNulls;
    return parts.isEmpty ? null : parts.join(', ');
  }

  /// Named people only, as on web: an unrecognised face has nothing to show.
  static String? _people(AssetResponseDto? full) {
    final named = [
      for (final person in full?.people.orElse(null) ?? const <PersonResponseDto>[])
        if (person.name.trim().isNotEmpty) person.name.trim(),
    ];
    return named.isEmpty ? null : named.join(', ');
  }

  static String? _camera(ExifResponseDto? exif) {
    final body = [_clean(exif?.make.orElse(null)), _clean(exif?.model.orElse(null))].nonNulls.join(' ');
    final lens = _clean(exif?.lensModel.orElse(null));
    final parts = [if (body.isNotEmpty) body, ?lens];
    return parts.isEmpty ? null : parts.join(' · ');
  }

  static String _number(double value) =>
      value == value.roundToDouble() ? value.toStringAsFixed(0) : value.toStringAsFixed(1);

  static String? _exposure(ExifResponseDto? exif) {
    final fNumber = exif?.fNumber.orElse(null);
    final time = _clean(exif?.exposureTime.orElse(null));
    final iso = exif?.iso.orElse(null);
    final focal = exif?.focalLength.orElse(null);
    final parts = [
      if (fNumber != null && fNumber > 0) 'ƒ/${_number(fNumber)}',
      if (time != null) '$time s',
      if (iso != null && iso > 0) 'ISO $iso',
      if (focal != null && focal > 0) '${focal.round()} mm',
    ];
    return parts.isEmpty ? null : parts.join(' · ');
  }

  /// "6240 × 4160 · 26 MP · 4.2 MB": the server's dimensions when it has them, else the card's.
  static String _fileDetail(CleanupAssetDto asset, ExifResponseDto? exif) {
    final width = exif?.exifImageWidth.orElse(null) ?? asset.width;
    final height = exif?.exifImageHeight.orElse(null) ?? asset.height;
    final bytes = exif?.fileSizeInByte.orElse(null) ?? asset.fileSize.round();
    final parts = <String>[];
    if (width != null && height != null && width > 0 && height > 0) {
      parts.add('$width × $height');
      final megapixels = (width * height / 1000000).round();
      if (megapixels > 0) {
        parts.add('$megapixels MP');
      }
    }
    parts.add(formatBytes(bytes));
    return parts.join(' · ');
  }

  /// The queue's own signal: the blur reason and the sharpness, where the photo carries them.
  static String? _signal(BuildContext context, CleanupAssetDto asset) {
    final t = context.t;
    final reason = asset.reason.orElse(null);
    final sharpness = asset.sharpness.orElse(null);
    final parts = [
      ?switch (reason) {
        CleanupBlurReason.blurry => t.cleanup_reason_blurry,
        CleanupBlurReason.dark => t.cleanup_reason_dark,
        CleanupBlurReason.bright => t.cleanup_reason_bright,
        _ => null,
      },
      if (sharpness != null) '${t.cleanup_sharpness} ${sharpness.round()}',
    ];
    return parts.isEmpty ? null : parts.join(' · ');
  }
}

class _Row extends StatelessWidget {
  const _Row({required this.keyName, required this.icon, required this.title, this.label, this.detail});

  final String keyName;
  final IconData icon;
  final String title;

  /// A small caption above the title, where the title alone would not say what it is (people, albums).
  final String? label;
  final String? detail;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final scheme = theme.colorScheme;
    final small = theme.textTheme.bodySmall?.copyWith(color: scheme.onSurfaceVariant);
    return Container(
      key: Key('cleanup-details-$keyName'),
      padding: const EdgeInsets.symmetric(vertical: 10),
      decoration: BoxDecoration(
        border: Border(bottom: BorderSide(color: scheme.outlineVariant.withValues(alpha: 0.5))),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(width: 30, child: Icon(icon, size: 20, color: scheme.onSurfaceVariant)),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                if (label != null) Text(label!, style: small),
                Text(title, key: Key('cleanup-details-$keyName-title'), style: theme.textTheme.bodyMedium),
                if (detail != null) Text(detail!, key: Key('cleanup-details-$keyName-detail'), style: small),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

/// Keep, Favourite and Trash, pinned at the bottom of the sheet. Choosing one closes the sheet and decides the photo.
class _Actions extends StatelessWidget {
  const _Actions({required this.onMark});

  final ValueChanged<LibraryCleanupMark> onMark;

  @override
  Widget build(BuildContext context) {
    final t = context.t;
    final scheme = Theme.of(context).colorScheme;
    Widget action(LibraryCleanupMark mark, IconData icon, String label) => Expanded(
      child: GalleryPressable(
        pressedScale: 0.94,
        child: Material(
          color: scheme.surfaceContainerHighest,
          borderRadius: BorderRadius.circular(14),
          child: InkWell(
            key: Key('cleanup-details-${mark.name}'),
            borderRadius: BorderRadius.circular(14),
            onTap: () => onMark(mark),
            child: Padding(
              padding: const EdgeInsets.symmetric(vertical: 10),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Icon(icon, color: libraryCleanupMarkColor(mark)),
                  const SizedBox(height: 2),
                  Text(label, style: TextStyle(fontSize: 12, color: scheme.onSurface)),
                ],
              ),
            ),
          ),
        ),
      ),
    );
    return Padding(
      padding: EdgeInsets.fromLTRB(14, 8, 14, 12 + MediaQuery.paddingOf(context).bottom),
      child: Row(
        spacing: 8,
        children: [
          action(LibraryCleanupMark.trash, Icons.close_rounded, t.trash),
          action(LibraryCleanupMark.favorite, Icons.favorite_rounded, t.favorite),
          action(LibraryCleanupMark.keep, Icons.check_rounded, t.keep),
        ],
      ),
    );
  }
}
