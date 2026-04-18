// Pure-dart helper that renders the current SearchFilter as an ordered list
// of chip specs for the peek rail.
//
// Order (design §5.5):
//   people → tags → location → date → rating → media → favourite → archive
//   → not-in-album → text.

import 'package:flutter/material.dart';
import 'package:immich_mobile/entities/asset.entity.dart';
import 'package:immich_mobile/models/search/search_filter.model.dart';
import 'package:immich_mobile/providers/photos_filter/chip_id.dart';
import 'package:intl/intl.dart';
import 'package:openapi/api.dart';

enum ChipVisual { person, tag, location, when, rating, media, toggle, text }

class ActiveChipSpec {
  final ChipId id;
  final String label;
  final ChipVisual visual;
  final List<String>? avatarPersonIds;
  final int? tagDotSeed;
  final IconData? icon;

  const ActiveChipSpec({
    required this.id,
    required this.label,
    required this.visual,
    this.avatarPersonIds,
    this.tagDotSeed,
    this.icon,
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
          visual: ChipVisual.person,
          avatarPersonIds: [p.id],
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
          visual: ChipVisual.person,
          avatarPersonIds: [p.id],
        ),
      );
    }
    final tail = people.skip(2).toList();
    final firstTail = tail.first;
    final avatars = <String>[people[0].id, people[1].id, firstTail.id];
    out.add(
      ActiveChipSpec(
        id: PersonChipId(firstTail.id),
        label: '${people[0].name}, ${people[1].name} +${tail.length}',
        visual: ChipVisual.person,
        avatarPersonIds: avatars,
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
  final rating = filter.rating.rating;
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
    out.add(ActiveChipSpec(id: const MediaTypeChipId(), label: label, visual: ChipVisual.media, icon: icon));
  }

  // ── toggles ──────────────────────────────────────────────────────────
  if (filter.display.isFavorite) {
    out.add(
      const ActiveChipSpec(
        id: FavouriteChipId(),
        label: 'filter_sheet_favourites',
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
        visual: ChipVisual.toggle,
        icon: Icons.folder_off_rounded,
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
