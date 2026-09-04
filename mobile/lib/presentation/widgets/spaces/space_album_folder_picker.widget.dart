import 'package:flutter/material.dart';
import 'package:immich_mobile/domain/models/space_album_folder.model.dart';
import 'package:immich_mobile/extensions/build_context_extensions.dart';
import 'package:immich_mobile/extensions/translate_extensions.dart';
import 'package:immich_mobile/utils/space_album_folders.dart';

/// Move-destination picker, shared by all three "move to folder…" paths: a
/// folder's own ⋮ menu, an album's ⋮ menu, and (on mobile) nothing else --
/// there is no drag-and-drop equivalent of the web modal.
///
/// Renders [buildFolderTree]'s output as an indented flat list, each
/// row keyed `folder-option-<id>`, plus a root row keyed `folder-option-root`
/// representing the space's top level (a `null` folder id). A row is
/// selected and dismissed in one tap -- unlike the web `FormModal`, which
/// stages a selection behind a separate Submit button, mobile bottom sheets
/// in this app (e.g. `SpaceLinkPickerSheet`) select-and-close immediately.
///
/// When [excludeFolderId] is set (moving a FOLDER), that folder and every
/// folder beneath it are disabled: offering them would guarantee a server
/// 400, since a folder can never become its own descendant. Uses the shared
/// [isDescendant] guard from `utils/space_album_folders.dart` rather than
/// reimplementing the walk (U-07). When
/// [excludeFolderId] is null (moving an ALBUM), nothing is excluded -- an
/// album has no subtree, so every folder stays selectable (U-08).
///
/// [currentFolderId] highlights the item's current location; it does not
/// otherwise change selectability, so re-picking the current folder is a
/// harmless no-op move.
class SpaceAlbumFolderPickerSheet extends StatelessWidget {
  const SpaceAlbumFolderPickerSheet({
    super.key,
    required this.folders,
    required this.excludeFolderId,
    required this.currentFolderId,
    required this.onSelect,
  });

  final List<SpaceAlbumFolder> folders;
  final String? excludeFolderId;
  final String? currentFolderId;

  /// Called with the chosen folder id, or `null` for the space root.
  final void Function(String? folderId) onSelect;

  bool _isDisabled(String id) {
    final exclude = excludeFolderId;
    return exclude != null && (id == exclude || isDescendant(folders, id, exclude));
  }

  @override
  Widget build(BuildContext context) {
    final rows = _flatten(buildFolderTree(folders));

    return SafeArea(
      child: Padding(
        padding: const EdgeInsets.only(top: 8, bottom: 8),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 8, 16, 12),
              child: Text('space_album_folder_move'.t(context: context), style: context.textTheme.titleMedium),
            ),
            Flexible(
              child: ListView(
                shrinkWrap: true,
                children: [
                  ListTile(
                    key: const Key('folder-option-root'),
                    leading: const Icon(Icons.folder_outlined),
                    title: Text('space_album_folder_root'.t(context: context)),
                    selected: currentFolderId == null,
                    onTap: () => onSelect(null),
                  ),
                  for (final row in rows)
                    ListTile(
                      key: Key('folder-option-${row.folder.id}'),
                      contentPadding: EdgeInsetsDirectional.only(start: 16.0 + row.depth * 20, end: 16),
                      leading: const Icon(Icons.folder),
                      title: Text(row.folder.name, maxLines: 1, overflow: TextOverflow.ellipsis),
                      selected: currentFolderId == row.folder.id,
                      enabled: !_isDisabled(row.folder.id),
                      onTap: _isDisabled(row.folder.id) ? null : () => onSelect(row.folder.id),
                    ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }

  /// Depth-first flatten of `buildFolderTree`'s output into (folder, depth)
  /// rows for a plain indented `ListView` -- the tree is already built and
  /// cycle-safe, so this only walks the resulting `.children`, never `parentId`.
  List<({SpaceAlbumFolder folder, int depth})> _flatten(List<FolderNode> nodes, [int depth = 0]) => [
    for (final node in nodes) ...[(folder: node.folder, depth: depth), ..._flatten(node.children, depth + 1)],
  ];
}

/// Shows [SpaceAlbumFolderPickerSheet] as a modal bottom sheet.
///
/// Resolves `(picked: true, folderId: id)` when a row is tapped (`id` is
/// `null` for the space root), or `(picked: false, folderId: null)` when the
/// sheet is dismissed without a selection. A raw `String?` return could not
/// tell "picked the root" apart from "dismissed with nothing picked" -- both
/// are `null` -- so the caller gets an explicit `picked` flag instead.
Future<({bool picked, String? folderId})> showSpaceAlbumFolderPicker(
  BuildContext context, {
  required List<SpaceAlbumFolder> folders,
  String? excludeFolderId,
  String? currentFolderId,
}) async {
  final result = await showModalBottomSheet<({String? folderId})>(
    context: context,
    isScrollControlled: true,
    builder: (sheetContext) => SpaceAlbumFolderPickerSheet(
      folders: folders,
      excludeFolderId: excludeFolderId,
      currentFolderId: currentFolderId,
      onSelect: (folderId) => Navigator.of(sheetContext).pop((folderId: folderId)),
    ),
  );

  if (result == null) return (picked: false, folderId: null);
  return (picked: true, folderId: result.folderId);
}
