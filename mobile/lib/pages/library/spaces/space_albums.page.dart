import 'dart:async';

import 'package:auto_route/auto_route.dart';
import 'package:collection/collection.dart';
import 'package:flutter/material.dart';
import 'package:flutter_hooks/flutter_hooks.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/domain/models/asset/base_asset.model.dart';
import 'package:immich_mobile/domain/models/settings_key.dart';
import 'package:immich_mobile/domain/models/space_album.model.dart';
import 'package:immich_mobile/domain/models/space_album_folder.model.dart';
import 'package:immich_mobile/extensions/build_context_extensions.dart';
import 'package:immich_mobile/extensions/translate_extensions.dart';
import 'package:immich_mobile/pages/library/spaces/collection_sort.dart';
import 'package:immich_mobile/presentation/widgets/images/thumbnail.widget.dart';
import 'package:immich_mobile/presentation/widgets/spaces/space_album_folder_card.widget.dart';
import 'package:immich_mobile/presentation/widgets/spaces/space_album_folder_picker.widget.dart';
import 'package:immich_mobile/providers/infrastructure/asset.provider.dart';
import 'package:immich_mobile/providers/infrastructure/settings.provider.dart';
import 'package:immich_mobile/providers/infrastructure/space_album.provider.dart';
import 'package:immich_mobile/providers/infrastructure/space_album_actions.dart';
import 'package:immich_mobile/routing/router.dart';
import 'package:immich_mobile/utils/space_album_folders.dart';
import 'package:immich_mobile/widgets/common/collection_sort_button.dart';
import 'package:immich_mobile/widgets/common/immich_toast.dart';
import 'package:immich_mobile/widgets/common/search_field.dart';

/// Space Albums list/manage page — Surface 2 of the Phase-2B design.
///
/// Pushed via [SpaceAlbumsRoute(spaceId, canEdit)] (standard slide-right).
/// [folderId] is optional: `null` is the space root, and tapping a folder
/// card pushes the SAME route one level deeper with `folderId` set to that
/// folder's id — so this page recurses into itself as the user browses the
/// folder tree, and the system back button (including iOS edge-swipe-back)
/// naturally returns to the parent level.
///
/// Renders a 2-column grid of cards (cover + name + asset count + Hidden
/// label), with folder cards (Task 10) rendered above album cards at the
/// current level:
///  - Editor-only card ⋮ overflow (Show/Hide in timeline, Unlink, Move to
///    folder…) — stub callbacks [onToggle]/[onUnlink] (real mutations land
///    in B6); "Move to folder…" is wired directly against
///    [spaceAlbumActionsProvider] since it doesn't need to be shared with
///    the space-detail top sliver's own inline cards.
///  - Editor-only folder-card ⋮ overflow (Rename / Move to folder… / Delete)
///    and app-bar "New folder" action, all wired directly against
///    [spaceAlbumActionsProvider]'s `renameFolder`/`moveFolder`/`deleteFolder`/
///    `createFolder`. "New folder" creates in the CURRENT folder (this page
///    instance's own [folderId] as the parent), not always at the space root.
///  - Editor-only app-bar "＋ Link" action — stub callback [onLink] (link
///    picker lands in B5).
///  - Centered empty state for an empty list, and a folder-specific empty
///    state (distinct — see [_FolderEmptyState]) for an empty folder.
///  - A search field + reversible `CollectionSortButton` (persisted via
///    [AppConfig.spaceAlbums] / [SettingsKey.spaceAlbumsSortMode] /
///    [SettingsKey.spaceAlbumsIsReverse]) and a distinct no-match state when
///    a query filters out every linked album. A non-empty query flattens the
///    search tree-wide (`flattenForSearch`): folders are hidden and every
///    matching album in the space is listed with its folder path.
///
/// Role-gated: affordances only shown when [canEdit] is true.
@RoutePage()
class SpaceAlbumsPage extends HookConsumerWidget {
  final String spaceId;
  final bool canEdit;

  /// `null` is the space root. Set when this instance was pushed by tapping
  /// a folder card one level up.
  final String? folderId;

  /// Called when the editor taps "Show/Hide in timeline" for an album.
  /// No-op default in B3; B6 supplies the real mutation.
  final void Function(String albumId) onToggle;

  /// Called when the editor taps "Unlink from space" for an album.
  /// No-op default in B3; B6 supplies the real mutation + confirm dialog.
  final void Function(String albumId) onUnlink;

  /// Called when the editor taps the "＋ Link" app-bar action.
  /// No-op default in B3; B5 supplies the link picker.
  final VoidCallback onLink;

  const SpaceAlbumsPage({
    super.key,
    required this.spaceId,
    required this.canEdit,
    this.folderId,
    void Function(String albumId)? onToggle,
    void Function(String albumId)? onUnlink,
    VoidCallback? onLink,
  }) : onToggle = onToggle ?? _noop,
       onUnlink = onUnlink ?? _noop,
       onLink = onLink ?? _voidNoop;

  static void _noop(String _) {}
  static void _voidNoop() {}

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final albumsAsync = ref.watch(spaceAlbumsProvider(spaceId));
    final folders = ref.watch(spaceAlbumFoldersProvider(spaceId)).valueOrNull ?? const <SpaceAlbumFolder>[];
    final sortConfig = ref.watch(appConfigProvider.select((config) => config.spaceAlbums));

    final queryController = useTextEditingController();
    final query = useState('');
    useEffect(() {
      void listener() => query.value = queryController.text;
      queryController.addListener(listener);
      return () => queryController.removeListener(listener);
    }, [queryController]);

    // U-11: the folder we're browsing can vanish out from under us at any moment — an incoming
    // sync, not just navigation — so pop reactively rather than only checking at mount. Only
    // react once the stream has ALREADY delivered a real emission (`previous` carried data):
    // the transition from "no data yet" into the very first batch must never pop, since sync
    // simply may not have delivered this folder's row yet (routine, not corrupt state).
    final currentFolderId = folderId;
    ref.listen<AsyncValue<List<SpaceAlbumFolder>>>(spaceAlbumFoldersProvider(spaceId), (previous, next) {
      if (currentFolderId == null) return;
      if (previous?.valueOrNull == null) return;
      final list = next.valueOrNull;
      if (list == null) return;
      if (!list.any((f) => f.id == currentFolderId)) {
        unawaited(context.maybePop());
      }
    });

    // Folder CRUD (app-bar "New folder" + folder-card ⋮). Defined here, above the `albumsAsync`
    // branch, rather than inside `data: (albums) {...}` below: none of these need the album list,
    // and "New folder" is an app-bar action rendered regardless of load/error/data state.
    Future<void> createFolder() async {
      final name = await _promptFolderName(
        context,
        title: 'space_album_folder_new'.t(context: context),
        confirmLabel: 'create'.t(context: context),
      );
      if (name == null) return;
      if (!context.mounted) return;
      try {
        // Creates in the CURRENT folder, not always at the space root — `currentFolderId` is this
        // page instance's own `folderId`, i.e. wherever the user is browsing right now.
        await ref.read(spaceAlbumActionsProvider).createFolder(spaceId, name, parentId: currentFolderId);
      } catch (_) {
        if (context.mounted) {
          ImmichToast.show(
            context: context,
            msg: 'space_album_folder_error_create'.t(context: context),
            toastType: ToastType.error,
          );
        }
      }
    }

    Future<void> renameFolder(SpaceAlbumFolder folder) async {
      final name = await _promptFolderName(
        context,
        title: 'space_album_folder_rename'.t(context: context),
        confirmLabel: 'save'.t(context: context),
        initialName: folder.name,
      );
      if (name == null) return;
      if (!context.mounted) return;
      try {
        await ref.read(spaceAlbumActionsProvider).renameFolder(spaceId, folder.id, name);
      } catch (_) {
        if (context.mounted) {
          ImmichToast.show(
            context: context,
            msg: 'space_album_folder_error_rename'.t(context: context),
            toastType: ToastType.error,
          );
        }
      }
    }

    Future<void> moveFolder(SpaceAlbumFolder folder) async {
      final result = await showSpaceAlbumFolderPicker(
        context,
        folders: folders,
        // The folder itself and its whole subtree must not be offered as a destination — a folder
        // can never become its own descendant. Same guard as the picker sheet's own Task 6
        // `isDescendant` check; passing `excludeFolderId` here is what actually engages it for
        // this call site (the album-move path above passes `null` since an album has no subtree).
        excludeFolderId: folder.id,
        currentFolderId: folder.parentId,
      );
      // Same picked-vs-folderId==null distinction as moveAlbumToFolder below: both a dismissal and
      // picking the root resolve `folderId: null`, so branching on `folderId == null` alone would
      // treat a dismissal as "move to the root".
      if (!result.picked) return;
      if (!context.mounted) return;
      try {
        await ref.read(spaceAlbumActionsProvider).moveFolder(spaceId, folder.id, result.folderId);
      } catch (_) {
        if (context.mounted) {
          ImmichToast.show(
            context: context,
            msg: 'space_album_folder_error_move'.t(context: context),
            toastType: ToastType.error,
          );
        }
      }
    }

    Future<void> deleteFolder(SpaceAlbumFolder folder) async {
      final confirmed = await _confirmDeleteFolder(context, folder);
      if (!confirmed) return;
      if (!context.mounted) return;
      try {
        await ref.read(spaceAlbumActionsProvider).deleteFolder(spaceId, folder.id);
      } catch (_) {
        if (context.mounted) {
          ImmichToast.show(
            context: context,
            msg: 'space_album_folder_error_delete'.t(context: context),
            toastType: ToastType.error,
          );
        }
      }
    }

    return Scaffold(
      appBar: AppBar(
        title: Text(_title(context, folders)),
        centerTitle: false,
        actions: [
          if (canEdit) ...[
            TextButton.icon(
              key: const Key('space-albums-new-folder-action'),
              onPressed: createFolder,
              icon: const Icon(Icons.create_new_folder_outlined),
              label: Text('space_album_folder_new'.t(context: context)),
            ),
            TextButton.icon(
              key: const Key('space-albums-link-action'),
              onPressed: onLink,
              icon: const Icon(Icons.add),
              label: Text('link'.t(context: context)),
            ),
          ],
        ],
      ),
      body: albumsAsync.when(
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (error, _) => Center(
          child: Text('space_albums_load_failed'.t(context: context, args: {'error': error.toString()})),
        ),
        data: (albums) {
          Future<void> moveAlbumToFolder(SpaceAlbum album) async {
            final result = await showSpaceAlbumFolderPicker(
              context,
              folders: folders,
              excludeFolderId: null,
              currentFolderId: album.folderId,
            );
            // Both a dismissal and picking the root resolve `folderId: null` — only `picked`
            // tells them apart. Branching on `folderId == null` alone would treat a dismissal
            // as "move to the root".
            if (!result.picked) return;
            if (!context.mounted) return;
            try {
              await ref.read(spaceAlbumActionsProvider).moveAlbumToFolder(spaceId, album.id, result.folderId);
            } catch (_) {
              if (context.mounted) {
                ImmichToast.show(
                  context: context,
                  msg: 'space_album_folder_error_move'.t(context: context),
                  toastType: ToastType.error,
                );
              }
            }
          }

          final trimmedQuery = query.value.trim();
          final isSearching = trimmedQuery.isNotEmpty;
          final hasQuery = query.value.isNotEmpty;

          void onAlbumTap(String albumId) =>
              context.pushRoute(SpaceAlbumDetailRoute(spaceId: spaceId, albumId: albumId, canEdit: canEdit));

          Future<void> onSortChanged(SpaceAlbumSortMode mode, bool isReverse) async {
            final settings = ref.read(settingsProvider);
            await settings.write(SettingsKey.spaceAlbumsSortMode, mode);
            await settings.write(SettingsKey.spaceAlbumsIsReverse, isReverse);
          }

          if (isSearching) {
            // Restored pre-folder-tree behaviour: a genuinely empty SPACE (not just "this query
            // matched nothing") takes priority over the no-match state, even mid-search — e.g. the
            // last linked album was unlinked elsewhere while the user still had a query typed. The
            // no-match copy implies "try another query", which would be misleading when there is
            // nothing in the space to search at all.
            if (albums.isEmpty) {
              return _EmptyState(key: const Key('space-albums-empty'), canEdit: canEdit, onLink: onLink);
            }

            // U-09: a query escapes the folder tree entirely — folders are hidden and every
            // matching album in the SPACE (not just this level) is listed with its path.
            final hits = flattenForSearch(folders, albums, query.value);

            return Column(
              children: [
                _SearchAndSortBar(
                  controller: queryController,
                  hasQuery: hasQuery,
                  onClear: queryController.clear,
                  resultCount: hits.length,
                  totalCount: albums.length,
                  query: trimmedQuery,
                  sortMode: sortConfig.sortMode,
                  isReverse: sortConfig.isReverse,
                  onSortChanged: onSortChanged,
                ),
                Expanded(
                  // U-13: keep the existing no-match state for the zero-hit case — tree-wide
                  // search must preserve this pre-existing behaviour, not regress to a blank grid.
                  child: hits.isEmpty
                      ? _NoMatch(key: const Key('space-albums-no-match'), query: query.value)
                      : _SearchResultsGrid(
                          hits: hits,
                          canEdit: canEdit,
                          onToggle: onToggle,
                          onUnlink: onUnlink,
                          onMove: moveAlbumToFolder,
                          onTap: onAlbumTap,
                        ),
                ),
              ],
            );
          }

          // U-01/U-04/U-05: level view — only this level's folders and albums (T-08's fallback,
          // via `folderContents`, already keeps a not-yet-synced album's parent from hiding it).
          final contents = folderContents(folders, albums, currentFolderId);
          final sortedFolders = _sortFolders(contents.folders, sortConfig.isReverse);
          final sortedAlbums = filterAndSortSpaceAlbums(contents.albums, '', sortConfig.sortMode, sortConfig.isReverse);

          if (sortedFolders.isEmpty && sortedAlbums.isEmpty) {
            if (currentFolderId != null) {
              // U-05: reusing the space-level empty state here would wrongly claim the space has
              // no albums at all, when it only means THIS folder is empty.
              return const _FolderEmptyState(key: Key('space-album-folder-empty'));
            }
            return _EmptyState(key: const Key('space-albums-empty'), canEdit: canEdit, onLink: onLink);
          }

          return Column(
            children: [
              _SearchAndSortBar(
                controller: queryController,
                hasQuery: hasQuery,
                onClear: queryController.clear,
                resultCount: sortedAlbums.length,
                totalCount: albums.length,
                query: trimmedQuery,
                sortMode: sortConfig.sortMode,
                isReverse: sortConfig.isReverse,
                onSortChanged: onSortChanged,
              ),
              Expanded(
                child: _LevelGrid(
                  folders: sortedFolders,
                  albums: sortedAlbums,
                  allFolders: folders,
                  allAlbums: albums,
                  canEdit: canEdit,
                  onFolderTap: (folder) => context.pushRoute(
                    SpaceAlbumsRoute(
                      spaceId: spaceId,
                      canEdit: canEdit,
                      folderId: folder.id,
                      onLink: onLink,
                      onToggle: onToggle,
                      onUnlink: onUnlink,
                    ),
                  ),
                  onToggle: onToggle,
                  onUnlink: onUnlink,
                  onMove: moveAlbumToFolder,
                  onAlbumTap: onAlbumTap,
                  onRenameFolder: renameFolder,
                  onMoveFolder: moveFolder,
                  onDeleteFolder: deleteFolder,
                ),
              ),
            ],
          );
        },
      ),
    );
  }

  /// The folder's name at depth, the space name at the root (U-01..U-04). Falls back to the
  /// space-level title when [folderId] is set but not (yet) present in [folders] — e.g. the very
  /// first frame, before sync has delivered it — rather than showing nothing.
  String _title(BuildContext context, List<SpaceAlbumFolder> folders) {
    final id = folderId;
    if (id == null) return 'space_albums_page_title'.t(context: context);
    final folder = folders.firstWhereOrNull((f) => f.id == id);
    return folder?.name ?? 'space_albums_page_title'.t(context: context);
  }
}

/// Folders sort by NAME, honouring the current sort direction but ignoring the sort key —
/// `assetCount` and `mostRecentPhoto` do not map onto a folder.
List<SpaceAlbumFolder> _sortFolders(List<SpaceAlbumFolder> folders, bool isReverse) {
  final sorted = [...folders]
    ..sort((a, b) {
      final c = a.name.toLowerCase().compareTo(b.name.toLowerCase());
      return c != 0 ? c : a.id.compareTo(b.id);
    });
  return isReverse ? sorted.reversed.toList() : sorted;
}

/// Prompts for a folder name via a simple text dialog — shared by "New folder" and "Rename".
/// Returns the trimmed name, or `null` if the user cancelled or left it blank — a blank name is
/// treated as "nothing to do" rather than an error, so the caller never fires a doomed API call.
Future<String?> _promptFolderName(
  BuildContext context, {
  required String title,
  required String confirmLabel,
  String initialName = '',
}) async {
  final name = await showDialog<String>(
    context: context,
    builder: (_) => _FolderNameDialog(title: title, confirmLabel: confirmLabel, initialName: initialName),
  );
  if (name == null || name.isEmpty) return null;
  return name;
}

/// The dialog body for [_promptFolderName], mirroring the shape of `NewAlbumNameModal`/
/// `DriftPersonNameEditForm` elsewhere in the app (AlertDialog + TextFormField, Cancel/confirm
/// `TextButton`s), written with this file's `.t()` localisation convention rather than those
/// widgets' older `.tr()` one.
///
/// A **StatefulWidget**, not a bare function building a `TextEditingController` inline: the
/// controller must be disposed only once this widget is actually unmounted (the framework calls
/// `dispose()` for that), not immediately after `showDialog` resolves — the dialog's pop is
/// animated, so the `TextFormField` is still in the tree, still rebuilding, for a moment after the
/// awaited `Future` completes. Disposing right there crashes with "A TextEditingController was
/// used after being disposed."
class _FolderNameDialog extends StatefulWidget {
  const _FolderNameDialog({required this.title, required this.confirmLabel, this.initialName = ''});

  final String title;
  final String confirmLabel;
  final String initialName;

  @override
  State<_FolderNameDialog> createState() => _FolderNameDialogState();
}

class _FolderNameDialogState extends State<_FolderNameDialog> {
  late final TextEditingController _controller = TextEditingController(text: widget.initialName);

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: Text(widget.title),
      content: SingleChildScrollView(
        child: TextFormField(
          key: const Key('space-album-folder-name-field'),
          controller: _controller,
          autofocus: true,
          decoration: InputDecoration(labelText: 'space_album_folder_name_label'.t(context: context)),
          onFieldSubmitted: (value) => Navigator.of(context).pop(value.trim()),
        ),
      ),
      actions: [
        TextButton(
          key: const Key('space-album-folder-name-cancel'),
          onPressed: () => Navigator.of(context).pop(null),
          child: Text('cancel'.t(context: context)),
        ),
        TextButton(
          key: const Key('space-album-folder-name-confirm'),
          onPressed: () => Navigator.of(context).pop(_controller.text.trim()),
          child: Text(widget.confirmLabel),
        ),
      ],
    );
  }
}

/// Confirms folder deletion — mirrors `space_detail.page.dart`'s `_deleteSpace` shape exactly
/// (same AlertDialog + Cancel/error-coloured-delete `TextButton` layout), the established pattern
/// for a destructive action among the other space pages.
Future<bool> _confirmDeleteFolder(BuildContext context, SpaceAlbumFolder folder) async {
  final confirmed = await showDialog<bool>(
    context: context,
    builder: (ctx) => AlertDialog(
      title: Text('space_album_folder_delete'.t(context: ctx)),
      content: Text('space_album_folder_delete_confirm'.t(context: ctx, args: {'name': folder.name})),
      actions: [
        TextButton(
          key: const Key('space-album-folder-delete-cancel'),
          onPressed: () => Navigator.of(ctx).pop(false),
          child: Text('cancel'.t(context: ctx)),
        ),
        TextButton(
          key: const Key('space-album-folder-delete-confirm'),
          onPressed: () => Navigator.of(ctx).pop(true),
          style: TextButton.styleFrom(foregroundColor: Theme.of(ctx).colorScheme.error),
          child: Text('delete'.t(context: ctx)),
        ),
      ],
    ),
  );
  return confirmed == true;
}

// ---------------------------------------------------------------------------
// Search + sort bar
// ---------------------------------------------------------------------------

class _SearchAndSortBar extends StatelessWidget {
  const _SearchAndSortBar({
    required this.controller,
    required this.hasQuery,
    required this.onClear,
    required this.resultCount,
    required this.totalCount,
    required this.query,
    required this.sortMode,
    required this.isReverse,
    required this.onSortChanged,
  });

  final TextEditingController controller;
  final bool hasQuery;
  final VoidCallback onClear;
  final int resultCount;
  final int totalCount;
  final String query;
  final SpaceAlbumSortMode sortMode;
  final bool isReverse;
  final void Function(SpaceAlbumSortMode mode, bool isReverse) onSortChanged;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 8, 16, 4),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SearchField(
            key: const Key('space-albums-search-field'),
            hintText: 'space_albums_search_hint'.t(context: context),
            controller: controller,
            prefixIcon: const Icon(Icons.search_rounded),
            suffixIcon: hasQuery
                ? IconButton(
                    key: const Key('space-albums-search-clear'),
                    icon: const Icon(Icons.clear_rounded),
                    onPressed: onClear,
                  )
                : null,
          ),
          const SizedBox(height: 8),
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Text(
                query.isEmpty
                    ? 'space_albums_result_count'.t(context: context, args: {'count': resultCount.toString()})
                    : 'space_albums_search_result_count'.t(
                        context: context,
                        args: {'count': resultCount.toString(), 'total': totalCount.toString(), 'query': query},
                      ),
                key: const Key('space-albums-result-count'),
                style: context.textTheme.bodySmall?.copyWith(color: context.colorScheme.onSurfaceVariant),
              ),
              CollectionSortButton<SpaceAlbumSortMode>(
                options: SpaceAlbumSortMode.values.map((mode) => (mode: mode, label: mode.label)).toList(),
                current: sortMode,
                isReverse: isReverse,
                onChanged: onSortChanged,
              ),
            ],
          ),
        ],
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Level grid — folders (Task 10) rendered above albums, each its own section
// so folders always land in a strictly earlier row than any album (U-01).
// ---------------------------------------------------------------------------

const _gridDelegate = SliverGridDelegateWithFixedCrossAxisCount(
  crossAxisCount: 2,
  crossAxisSpacing: 12,
  mainAxisSpacing: 16,
  childAspectRatio: 0.75,
);

class _LevelGrid extends StatelessWidget {
  const _LevelGrid({
    required this.folders,
    required this.albums,
    required this.allFolders,
    required this.allAlbums,
    required this.canEdit,
    required this.onFolderTap,
    required this.onToggle,
    required this.onUnlink,
    required this.onMove,
    required this.onAlbumTap,
    required this.onRenameFolder,
    required this.onMoveFolder,
    required this.onDeleteFolder,
  });

  /// This level's folders, already sorted.
  final List<SpaceAlbumFolder> folders;

  /// This level's albums, already filtered + sorted.
  final List<SpaceAlbum> albums;

  /// The whole space's folders/albums — `recursiveAlbumCount`/`folderPreviewAlbums` need the
  /// full subtree, not just this level.
  final List<SpaceAlbumFolder> allFolders;
  final List<SpaceAlbum> allAlbums;
  final bool canEdit;
  final void Function(SpaceAlbumFolder folder) onFolderTap;
  final void Function(String albumId) onToggle;
  final void Function(String albumId) onUnlink;
  final void Function(SpaceAlbum album) onMove;
  final void Function(String albumId) onAlbumTap;
  final void Function(SpaceAlbumFolder folder) onRenameFolder;
  final void Function(SpaceAlbumFolder folder) onMoveFolder;
  final void Function(SpaceAlbumFolder folder) onDeleteFolder;

  @override
  Widget build(BuildContext context) {
    return CustomScrollView(
      slivers: [
        if (folders.isNotEmpty)
          SliverPadding(
            padding: EdgeInsets.fromLTRB(16, 16, 16, albums.isEmpty ? 16 : 0),
            sliver: SliverGrid(
              gridDelegate: _gridDelegate,
              delegate: SliverChildBuilderDelegate((context, index) {
                final folder = folders[index];
                return SpaceAlbumFolderCard(
                  key: Key('space-album-folder-card-${folder.id}'),
                  folder: folder,
                  albumCount: recursiveAlbumCount(allFolders, allAlbums, folder.id),
                  previewAlbums: folderPreviewAlbums(allFolders, allAlbums, folder.id),
                  canEdit: canEdit,
                  onTap: () => onFolderTap(folder),
                  onRename: () => onRenameFolder(folder),
                  onMove: () => onMoveFolder(folder),
                  onDelete: () => onDeleteFolder(folder),
                );
              }, childCount: folders.length),
            ),
          ),
        if (albums.isNotEmpty)
          SliverPadding(
            padding: const EdgeInsets.fromLTRB(16, 16, 16, 16),
            sliver: SliverGrid(
              gridDelegate: _gridDelegate,
              delegate: SliverChildBuilderDelegate((context, index) {
                final album = albums[index];
                return _AlbumCard(
                  key: Key('space-album-card-${album.id}'),
                  album: album,
                  canEdit: canEdit,
                  onToggle: onToggle,
                  onUnlink: onUnlink,
                  onMove: onMove,
                  onTap: onAlbumTap,
                );
              }, childCount: albums.length),
            ),
          ),
      ],
    );
  }
}

// ---------------------------------------------------------------------------
// Search results grid — flattened tree-wide (U-09), each card with its path.
// ---------------------------------------------------------------------------

class _SearchResultsGrid extends StatelessWidget {
  const _SearchResultsGrid({
    required this.hits,
    required this.canEdit,
    required this.onToggle,
    required this.onUnlink,
    required this.onMove,
    required this.onTap,
  });

  final List<FolderSearchHit> hits;
  final bool canEdit;
  final void Function(String albumId) onToggle;
  final void Function(String albumId) onUnlink;
  final void Function(SpaceAlbum album) onMove;
  final void Function(String albumId) onTap;

  @override
  Widget build(BuildContext context) {
    return GridView.builder(
      padding: const EdgeInsets.all(16),
      gridDelegate: _gridDelegate,
      itemCount: hits.length,
      itemBuilder: (context, index) {
        final hit = hits[index];
        return Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Expanded(
              child: _AlbumCard(
                key: Key('space-album-card-${hit.album.id}'),
                album: hit.album,
                canEdit: canEdit,
                onToggle: onToggle,
                onUnlink: onUnlink,
                onMove: onMove,
                onTap: onTap,
              ),
            ),
            if (hit.path.isNotEmpty)
              Padding(
                padding: const EdgeInsets.only(left: 4, top: 2),
                child: Text(
                  hit.path.join(' › '),
                  key: Key('space-album-search-path-${hit.album.id}'),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: context.textTheme.bodySmall?.copyWith(color: context.colorScheme.onSurfaceVariant),
                ),
              ),
          ],
        );
      },
    );
  }
}

// ---------------------------------------------------------------------------
// Album card
// ---------------------------------------------------------------------------

class _AlbumCard extends ConsumerWidget {
  const _AlbumCard({
    super.key,
    required this.album,
    required this.canEdit,
    required this.onToggle,
    required this.onUnlink,
    required this.onMove,
    required this.onTap,
  });

  final SpaceAlbum album;
  final bool canEdit;
  final void Function(String albumId) onToggle;
  final void Function(String albumId) onUnlink;
  final void Function(SpaceAlbum album) onMove;
  final void Function(String albumId) onTap;

  Widget _buildFallback(ColorScheme cs) {
    return Container(
      decoration: BoxDecoration(
        color: cs.surfaceContainerHighest,
        borderRadius: const BorderRadius.all(Radius.circular(16)),
        border: Border.all(color: cs.outline.withValues(alpha: 0.3), width: 1),
      ),
      child: const Center(child: Icon(Icons.photo_album_outlined, size: 40, color: Colors.grey)),
    );
  }

  Widget _buildCoverArt(BuildContext context, WidgetRef ref, ColorScheme cs) {
    final thumbnailId = album.thumbnailAssetId;
    if (thumbnailId == null) return _buildFallback(cs);
    return FutureBuilder<RemoteAsset?>(
      future: ref.read(assetServiceProvider).getRemoteAsset(thumbnailId),
      builder: (context, snapshot) {
        if (snapshot.hasData && snapshot.data != null) {
          return ClipRRect(
            borderRadius: const BorderRadius.all(Radius.circular(16)),
            child: Thumbnail.remote(remoteId: thumbnailId, thumbhash: snapshot.data!.thumbHash ?? ''),
          );
        }
        return _buildFallback(cs);
      },
    );
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final cs = context.colorScheme;
    final isOffTimeline = !album.showInTimeline;

    return GestureDetector(
      // The cover art is an image (Thumbnail) / placeholder that does not
      // register itself in hit-testing, so the default deferToChild behavior
      // makes a tap on the cover — where users actually tap — a no-op (only the
      // name Text was hittable). Opaque makes the whole card tappable.
      behavior: HitTestBehavior.opaque,
      onTap: () => onTap(album.id),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // Cover
          Expanded(
            child: Stack(
              children: [
                Opacity(opacity: isOffTimeline ? 0.6 : 1.0, child: _buildCoverArt(context, ref, cs)),
                // Off-timeline badge
                if (isOffTimeline)
                  Positioned.fill(
                    child: Center(
                      child: Icon(Icons.visibility_off, size: 24, color: cs.onSurface.withValues(alpha: 0.7)),
                    ),
                  ),
              ],
            ),
          ),
          const SizedBox(height: 4),
          // Name + overflow row
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      album.name,
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                      style: context.textTheme.bodySmall?.copyWith(fontWeight: FontWeight.w500),
                    ),
                    Row(
                      children: [
                        Text(
                          'space_album_photo_count'.t(context: context, args: {'count': album.assetCount.toString()}),
                          style: context.textTheme.bodySmall?.copyWith(color: cs.onSurfaceVariant),
                        ),
                        if (isOffTimeline)
                          Text(
                            '· ${'space_albums_hidden'.t(context: context)}',
                            style: context.textTheme.bodySmall?.copyWith(color: cs.onSurfaceVariant),
                          ),
                      ],
                    ),
                  ],
                ),
              ),
              if (canEdit)
                SizedBox(
                  width: 24,
                  height: 24,
                  child: PopupMenuButton<_CardAction>(
                    key: Key('space-album-card-menu-${album.id}'),
                    padding: EdgeInsets.zero,
                    iconSize: 18,
                    onSelected: (action) {
                      switch (action) {
                        case _CardAction.toggle:
                          onToggle(album.id);
                        case _CardAction.unlink:
                          onUnlink(album.id);
                        case _CardAction.move:
                          onMove(album);
                      }
                    },
                    itemBuilder: (ctx) => [
                      PopupMenuItem(
                        value: _CardAction.toggle,
                        child: Text(
                          album.showInTimeline
                              ? 'space_albums_hide_from_space_photos'.t(context: ctx)
                              : 'spaces_linked_albums_show_in_timeline'.t(context: ctx),
                        ),
                      ),
                      PopupMenuItem(
                        value: _CardAction.unlink,
                        child: Text('space_album_unlink_from_space'.t(context: ctx)),
                      ),
                      PopupMenuItem(
                        value: _CardAction.move,
                        child: Text('space_album_folder_move'.t(context: ctx)),
                      ),
                    ],
                  ),
                ),
            ],
          ),
        ],
      ),
    );
  }
}

enum _CardAction { toggle, unlink, move }

// ---------------------------------------------------------------------------
// Empty states
// ---------------------------------------------------------------------------

class _EmptyState extends StatelessWidget {
  const _EmptyState({super.key, required this.canEdit, required this.onLink});

  final bool canEdit;
  final VoidCallback onLink;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Icon(
            Icons.photo_album_outlined,
            size: 64,
            color: context.colorScheme.onSurfaceVariant.withValues(alpha: 0.5),
          ),
          const SizedBox(height: 16),
          Text(
            'space_albums_empty'.t(context: context),
            style: context.textTheme.titleMedium?.copyWith(color: context.colorScheme.onSurfaceVariant),
          ),
          if (canEdit) ...[
            const SizedBox(height: 12),
            FilledButton.icon(
              onPressed: onLink,
              icon: const Icon(Icons.add),
              label: Text('space_albums_empty_editor_cta'.t(context: context)),
            ),
          ],
        ],
      ),
    );
  }
}

/// U-05: a folder that has no subfolders and no albums directly inside it. Distinct from
/// [_EmptyState] — that one wrongly implies the whole SPACE has nothing linked, when it only
/// means THIS folder is empty (the rest of the tree may be full).
class _FolderEmptyState extends StatelessWidget {
  const _FolderEmptyState({super.key});

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Icon(
            Icons.folder_open_outlined,
            size: 64,
            color: context.colorScheme.onSurfaceVariant.withValues(alpha: 0.5),
          ),
          const SizedBox(height: 16),
          Text(
            'space_album_folder_empty'.t(context: context),
            style: context.textTheme.titleMedium?.copyWith(color: context.colorScheme.onSurfaceVariant),
          ),
        ],
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// No-match state (source list non-empty, but the query matches nothing)
// ---------------------------------------------------------------------------

class _NoMatch extends StatelessWidget {
  const _NoMatch({super.key, required this.query});

  final String query;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Icon(Icons.search_off_rounded, size: 64, color: context.colorScheme.onSurfaceVariant.withValues(alpha: 0.5)),
          const SizedBox(height: 16),
          Text(
            'space_albums_no_match'.t(context: context, args: {'query': query}),
            textAlign: TextAlign.center,
            style: context.textTheme.titleMedium?.copyWith(color: context.colorScheme.onSurfaceVariant),
          ),
        ],
      ),
    );
  }
}
