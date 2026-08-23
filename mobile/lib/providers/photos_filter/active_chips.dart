// Pure-dart helper that renders the current SearchFilter as an ordered list
// of chip specs for the active-filters subheader and the sheet header.
//
// Order (design §5.5):
//   people → tags → location → camera → date → rating → media → favourite
//   → archive → not-in-album → untagged → text.

import 'package:easy_localization/easy_localization.dart';
import 'package:flutter/material.dart';
import 'package:immich_mobile/domain/models/asset/base_asset.model.dart';
import 'package:immich_mobile/models/search/search_filter.model.dart';
import 'package:immich_mobile/providers/photos_filter/chip_id.dart';
import 'package:openapi/api.dart';

enum ChipVisual { person, tag, location, camera, when, rating, media, toggle, text }

class ActiveChipSpec {
  final ChipId id;
  final String label;

  /// True when [label] is an i18n key rather than resolved display text —
  /// this pure helper has no BuildContext to call `.tr()` with, so the
  /// widget must translate it before display (else the raw key leaks to
  /// the user, e.g. "filter_sheet_favourites" instead of "Favourites").
  final bool labelIsKey;
  final ChipVisual visual;
  final List<String>? avatarPersonIds;

  /// Space scope for each avatar in [avatarPersonIds], index-aligned (same length, non-null when
  /// that avatar is a shared-space person). The chip avatar routes a Space person to the
  /// membership-gated space thumbnail endpoint via getFilterPersonThumbnailUrl — the tokenized
  /// avatar id alone doesn't carry the spaceId, so it 404s the owner endpoint without this.
  final List<String?>? avatarPersonSpaceIds;
  final int? tagDotSeed;
  final IconData? icon;
  final String? semanticsLabel;

  const ActiveChipSpec({
    required this.id,
    required this.label,
    required this.visual,
    this.labelIsKey = false,
    this.avatarPersonIds,
    this.avatarPersonSpaceIds,
    this.tagDotSeed,
    this.icon,
    this.semanticsLabel,
  });
}

List<ActiveChipSpec> activeChipsFromFilter(SearchFilter filter, {FilterSuggestionsResponseDto? suggestions}) {
  final out = <ActiveChipSpec>[];

  // ── people ───────────────────────────────────────────────────────────
  final people = filter.people.toList(growable: false);
  if (people.length <= 2) {
    for (final p in people) {
      out.add(
        ActiveChipSpec(
          id: PersonChipId(p.id),
          label: p.name.isEmpty ? 'filter_sheet_unnamed_person' : p.name,
          labelIsKey: p.name.isEmpty,
          visual: ChipVisual.person,
          avatarPersonIds: [p.id],
          avatarPersonSpaceIds: [p.spaceId],
        ),
      );
    }
  } else {
    // 2 individual chips then a spillover chip representing the remainder.
    for (final p in people.take(2)) {
      out.add(
        ActiveChipSpec(
          id: PersonChipId(p.id),
          label: p.name.isEmpty ? 'filter_sheet_unnamed_person' : p.name,
          labelIsKey: p.name.isEmpty,
          visual: ChipVisual.person,
          avatarPersonIds: [p.id],
          avatarPersonSpaceIds: [p.spaceId],
        ),
      );
    }
    final tail = people.skip(2).toList();
    final firstTail = tail.first;
    final avatars = <String>[people[0].id, people[1].id, firstTail.id];
    final avatarSpaceIds = <String?>[people[0].spaceId, people[1].spaceId, firstTail.spaceId];
    out.add(
      ActiveChipSpec(
        id: PersonChipId(firstTail.id),
        label: '${people[0].name}, ${people[1].name} +${tail.length}',
        visual: ChipVisual.person,
        avatarPersonIds: avatars,
        avatarPersonSpaceIds: avatarSpaceIds,
      ),
    );
  }

  // ── tags ─────────────────────────────────────────────────────────────
  final tagIds = filter.tagIds ?? const <String>[];
  for (final tagId in tagIds) {
    String? resolved;
    if (suggestions != null) {
      for (final t in suggestions.tags) {
        if (t.id == tagId) {
          resolved = t.value;
          break;
        }
      }
    }
    out.add(
      ActiveChipSpec(
        id: TagChipId(tagId),
        label: resolved ?? 'filter_sheet_tag_fallback',
        labelIsKey: resolved == null,
        visual: ChipVisual.tag,
        tagDotSeed: tagId.hashCode,
      ),
    );
  }

  // ── location ─────────────────────────────────────────────────────────
  final locParts = [
    filter.location.country,
    filter.location.state,
    filter.location.city,
  ].where((s) => s != null && s.isNotEmpty).cast<String>().toList();
  if (locParts.isNotEmpty) {
    out.add(
      ActiveChipSpec(
        id: const LocationChipId(),
        label: locParts.join(' · '),
        visual: ChipVisual.location,
        icon: Icons.place_rounded,
      ),
    );
  }

  // ── camera ───────────────────────────────────────────────────────────
  final cameraParts = [
    filter.camera.make,
    filter.camera.model,
  ].where((s) => s != null && s.isNotEmpty).cast<String>().toList();
  if (cameraParts.isNotEmpty) {
    out.add(
      ActiveChipSpec(
        id: const CameraChipId(),
        label: cameraParts.join(' · '),
        visual: ChipVisual.camera,
        icon: Icons.photo_camera_rounded,
      ),
    );
  }

  // ── date ─────────────────────────────────────────────────────────────
  final after = filter.date.takenAfter;
  final before = filter.date.takenBefore;
  if (after != null || before != null) {
    final fmt = DateFormat.yMMM();
    String label;
    if (after != null && before != null) {
      if (after.year == before.year && after.month == before.month) {
        label = fmt.format(after);
      } else {
        label = '${fmt.format(after)} – ${fmt.format(before)}';
      }
    } else if (after != null) {
      label = 'After ${fmt.format(after)}';
    } else {
      label = 'Before ${fmt.format(before!)}';
    }
    out.add(ActiveChipSpec(id: const DateChipId(), label: label, visual: ChipVisual.when));
  }

  // ── rating ───────────────────────────────────────────────────────────
  final rating = filter.rating.rating.unwrapOrNull;
  if (rating != null && rating > 0) {
    out.add(
      ActiveChipSpec(
        id: const RatingChipId(),
        label: '★ $rating+',
        visual: ChipVisual.rating,
        icon: Icons.star_rounded,
      ),
    );
  }

  // ── media type ───────────────────────────────────────────────────────
  final mt = filter.mediaType;
  if (mt != AssetType.other) {
    String label;
    IconData icon;
    switch (mt) {
      case AssetType.image:
        label = 'filter_sheet_media_photos';
        icon = Icons.photo_rounded;
      case AssetType.video:
        label = 'filter_sheet_media_videos';
        icon = Icons.play_circle_rounded;
      case AssetType.audio:
        label = 'filter_sheet_media_audio';
        icon = Icons.audiotrack_rounded;
      case AssetType.other:
        // unreachable (handled above)
        label = '';
        icon = Icons.help_outline_rounded;
    }
    out.add(
      ActiveChipSpec(id: const MediaTypeChipId(), label: label, labelIsKey: true, visual: ChipVisual.media, icon: icon),
    );
  }

  // ── toggles ──────────────────────────────────────────────────────────
  if (filter.display.isFavorite) {
    out.add(
      const ActiveChipSpec(
        id: FavouriteChipId(),
        label: 'filter_sheet_favourites',
        labelIsKey: true,
        visual: ChipVisual.toggle,
        icon: Icons.favorite_rounded,
      ),
    );
  }
  if (filter.display.isArchive) {
    out.add(
      const ActiveChipSpec(
        id: ArchiveChipId(),
        label: 'filter_sheet_archived',
        labelIsKey: true,
        visual: ChipVisual.toggle,
        icon: Icons.archive_rounded,
      ),
    );
  }
  if (filter.display.isNotInAlbum) {
    out.add(
      const ActiveChipSpec(
        id: NotInAlbumChipId(),
        label: 'filter_sheet_not_in_album',
        labelIsKey: true,
        visual: ChipVisual.toggle,
        icon: Icons.folder_off_rounded,
      ),
    );
  }
  if (filter.display.isUntagged) {
    out.add(
      const ActiveChipSpec(
        id: UntaggedChipId(),
        label: 'untagged',
        labelIsKey: true,
        visual: ChipVisual.toggle,
        icon: Icons.label_off_rounded,
      ),
    );
  }

  // ── text ─────────────────────────────────────────────────────────────
  final ctx = filter.context?.trim();
  if (ctx != null && ctx.isNotEmpty) {
    final truncated = ctx.length > 24 ? '${ctx.substring(0, 24)}…' : ctx;
    out.add(
      ActiveChipSpec(
        id: const TextChipId(),
        label: '"$truncated"',
        visual: ChipVisual.text,
        icon: Icons.search_rounded,
      ),
    );
  }

  return out;
}
