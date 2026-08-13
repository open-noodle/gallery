import 'package:flutter/material.dart';
import 'package:immich_mobile/generated/translations.g.dart';

/// Overflow menu for the space detail page — everything the app bar offers except Add photos.
///
/// Extracted from [SpaceDetailPage] so the RBAC table can be widget-tested without pumping a
/// routed page that loads network metadata, members and a Drift timeline. Mirrors [SpaceAlbumKebab].
///
/// The menu is ALWAYS rendered, and each item carries its own gate. It used to be hidden wholesale
/// unless [canEdit], which was safe only while timeline/People/Members lived on the app bar as
/// icons: now that they live here, that rule would leave a viewer with an empty app bar and no way
/// to reach People or Members. Naming and appearance are editor-level server-side, so [canEdit]
/// gates Edit; only deletion is restricted further, via [canDelete].
class SpaceDetailKebab extends StatelessWidget {
  const SpaceDetailKebab({
    super.key,
    required this.canEdit,
    required this.canDelete,
    required this.showInTimeline,
    required this.timelineBusy,
    required this.showPeople,
    required this.onToggleTimeline,
    required this.onPeople,
    required this.onMembers,
    required this.onEdit,
    required this.onDelete,
  });

  final bool canEdit;
  final bool canDelete;

  /// Current timeline state, which selects the item's label — it offers the opposite action.
  final bool showInTimeline;

  /// A toggle is in flight; the item goes inert so a double-tap cannot fire two toggles.
  final bool timelineBusy;

  /// False only when the space has face recognition explicitly disabled.
  /// See `utils/space_face_recognition.dart`.
  final bool showPeople;

  final VoidCallback onToggleTimeline;
  final VoidCallback onPeople;
  final VoidCallback onMembers;
  final VoidCallback onEdit;
  final VoidCallback onDelete;

  @override
  Widget build(BuildContext context) {
    return PopupMenuButton<_KebabAction>(
      key: const Key('space-detail-kebab'),
      onSelected: (action) => switch (action) {
        _KebabAction.toggleTimeline => onToggleTimeline(),
        _KebabAction.people => onPeople(),
        _KebabAction.members => onMembers(),
        _KebabAction.edit => onEdit(),
        _KebabAction.delete => onDelete(),
      },
      itemBuilder: (context) => [
        PopupMenuItem<_KebabAction>(
          key: const Key('space-detail-kebab-timeline'),
          value: _KebabAction.toggleTimeline,
          enabled: !timelineBusy,
          child: Text(showInTimeline ? context.t.spaces_hide_from_timeline : context.t.show_in_timeline),
        ),
        if (showPeople)
          PopupMenuItem<_KebabAction>(
            key: const Key('space-detail-kebab-people'),
            value: _KebabAction.people,
            child: Text(context.t.people),
          ),
        PopupMenuItem<_KebabAction>(
          key: const Key('space-detail-kebab-members'),
          value: _KebabAction.members,
          child: Text(context.t.members),
        ),
        if (canEdit)
          PopupMenuItem<_KebabAction>(
            key: const Key('space-detail-kebab-edit'),
            value: _KebabAction.edit,
            child: Text(context.t.spaces_edit),
          ),
        if (canDelete)
          PopupMenuItem<_KebabAction>(
            key: const Key('space-detail-kebab-delete'),
            value: _KebabAction.delete,
            child: Text(context.t.spaces_delete),
          ),
      ],
    );
  }
}

enum _KebabAction { toggleTimeline, people, members, edit, delete }
