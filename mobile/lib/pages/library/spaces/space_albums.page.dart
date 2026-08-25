import 'dart:async';

import 'package:auto_route/auto_route.dart';
import 'package:collection/collection.dart';
import 'package:flutter/material.dart';
import 'package:flutter_hooks/flutter_hooks.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/domain/models/album/album.model.dart';
import 'package:immich_mobile/domain/models/asset/base_asset.model.dart';
import 'package:immich_mobile/domain/models/settings_key.dart';
import 'package:immich_mobile/domain/models/space_album.model.dart';
import 'package:immich_mobile/domain/models/space_album_folder.model.dart';
import 'package:immich_mobile/extensions/build_context_extensions.dart';
import 'package:immich_mobile/extensions/translate_extensions.dart';
import 'package:immich_mobile/pages/library/spaces/collection_sort.dart';
import 'package:immich_mobile/pages/library/spaces/space_album_folder_errors.dart';
import 'package:immich_mobile/presentation/widgets/images/thumbnail.widget.dart';
import 'package:immich_mobile/presentation/widgets/spaces/space_album_folder_card.widget.dart';
import 'package:immich_mobile/presentation/widgets/spaces/space_album_folder_picker.widget.dart';
import 'package:immich_mobile/providers/infrastructure/album.provider.dart';
import 'package:immich_mobile/providers/infrastructure/asset.provider.dart';
import 'package:immich_mobile/providers/infrastructure/settings.provider.dart';
import 'package:immich_mobile/providers/infrastructure/space_album.provider.dart';
import 'package:immich_mobile/providers/infrastructure/space_album_actions.dart';
import 'package:immich_mobile/routing/router.dart';
import 'package:immich_mobile/utils/space_album_folders.dart';
import 'package:immich_mobile/widgets/common/collection_sort_button.dart';
import 'package:immich_mobile/widgets/common/immich_toast.dart';
import 'package:immich_mobile/widgets/common/search_field.dart';
import 'package:openapi/api.dart' show ApiException;

/// Space Albums list/manage page.
///
/// See `specs/2026-08-05-space-album-folders-mobile-design.md` for the folder behaviour and
/// `specs/2026-06-15-space-albums-phase2-mobile-design.md` for the surrounding surface.
///
/// Pushed via [SpaceAlbumsRoute(spaceId, canEdit)] (standard slide-right).
/// [folderId] is optional: `null` is the space root, and tapping a folder
/// card pushes the SAME route one level deeper with `folderId` set to that
/// folder's id — so this page recurses into itself as the user browses the
/// folder tree, and the system back button (including iOS edge-swipe-back)
/// naturally returns to the parent level.
///
/// Renders a 2-column grid of cards (cover + name + asset count + Hidden
/// label), with folder cards rendered above album cards at the current level:
///  - Editor-only card ⋮ overflow (Show/Hide in timeline, Unlink, Move to
///    folder…). [onToggle] and [onUnlink] are supplied by the caller, because
///    the space-detail page owns those mutations and its top sliver renders
///    the same cards; "Move to folder…" is wired directly against
///    [spaceAlbumActionsProvider] since it is not shared with that sliver.
///  - Editor-only folder-card ⋮ overflow (Rename / Move to folder… / Delete)
///    and app-bar "New folder" action, all wired directly against
///    [spaceAlbumActionsProvider]'s `renameFolder`/`moveFolder`/`deleteFolder`/
///    `createFolder`. "New folder" creates in the CURRENT folder (this page
///    instance's own [folderId] as the parent), not always at the space root.
///  - Editor-only app-bar "＋ Link" action, delegating to [onLink] — the link
///    picker lives on the space-detail page, which owns it.
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
  /// Defaults to a no-op so the page can be rendered standalone (and in tests)
  /// without the space-detail page's mutation wiring.
  final void Function(String albumId) onToggle;

  /// Called when the editor taps "Unlink from space" for an album. The caller
  /// owns the confirm dialog. No-op by default — see [onToggle].
  final void Function(String albumId) onUnlink;

  /// Called when the editor taps the "＋ Link" app-bar action. No-op by
  /// default — see [onToggle].
  ///
  /// Takes the folder the user is currently looking at, so a linked album lands there rather
  /// than at the space root. The picker itself lives on the parent space-detail page, which has
  /// no idea which folder this page is showing — passing it explicitly is what keeps the two in
  /// step when this route is pushed onto itself for a nested folder.
  final void Function(String? folderId) onLink;

  const SpaceAlbumsPage({
    super.key,
    required this.spaceId,
    required this.canEdit,
    this.folderId,
    void Function(String albumId)? onToggle,
    void Function(String albumId)? onUnlink,
    void Function(String? folderId)? onLink,
  }) : onToggle = onToggle ?? _noop,
       onUnlink = onUnlink ?? _noop,
       onLink = onLink ?? _nullableNoop;

  static void _noop(String _) {}
  static void _nullableNoop(String? _) {}

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
    //
    // Folder drill-down pushes THIS SAME route onto itself (see the class doc above), so several
    // instances of this page can be stacked at once, each with its own live `ref.listen`.
    // Surgically removing a BURIED instance's own route in place is NOT safely expressible with
    // auto_route 11.1.0: `AutoRoutePage.canUpdate` keys on the route NAME, not a per-push unique
    // id, and since this route is deliberately self-recursive Flutter's declarative page-diff
    // cannot tell two stacked instances apart — removing a non-topmost one crashes ("setState
    // during build") and silently swaps mounted state between routes.
    //
    // DEFERRED SELF-POP instead:
    //  - Topmost when the folder vanishes: pop immediately — a plain `context.maybePop()` on the
    //    LAST entry is always unambiguous (there's no "which instance?" question for the tail).
    //  - Buried: don't touch the stack now. Record a pending flag and wait for a notification
    //    that the visible route changed, so we notice the instant the routes above us are gone
    //    and we become the visible top ourselves — at which point we pop, before the user can
    //    ever interact with the dead page. One pop-transition frame of the dead page is
    //    acceptable; it settling as the visible page is not.
    //
    //    `StackRouter` (`RoutingController with ChangeNotifier`) is itself a `ChangeNotifier`,
    //    but its OWN `notifyListeners()` does NOT fire for an ordinary pop: `onPopPage`
    //    (routing_controller.dart:1252, called when Flutter's Navigator completes a pop) only
    //    calls `navigationHistory.rebuildUrl()`, never `notifyAll()` — `notifyAll()` (which does
    //    call `notifyListeners()` on the controller, routing_controller.dart:120) is only reached
    //    from explicit stack-mutating calls like `removeRoute`/push, not from a plain pop.
    //    `navigationHistory` (`StackRouter.navigationHistory`, routing_controller.dart:77 — a
    //    public getter, shared with the whole router tree via `root.navigationHistory`) is
    //    itself a *separate* `ChangeNotifier` and IS what actually notifies on every visible-
    //    route change, popped or pushed: `onNewUrlState` (navigation_history_base.dart:48) calls
    //    `notifyListeners()` whenever the computed url/active-segments state differs from before
    //    — exactly "the visible route changed", confirmed against B's pop in this task's tests.
    //
    //    CAVEAT — `navigationHistory` is URL-STRING based, so it can
    //    silently no-op: `onNewUrlState` only notifies when `_urlState != newState`
    //    (navigation_history_base.dart:52), and `UrlState.==` compares route SEGMENTS, which for
    //    two stacked `SpaceAlbumsRoute`s sharing the SAME `folderId` are IDENTICAL before and
    //    after the covering instance pops. This also means the whole mechanism currently leans on
    //    `SpaceAlbumsRouteArgs.==` including `folderId` (router.gr.dart, generated — nothing
    //    enforces this; a generator change could silently widen or narrow it). Rather than depend
    //    on that, `pollNextFrame` below is a URL-string-independent safety net: it reads
    //    `stackData`/`isTopmost()` directly off a scheduled frame, so it still catches the pop
    //    even when `navigationHistory` stays silent.
    //
    //    Identical-args stacking (same `spaceId` AND `folderId`) is now blocked
    //    in PRODUCTION: `SpaceAlbumsRoute` carries `SpaceAlbumsDuplicateGuard`, an args-aware guard
    //    wired at router.dart:179 (`SpacesRoute`/`SpaceDetailRoute`/`SpaceMembersRoute` — the
    //    routes that keep the plain `_duplicateGuard` — are the ones at router.dart:167-169 now;
    //    `SpaceAlbumsRoute` is no longer among them). `pollNextFrame` below is UNCHANGED and stays
    //    exactly as load-bearing as before: this self-pop mechanism must never come to depend on
    //    that guard existing or staying wired — deleting the poll because "the guard already
    //    prevents this" would silently reopen the buried-self-pop bug commit e2e7ef6f6c4 fixed, the
    //    moment anything ever changes how pushes reach this route. The identical-`folderId`
    //    scenario itself stays directly exercised in tests regardless of the production guard: the
    //    U-11 stacked-pages harness (`pumpStackedFolderPagesWithFolderStream`,
    //    space_albums_page_test.dart) deliberately builds its OWN router with no guard at all on
    //    `SpaceAlbumsRoute`, so double-tap-onto-itself stays reachable in test even though
    //    `AppRouter` now blocks it at the push site.
    final currentFolderId = folderId;
    // `useState`, not `useRef`: flipping this must itself be reactive so the `useEffect` below
    // — which only touches `context.router` once there's actually something to wait for — can
    // gate on it. Some of this page's own tests (`pumpPage`'s single-widget harness, used by
    // every non-navigation U-*/M-5 test) pump `SpaceAlbumsPage` directly with no `AutoRouter`
    // ancestor at all; `context.router` throws in that setup, so it must never be touched merely
    // because `folderId != null` — only once a folder has genuinely vanished while buried.
    final pendingSelfPop = useState(false);

    // "Topmost" = this page's own RouteData is the LAST entry in ITS OWN stack router's page
    // list. `stackData` (`List<RouteData> get stackData => ... _pages.map((e) => e.routeData)`)
    // reflects only THIS controller's own pages — same scoping as `current`
    // (`StackRouter.current => currentChild ?? routeData`, auto_route 11.1.0's
    // routing_controller.dart:1126, where `currentChild => _pages.last.routeData`, :1129 — this
    // matches how space_albums_duplicate_guard.dart already describes `router.current`). It's
    // `topRoute` that drills into the topmost NESTED child router instead
    // (`_topMostRouter(...).current`, :1185); `current` does not. So this getter is true only for
    // the visible top of THIS page's stack, exactly what U-02/U-03/U-11's existing tests already
    // assert on via `router.stackData.last`.
    bool isTopmost() {
      final stack = context.router.stackData;
      return stack.isNotEmpty && stack.last.matchId == context.routeData.matchId;
    }

    useEffect(() {
      if (!pendingSelfPop.value) return null;
      final navigationHistory = context.router.navigationHistory;
      var disposed = false;

      // The ONLY place either call site below (the listener and the poll) may act — both funnel
      // through here rather than calling `maybePop` directly:
      // `StackRouter.maybePop` is async, and the listener/poll below aren't torn down until the
      // NEXT rebuild processes `pendingSelfPop.value` flipping to false, so a second notification
      // or scheduled frame landing before that rebuild lands must be a no-op, not a second pop
      // that would take the route BELOW this page with it. Checking-then-clearing the flag
      // SYNCHRONOUSLY, before `maybePop`'s first `await`, is what makes this safe: Dart has no
      // preemption, so no second call from either source can observe the flag as still-true once
      // the first one has cleared it, regardless of which of the two call sites gets there first.
      void trySelfPop() {
        if (disposed || !pendingSelfPop.value) return;
        if (!isTopmost()) return;
        pendingSelfPop.value = false;
        if (context.mounted) unawaited(context.maybePop());
      }

      void onVisibleRouteChanged() => trySelfPop();

      // Safety net for Finding 1 above: reschedules itself one frame at a time for as long as a
      // pop is pending, so it catches "became topmost" even on a frame where `navigationHistory`
      // stayed silent. Deliberately does NOT force a frame (no `scheduleFrame()`): a covering
      // page's pop is itself a Flutter-level exit TRANSITION that drives several frames on its
      // own regardless of any auto_route notification, which is what actually lands this within
      // that "one pop-transition frame" in practice — piggybacking on those is enough to catch
      // Finding 1's edge case (confirmed by the identical-folderId test below), and forcing a
      // frame on every tick while merely BURIED (not yet topmost, still waiting) would mean this
      // page keeps demanding new frames for as long as it stays buried — unbounded, and in a test
      // it means `pumpAndSettle()` never converges. Self-limiting either way: it stops
      // rescheduling the moment `pendingSelfPop.value` goes false (popped, or the folder
      // reappeared — see the `ref.listen` callback below).
      void pollNextFrame() {
        WidgetsBinding.instance.addPostFrameCallback((_) {
          if (disposed || !pendingSelfPop.value) return;
          trySelfPop();
          if (!disposed && pendingSelfPop.value) pollNextFrame();
        });
      }

      navigationHistory.addListener(onVisibleRouteChanged);
      pollNextFrame();
      return () {
        disposed = true;
        navigationHistory.removeListener(onVisibleRouteChanged);
      };
    }, [pendingSelfPop.value]);

    ref.listen<AsyncValue<List<SpaceAlbumFolder>>>(spaceAlbumFoldersProvider(spaceId), (previous, next) {
      if (currentFolderId == null) return;
      if (previous?.valueOrNull == null) return;
      final list = next.valueOrNull;
      if (list == null) return;
      if (!list.any((f) => f.id == currentFolderId)) {
        if (isTopmost()) {
          unawaited(context.maybePop());
        } else {
          pendingSelfPop.value = true;
        }
      } else {
        // A transient false-vanish emission (folder momentarily
        // missing, then present again in a later sync batch) must not leave a stale pending pop
        // armed — otherwise this page would pop itself later, once it resurfaces, even though its
        // folder is valid again.
        pendingSelfPop.value = false;
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
      } catch (error) {
        if (context.mounted) {
          ImmichToast.show(
            context: context,
            msg: _folderErrorKey(error, 'space_album_folder_error_create').t(context: context),
            toastType: ToastType.error,
          );
        }
      }
    }

    // Create a brand-new album straight into this space, mirroring web's handleCreateAlbum:
    // create the album, then link it to the space at the CURRENT folder. Distinct from "Link",
    // which attaches an album that already exists.
    //
    // Creation and the link that follows it are two DIFFERENT failure domains, in two separate
    // try/catch blocks rather than one wrapping both: if creation itself fails, nothing exists and
    // the generic `space_album_error_create` ("Unable to create album") toast is accurate. But if
    // creation SUCCEEDS and only the link fails, the album already exists (unlinked, invisible in
    // this space) — showing that same "Unable to create album" toast would be a lie the user has
    // no way to detect, and would invite a retry that creates a duplicate album. That case gets
    // its own `space_album_error_link_after_create` toast instead, which says what actually
    // happened: the album was created, but could not be added to this space.
    Future<void> createAlbum() async {
      final name = await _promptFolderName(
        context,
        title: 'space_album_new'.t(context: context),
        confirmLabel: 'create'.t(context: context),
      );
      if (name == null) return;
      if (!context.mounted) return;

      final RemoteAlbum? album;
      try {
        album = await ref.read(remoteAlbumProvider.notifier).createAlbum(title: name);
      } catch (error) {
        if (context.mounted) {
          ImmichToast.show(
            context: context,
            msg: 'space_album_error_create'.t(context: context),
            toastType: ToastType.error,
          );
        }
        return;
      }
      if (album == null) return;
      if (!context.mounted) return;

      try {
        // Link at `currentFolderId`, so an album created inside a folder lands there rather than
        // at the space root. Null is correct for the root: the repository omits the query param
        // rather than sending an explicit null, which the server rejects.
        await ref.read(spaceAlbumActionsProvider).link(spaceId, [album.id], folderId: currentFolderId);
      } catch (error) {
        if (context.mounted) {
          ImmichToast.show(
            context: context,
            msg: 'space_album_error_link_after_create'.t(context: context),
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
      } catch (error) {
        if (context.mounted) {
          ImmichToast.show(
            context: context,
            msg: _folderErrorKey(error, 'space_album_folder_error_rename').t(context: context),
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
        // can never become its own descendant. Same guard as the picker sheet's own
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
      } catch (error) {
        if (context.mounted) {
          ImmichToast.show(
            context: context,
            msg: _folderErrorKey(error, 'space_album_folder_error_move').t(context: context),
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
      } catch (error) {
        if (context.mounted) {
          ImmichToast.show(
            context: context,
            msg: _folderErrorKey(error, 'space_album_folder_error_delete').t(context: context),
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
            IconButton(
              key: const Key('space-albums-new-folder-action'),
              onPressed: createFolder,
              icon: const Icon(Icons.create_new_folder_outlined),
              tooltip: 'space_album_folder_new'.t(context: context),
            ),
            IconButton(
              key: const Key('space-albums-new-album-action'),
              onPressed: createAlbum,
              icon: const Icon(Icons.photo_album_outlined),
              tooltip: 'space_album_new'.t(context: context),
            ),
            IconButton(
              key: const Key('space-albums-link-action'),
              onPressed: () => onLink(folderId),
              // Was Icons.add. Stripped of its label, a bare plus does not say
              // what it adds; add_link matches web's mdiLinkVariantPlus.
              icon: const Icon(Icons.add_link),
              tooltip: 'link'.t(context: context),
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
              return _EmptyState(
                key: const Key('space-albums-empty'),
                canEdit: canEdit,
                onLink: () => onLink(folderId),
              );
            }

            // U-09: a query escapes the folder tree entirely — folders are hidden and every
            // matching album in the SPACE (not just this level) is listed with its path.
            final hits = flattenForSearch(folders, albums, query.value);
            // flattenForSearch returns raw server (watchLinkedAlbums) order — re-apply the active
            // sort so a search doesn't silently discard the user's chosen ordering. Mirrors web's
            // space-albums-list.svelte, which re-sorts its own search hits for the same reason.
            final pathByAlbumId = {for (final hit in hits) hit.album.id: hit.path};
            final sortedHitAlbums = filterAndSortSpaceAlbums(
              hits.map((hit) => hit.album).toList(),
              '',
              sortConfig.sortMode,
              sortConfig.isReverse,
            );
            final sortedHits = [for (final a in sortedHitAlbums) FolderSearchHit(a, pathByAlbumId[a.id] ?? const [])];

            return Column(
              children: [
                _SearchAndSortBar(
                  controller: queryController,
                  hasQuery: hasQuery,
                  onClear: queryController.clear,
                  resultCount: sortedHits.length,
                  totalCount: albums.length,
                  query: trimmedQuery,
                  sortMode: sortConfig.sortMode,
                  isReverse: sortConfig.isReverse,
                  onSortChanged: onSortChanged,
                ),
                Expanded(
                  // U-13: keep the existing no-match state for the zero-hit case — tree-wide
                  // search must preserve this pre-existing behaviour, not regress to a blank grid.
                  child: sortedHits.isEmpty
                      ? _NoMatch(key: const Key('space-albums-no-match'), query: query.value)
                      : _SearchResultsGrid(
                          hits: sortedHits,
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
          // Whole-space, so a folder's count and covers still reflect its entire subtree — but
          // computed here, once, rather than inside the grid's per-tile builder.
          final folderSummaries = buildFolderSummaries(folders, albums);

          if (sortedFolders.isEmpty && sortedAlbums.isEmpty) {
            if (currentFolderId != null) {
              // U-05: reusing the space-level empty state here would wrongly claim the space has
              // no albums at all, when it only means THIS folder is empty.
              return const _FolderEmptyState(key: Key('space-album-folder-empty'));
            }
            return _EmptyState(key: const Key('space-albums-empty'), canEdit: canEdit, onLink: () => onLink(folderId));
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
                  folderSummaries: folderSummaries,
                  canEdit: canEdit,
                  onFolderTap: (folder) => context.pushRoute(
                    SpaceAlbumsRoute(
                      spaceId: spaceId,
                      canEdit: canEdit,
                      folderId: folder.id,
                      // Forward the raw callback, NOT one bound to this page's folderId — the
                      // child is a level deeper and must link into its OWN folder.
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

/// Maps a folder-mutation failure to one of the specific `space_album_folder_name_taken` /
/// `space_album_folder_depth_exceeded` / `space_album_folder_limit_reached` keys when the
/// server's error identifies one of those known failure classes, falling back to [fallbackKey]
/// (the action's own generic `space_album_folder_error_*` key) otherwise.
///
/// The server has no machine-readable error code for these — [ApiException.message] is the raw
/// decoded HTTP response body (typically NestJS's `{statusCode, message, error}` JSON) — so this
/// matches on the `message` text `shared-space.service.ts` actually throws:
///   - `createAlbumFolder`/`updateAlbumFolder`'s depth check: "Folder nesting is limited to N
///     levels (this would be M)" (N = SHARED_SPACE_ALBUM_FOLDER_MAX_DEPTH).
///   - `createAlbumFolder`'s count check: "A space is limited to N folders" (N =
///     SHARED_SPACE_ALBUM_FOLDER_MAX_PER_SPACE).
///   - `assertNoAlbumFolderNameConflict`: "A folder with that name already exists here".
/// Both limits are live constants baked into the message, so this checks stable substrings
/// rather than the exact (parameterized) text. Web does not perform this mapping — it shows the
/// raw server message via `handleError` — so there is no web behaviour to mirror here; the three
/// keys these substrings resolve to are the ones the web PR added but never wired up.
/// Only an [ApiException] carries a server message worth matching; anything else (a socket
/// failure, a parse error) goes straight to the caller's generic per-action toast. The matching
/// itself lives in space_album_folder_errors.dart, next to the fragments it depends on.
String _folderErrorKey(Object error, String fallbackKey) {
  if (error is! ApiException) return fallbackKey;
  return spaceAlbumFolderErrorKey(error.message, fallbackKey);
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
// Level grid — folders rendered above albums, each its own section
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
    required this.folderSummaries,
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

  /// Every folder's recursive count and preview covers, built ONCE per (folders, albums) change
  /// by `buildFolderSummaries`. Computing them here, per tile in the builder below, re-scanned
  /// the whole space for each folder on screen — see buildFolderSummaries for the arithmetic.
  final Map<String, FolderSummary> folderSummaries;
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
                final summary = folderSummaries[folder.id] ?? FolderSummary.empty;
                return SpaceAlbumFolderCard(
                  key: Key('space-album-folder-card-${folder.id}'),
                  folder: folder,
                  albumCount: summary.albumCount,
                  previewAlbums: summary.previewAlbums,
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
