<script lang="ts">
  import { goto, invalidateAll, onNavigate } from '$app/navigation';
  import UserPageLayout from '$lib/components/layouts/UserPageLayout.svelte';
  import AlbumTitle from '$lib/components/album-page/AlbumTitle.svelte';
  import AlbumDescription from '$lib/components/album-page/AlbumDescription.svelte';
  import AlbumSummary from '$lib/components/album-page/AlbumSummary.svelte';
  import { Route } from '$lib/route';
  import { isSpaceAlbumRoute } from '$lib/utils/navigation';
  import FilterPanel from '$lib/components/filter-panel/filter-panel.svelte';
  import FilterToggleButton from '$lib/components/filter-panel/filter-toggle-button.svelte';
  import ActiveFiltersBar from '$lib/components/filter-panel/active-filters-bar.svelte';
  import ControlAppBar from '$lib/components/shared-components/ControlAppBar.svelte';
  import SelectionToolbar from '$lib/components/timeline/SelectionToolbar.svelte';
  import Timeline from '$lib/components/timeline/Timeline.svelte';
  import ScopedSearchButton from '$lib/components/search/scoped-search-button.svelte';
  import TimelineGroupingControl from '$lib/components/timeline/TimelineGroupingControl.svelte';
  import { assetMultiSelectManager, AssetMultiSelectManager } from '$lib/managers/asset-multi-select-manager.svelte';
  import { authManager } from '$lib/managers/auth-manager.svelte';
  import { globalSearchManager } from '$lib/managers/global-search-manager.svelte';
  import { TimelineManager } from '$lib/managers/timeline-manager/timeline-manager.svelte';
  import type { TimelineAsset } from '$lib/managers/timeline-manager/types';
  import { buildAlbumAssetPickerOptions, buildSpaceAlbumAssetPickerOptions } from '$lib/utils/album-filter-options';
  import { createAlbumPickerFilters, createAlbumTimeline } from '$lib/gallery/filtered-timeline/album-timeline';
  import { getTimelineManagerTimeBuckets } from '$lib/utils/timeline-zoom-navigation';
  import { addAssetsToAlbumWithOutcome, getAlbumAssetsActions, handleDeleteAlbum } from '$lib/services/album.service';
  import SmartSearchResults from '$lib/components/search/smart-search-results.svelte';
  import SharedLinkCreateModal from '$lib/modals/SharedLinkCreateModal.svelte';
  import { lang } from '$lib/stores/preferences.store';
  import {
    AlbumUserRole,
    getAlbumInfo,
    SharedSpaceRole,
    updateAlbumInfo,
    type AlbumResponseDto,
    type SharedSpaceMemberResponseDto,
    type SharedSpaceResponseDto,
  } from '@immich/sdk';
  import HeaderActionButton from '$lib/components/HeaderActionButton.svelte';
  import { Icon, IconButton, modalManager, toastManager } from '@immich/ui';
  import { handleError } from '$lib/utils/handle-error';
  import { mdiArrowLeft, mdiImageOutline, mdiImagePlusOutline, mdiLink } from '@mdi/js';
  import { t } from 'svelte-i18n';
  import type { PageData } from './$types';

  interface Props {
    data: PageData;
  }

  let { data }: Props = $props();

  const space: SharedSpaceResponseDto = $derived(data.space);
  const members: SharedSpaceMemberResponseDto[] = $derived(data.members);
  let album = $state<AlbumResponseDto>(data.album);

  // Mode: 'browse' shows the album timeline; 'add' shows the asset picker
  let mode = $state<'browse' | 'add'>('browse');

  let timelineManager = $state<TimelineManager>() as TimelineManager;
  let pickerTimelineManager = $state<TimelineManager>() as TimelineManager;

  // Picker multi-select manager (mirrors global album page's timelineMultiSelectManager)
  const pickerMultiSelectManager = new AssetMultiSelectManager();

  // Independent filter state per mode (mirrors the global album page). Browse filters are
  // URL-backed: the album is a searchable page, so ⌘K writes its filters here.
  const filtered = createAlbumTimeline({
    name: 'space-album',
    getAlbum: () => album,
    getTimelineManager: () => timelineManager,
    isBrowse: () => mode === 'browse',
  });
  const picker = createAlbumPickerFilters();

  const currentMember = $derived(members.find((m) => m.userId === authManager.user.id));
  const isSpaceEditor = $derived(
    currentMember?.role === SharedSpaceRole.Owner || currentMember?.role === SharedSpaceRole.Editor,
  );
  const isAlbumEditor = $derived(
    album.albumUsers.some(
      (au) =>
        au.user.id === authManager.user.id && (au.role === AlbumUserRole.Owner || au.role === AlbumUserRole.Editor),
    ),
  );
  const canManage = $derived(isSpaceEditor || isAlbumEditor);

  // Match the regular album flow: an abandoned empty + unnamed album (created here and left without a
  // title or any photos) is cleaned up on navigate-away. Deleting it also drops the shared_space_album
  // link (FK cascade), so it won't linger as a nameless, empty card in the space.
  onNavigate(async ({ to }) => {
    if (!isSpaceAlbumRoute(to?.route.id) && album.assetCount === 0 && !album.albumName) {
      await handleDeleteAlbum(album, { notify: false, prompt: false });
    }
  });

  const browseEmpty = $derived(filtered.isLoadedEmpty && filtered.activeFilterCount === 0);
  const showBrowseFilteredEmpty = $derived(filtered.isLoadedEmpty && filtered.activeFilterCount > 0);
  // Album-scoped, never space-scoped: see createAlbumTimeline.
  const searchAlbumIds = $derived([album.id]);

  const pickerTotal = $derived(pickerTimelineManager?.assetCount ?? 0);
  const pickerHasMonths = $derived((pickerTimelineManager?.months?.length ?? 0) > 0);
  const isPickerEmpty = $derived(
    pickerTimelineManager?.isInitialized && !pickerHasMonths && pickerTotal === 0 && picker.activeCount === 0,
  );
  const showPickerFilteredEmpty = $derived(
    pickerTimelineManager?.isInitialized && !pickerHasMonths && pickerTotal === 0 && picker.activeCount > 0,
  );
  const pickerTimeBuckets = $derived(getTimelineManagerTimeBuckets(pickerTimelineManager));

  // 'mine' = the caller's own timeline (the long-standing behaviour). 'space' = the space pool,
  // which also surfaces other members' photos; adding those goes through the #764 contribution
  // path, exactly like the space timeline's "+". Space Owner/Editor only — see pickerCanUseSpace.
  let pickerSource = $state<'mine' | 'space'>('mine');
  const pickerCanUseSpace = $derived(isSpaceEditor);
  const pickerOptions = $derived(
    pickerSource === 'space' && pickerCanUseSpace
      ? buildSpaceAlbumAssetPickerOptions(space.id, album.id, picker.filters)
      : buildAlbumAssetPickerOptions(album.id, picker.filters),
  );

  const setPickerSource = (source: 'mine' | 'space') => {
    if (source === pickerSource) {
      return;
    }
    // A selection must never span both pools: the two sources are different queries and the
    // add call is built from whatever is selected when it fires.
    pickerMultiSelectManager.clear();
    pickerSource = source;
  };

  const refreshAlbum = async () => {
    album = await getAlbumInfo({ id: album.id });
  };

  // RemoveFromAlbumAction already re-fetches the album via bind:album and clears the selection
  // before firing onRemove, so this only prunes the view and defensively clears.
  const handleRemoveAssets = (assetIds: string[]) => {
    filtered.onAssetDelete(assetIds);
    assetMultiSelectManager.clear();
  };

  // DeleteAssets already performed the server-side trash before calling this. Unlike the space
  // timeline page (which has `<OnEvents onAssetsDelete={refreshSpace} />` to pick up
  // server-truth counts after a trash), this page has no such websocket wiring — mirroring the
  // space-person page's identical reasoning — so force a data reload here to keep
  // album.assetCount in sync with the server.
  const handleAssetDelete = (assetIds: string[]) => {
    filtered.onAssetDelete(assetIds);
    void invalidateAll();
  };

  // Cover setter for the full toolbar's "set_as_album_cover" menu item (canManage-gated, single
  // asset only — see getSelectionCapabilities' canSetCover). Mirrors the regular album page's
  // `updateThumbnailUsingCurrentSelection`; this route has no dedicated SELECT_THUMBNAIL mode, so
  // it always operates on the current bulk selection.
  const handleSetAlbumCover = async () => {
    const assets = assetMultiSelectManager.assets;
    if (assets.length !== 1) {
      return;
    }
    try {
      await updateAlbumInfo({ id: album.id, updateAlbumDto: { albumThumbnailAssetId: assets[0].id } });
      await refreshAlbum();
      toastManager.primary($t('album_cover_updated'));
      assetMultiSelectManager.clear();
    } catch (error) {
      handleError(error, $t('errors.unable_to_update_album_cover'));
    }
  };

  function resetPicker() {
    picker.reset();
    pickerMultiSelectManager.clear();
    filtered.grouping = 'day';
    filtered.temporalAnchor = undefined;
  }

  function enterAddMode() {
    resetPicker();
    mode = 'add';
  }

  const handleExitAddMode = () => {
    resetPicker();
    mode = 'browse';
  };

  const handleAddAssetsSuccess = async (added: TimelineAsset[] = []) => {
    timelineManager?.upsertAssets(added);
    resetPicker();
    mode = 'browse';
    await refreshAlbum();
  };

  // Navigating straight from one album to a sibling (the sidebar drill-down) keeps this component
  // instance alive — SvelteKit only swaps `data`. Local album-scoped state therefore has to be
  // re-seeded by hand (from the URL, which carries the sibling's query and filters), or the URL
  // changes while the page keeps rendering the album we came from.
  // `pre` so the switch re-seeds the controller before its URL effect sees the new URL.
  $effect.pre(() => {
    if (data.album.id === album.id) {
      return;
    }

    album = data.album;
    mode = 'browse';
    filtered.reset();
    assetMultiSelectManager.clear();
    resetPicker();
  });

  const { AddAssets, Upload } = $derived(getAlbumAssetsActions($t, album, pickerMultiSelectManager.assets));
</script>

<!-- Header shows the space (context/breadcrumb); the album name lives in the editable AlbumTitle in the
     timeline below, mirroring the regular album page (which has no page-header title). -->
<UserPageLayout hideNavbar={assetMultiSelectManager.selectionActive} title={space.name}>
  {#snippet leading()}
    <IconButton
      variant="ghost"
      shape="round"
      color="secondary"
      aria-label={$t('back')}
      onclick={() => void goto(Route.viewSpaceAlbums({ id: space.id, folderId: data.folderId }))}
      icon={mdiArrowLeft}
    />
  {/snippet}

  {#snippet buttons()}
    {#if canManage && mode === 'browse'}
      <IconButton
        variant="ghost"
        shape="round"
        color="secondary"
        aria-label={$t('space_album_add_photos')}
        data-testid="add-photos-button"
        onclick={enterAddMode}
        icon={mdiImagePlusOutline}
      />
    {/if}
    <!--
      #1018: a link for the whole album, covering what the SPACE shows — the album's own photos plus
      the cross-owner contributions members made to it. Gated on the space role rather than
      `canManage`: the server authorizes a space-scoped link against Owner/Editor of the space, so an
      album editor who is only a space Viewer would be rejected.
    -->
    {#if isSpaceEditor && mode === 'browse'}
      <IconButton
        variant="ghost"
        shape="round"
        color="secondary"
        aria-label={$t('create_link_to_share')}
        data-testid="space-album-create-link-button"
        onclick={() => void modalManager.show(SharedLinkCreateModal, { albumId: album.id, spaceId: space.id })}
        icon={mdiLink}
      />
    {/if}
  {/snippet}

  {#if mode === 'browse'}
    <div class="flex h-full">
      {#if !assetMultiSelectManager.selectionActive}
        <!-- Keyed on the search too: switching between browse and query mode swaps the whole
             suggestions provider, so the panel has to re-run it rather than keep browse facets. -->
        {#key filtered.showSearchResults ? `${filtered.panelKey}:${$lang}` : filtered.panelKey}
          <FilterPanel
            config={filtered.panelConfig}
            bind:filters={filtered.filters}
            bind:collapsed={filtered.filterCollapsed}
            externalToggle
            timeBuckets={filtered.panelTimeBuckets}
            storageKey={filtered.storageKey}
            hidden={filtered.isTimelineEmpty}
            personNames={filtered.personNames}
            tagNames={filtered.tagNames}
            onFiltersChange={filtered.onFiltersChange}
          />
        {/key}
      {/if}

      <div class="flex flex-1 flex-col overflow-hidden pl-2">
        {#if !assetMultiSelectManager.selectionActive}
          <div
            class="mb-2 shrink-0 items-center gap-2 bg-transparent py-2 pe-4 dark:bg-transparent {filtered.filterCollapsed &&
            !browseEmpty
              ? 'flex ps-2'
              : 'hidden ps-4 md:flex'}"
          >
            {#if filtered.filterCollapsed && !browseEmpty}
              <!-- Visible at EVERY viewport: the panel's own collapse control has no breakpoint gate,
                   so the reopen affordance can't be desktop-only either (#752 launch review F3). -->
              <FilterToggleButton
                active={filtered.activeFilterCount > 0}
                onExpand={() => (filtered.filterCollapsed = false)}
              />
            {/if}
            <div class="hidden md:flex md:items-center" data-testid="timeline-desktop-grouping-control">
              <TimelineGroupingControl grouping={filtered.grouping} onGroupingChange={filtered.onGroupingChange} />
            </div>
            <!-- #1051: the "search here" affordance, desktop-only to match the grouping pill beside it.
                 Below md the nav bar's own magnifier opens the same page-scoped palette. -->
            <div class="hidden md:flex md:items-center" data-testid="space-album-toolbar-search">
              <ScopedSearchButton onclick={() => globalSearchManager.open()} />
            </div>
          </div>
        {/if}

        {#if filtered.hasActiveFilters}
          <div class="mb-4 shrink-0">
            <ActiveFiltersBar
              filters={filtered.filters}
              resultCount={filtered.resultCount}
              personNames={filtered.personNames}
              tagNames={filtered.tagNames}
              onRemoveFilter={filtered.onRemoveFilter}
              onClearAll={filtered.onClearAll}
              searchQuery={filtered.query}
              onClearSearch={filtered.clearSearch}
              onAddAllToCollection={filtered.onAddAllToCollection}
            />
          </div>
        {/if}

        {#if filtered.showSearchResults}
          <SmartSearchResults
            searchQuery={filtered.query}
            bind:isLoading={filtered.isLoading}
            bind:results={filtered.searchResults}
            reloadToken={filtered.searchReloadToken}
            filters={filtered.filters}
            albumIds={searchAlbumIds}
            language={$lang}
            space={{ id: space.id, canWrite: isSpaceEditor }}
            isShared={album.shared}
            total={filtered.smartFacetTotal}
          />
        {:else if showBrowseFilteredEmpty}
          <div class="flex flex-1 flex-col items-center justify-center gap-2" data-testid="browse-filtered-empty">
            <p class="text-sm text-gray-500 dark:text-gray-400">{$t('space_album_no_photos_match_filters')}</p>
            <!-- The filters are URL-backed: onClearAll writes the URL, or a refresh restores them. -->
            <button
              type="button"
              data-testid="browse-clear-filters"
              class="text-sm text-(--primary)"
              onclick={filtered.onClearAll}
            >
              {$t('space_album_clear_all_filters')}
            </button>
          </div>
        {:else}
          <Timeline
            enableRouting={true}
            options={filtered.options}
            bind:timelineManager
            assetInteraction={assetMultiSelectManager}
            isSelectionMode={false}
            singleSelect={false}
            space={{ id: space.id, canWrite: isSpaceEditor }}
            {...filtered.timelineProps}
          >
            <!-- Editable album header (Timeline leading content — always rendered, incl. for an empty
                 album so it can be named). Album-editor-gated (owner or album editor), mirroring the regular
                 album page and the server's Permission.AlbumUpdate; a Space role alone does not grant it. Unlike that
                 page, the header + period control already sit above, so it needs almost no top padding. -->
            <section class="pt-2">
              <AlbumTitle
                id={album.id}
                albumName={album.albumName}
                isEditor={isAlbumEditor}
                onUpdate={(albumName) => (album = { ...album, albumName })}
              />
              {#if album.assetCount > 0}
                <AlbumSummary {album} />
              {/if}
              <AlbumDescription
                id={album.id}
                isEditor={isAlbumEditor}
                bind:description={() => album.description, (description) => (album = { ...album, description })}
              />
            </section>

            {#snippet empty()}
              <section class="mt-50 flex place-content-center place-items-center">
                <div class="flex flex-col items-center gap-4 text-center">
                  <Icon icon={mdiImageOutline} size="3.5em" class="text-gray-400" />
                  <p class="text-lg text-gray-500 dark:text-gray-400">{$t('no_assets_to_show')}</p>
                  {#if canManage}
                    <button
                      type="button"
                      data-testid="empty-add-photos-button"
                      class="text-sm text-(--primary)"
                      onclick={enterAddMode}
                    >
                      {$t('add_photos')}
                    </button>
                  {/if}
                </div>
              </section>
            {/snippet}
          </Timeline>
        {/if}
      </div>
    </div>
  {/if}
</UserPageLayout>

<!-- Browse selection toolbar (shows when assets are selected in browse mode). Rendered OUTSIDE
     UserPageLayout: its wrapper is `relative z-0`, which is a stacking context, so a toolbar nested
     inside it (and before the Timeline) paints UNDER the asset grid and the z-1 scrubber. Matching the
     other timeline pages (recently-added/favorites/space timeline/…), the bar sits after the layout so
     it paints on top.

     rbac-5/albums-8 REVERSED (Slice 6): this route now renders the full album-equivalent
     <SelectionToolbar> — the same component the regular album page and the direct-space/space-person
     timelines use — instead of the stripped Download+Remove-only bar it originally shipped with. Two
     RBAC facts make the reversal safe:
       - Owner-gated mutations (Share/Add-to-album/Favorite/Archive/SetVisibility/Delete) are gated
         by `sel.isAllUserOwned` in getSelectionCapabilities, and the server's AssetUpdate access check
         (access.ts:155-159) checks asset OWNERSHIP first, before any album/space role: `isOwner =
         checkOwnerAccess(...)` is unioned with the space-editor arm, so an owner editing their own asset
         is NEVER blocked by the album path. Exposing these actions here for an all-owned selection is
         exactly as safe as on the regular album page.
       - `canRemoveFromAlbum` stays `canManage`-only (space.canWrite || album.isEditor) — ownership alone
         never grants it — because the server's `AlbumAssetDelete` is role-gated
         (shared-space-album-scope.guard.spec.ts pins this): a non-manager can't remove even their own
         asset from the album (decision C).
     #734: Rotate/ChangeDate/ChangeDescription/ChangeLocation (`canEditMetadata`) and Tag (`canTag`)
     are no longer all-or-nothing ownership — a space Owner/Editor can now bulk-edit/tag the
     *editable subset* of a mixed selection too (resolved via `POST /assets/editable`, same access
     rule as the single-asset viewer's `canEditAsset`). Archive/SetVisibility split out into
     `canSetVisibility`, which DID stay `isAllUserOwned`-only: rbac-3 restricts visibility changes
     to owned assets regardless of space role. -->
{#if mode === 'browse' && assetMultiSelectManager.selectionActive}
  <SelectionToolbar
    timelineManager={filtered.showSearchResults ? undefined : timelineManager}
    assetInteraction={assetMultiSelectManager}
    {album}
    space={{ id: space.id, canWrite: isSpaceEditor, members }}
    downloadFilename={`${album.albumName}.zip`}
    onSelectAll={filtered.onSelectAll}
    onRemove={handleRemoveAssets}
    onSetCover={handleSetAlbumCover}
    onFavorite={filtered.onFavorite}
    onArchive={filtered.onArchive}
    onVisibilitySet={filtered.onSetVisibility}
    onAssetDelete={handleAssetDelete}
    onUndoDelete={filtered.onUndoDelete}
  />
{/if}

{#if mode === 'add'}
  <section class="fixed inset-0 z-40 bg-immich-bg dark:bg-immich-dark-bg" data-testid="add-photos-overlay">
    <!--
      The sidebar + picker Timeline live inside <main>; the ControlAppBar is rendered AFTER it. The
      bar is `position: absolute` with auto z-index, so it would be painted under the full-height
      <main> (swallowing clicks on the trailing Upload/Add buttons) if it came first. Keeping it last
      — as the global album page does — lets it paint on top while staying pinned to the top.
    -->
    <main class="relative h-dvh overflow-hidden pt-(--control-bar-height)" data-testid="add-photos-timeline-main">
      <div class="flex h-full">
        {#key `space-album-picker-${album.id}`}
          <FilterPanel
            config={picker.config}
            bind:filters={picker.filters}
            timeBuckets={pickerTimeBuckets}
            storageKey="gallery-filter-visible-sections-space-album-picker"
            hidden={isPickerEmpty}
          />
        {/key}
        <div class="flex flex-1 flex-col overflow-hidden px-2 md:px-6">
          {#if pickerCanUseSpace}
            <!-- Source switch: the picker has always browsed the caller's own photos, which meant
                 a space album could not pull in another member's photo even though the space
                 timeline's "+" can push that same photo into that same album. -->
            <!-- Wraps and truncates rather than clipping: the filter panel is a fixed w-64 that does
                 not shrink, so on a narrow viewport this column can be ~120px wide, and the parent
                 is overflow-hidden — a fixed-width segmented control would simply be cut in half. -->
            <div
              class="mb-3 flex max-w-full shrink-0 flex-wrap items-center gap-1 self-start rounded-lg bg-gray-100 p-1 dark:bg-gray-800"
              role="group"
              aria-label={$t('space_album_picker_source')}
              data-testid="picker-source-toggle"
            >
              <button
                type="button"
                data-testid="picker-source-mine"
                aria-pressed={pickerSource === 'mine'}
                class="min-w-0 truncate rounded-md px-3 py-1 text-sm transition-colors"
                class:bg-white={pickerSource === 'mine'}
                class:dark:bg-gray-900={pickerSource === 'mine'}
                class:font-semibold={pickerSource === 'mine'}
                onclick={() => setPickerSource('mine')}
              >
                {$t('space_album_picker_source_mine')}
              </button>
              <button
                type="button"
                data-testid="picker-source-space"
                aria-pressed={pickerSource === 'space'}
                class="min-w-0 truncate rounded-md px-3 py-1 text-sm transition-colors"
                class:bg-white={pickerSource === 'space'}
                class:dark:bg-gray-900={pickerSource === 'space'}
                class:font-semibold={pickerSource === 'space'}
                onclick={() => setPickerSource('space')}
              >
                {$t('space_album_picker_source_space')}
              </button>
            </div>
          {/if}

          {#if picker.activeCount > 0}
            <div class="mb-4 shrink-0">
              <ActiveFiltersBar
                filters={picker.filters}
                resultCount={pickerTotal}
                personNames={picker.personNames}
                tagNames={picker.tagNames}
                onRemoveFilter={picker.onRemoveFilter}
                onClearAll={picker.onClearAll}
              />
            </div>
          {/if}

          {#if showPickerFilteredEmpty}
            <div class="flex flex-1 flex-col items-center justify-center gap-2" data-testid="picker-filtered-empty">
              <p class="text-sm text-gray-500 dark:text-gray-400">{$t('space_album_no_photos_to_add_match_filters')}</p>
              <button
                type="button"
                data-testid="picker-clear-filters"
                class="text-sm text-(--primary)"
                onclick={picker.onClearAll}
              >
                {$t('space_album_clear_all_filters')}
              </button>
            </div>
          {:else}
            <Timeline
              enableRouting={false}
              options={pickerOptions}
              bind:timelineManager={pickerTimelineManager}
              assetInteraction={pickerMultiSelectManager}
              isSelectionMode={true}
              singleSelect={false}
            />
          {/if}
        </div>
      </div>
    </main>
    <ControlAppBar onClose={handleExitAddMode}>
      {#snippet leading()}
        <p class="text-lg dark:text-immich-dark-fg">
          {#if !pickerMultiSelectManager.selectionActive}
            {$t('add_to_album')}
          {:else}
            {$t('selected_count', { values: { count: pickerMultiSelectManager.assets.length } })}
          {/if}
        </p>
      {/snippet}

      {#snippet trailing()}
        <HeaderActionButton action={Upload} />
        <HeaderActionButton
          action={{
            ...AddAssets,
            onAction: () => {
              const selected = pickerMultiSelectManager.assets;
              void addAssetsToAlbumWithOutcome(
                album.id,
                selected.map(({ id }) => id),
                { notify: true },
              ).then(({ ok, addedIds, deniedIds }) => {
                // The server answers 200 with per-asset outcomes, so only paint in what it
                // actually accepted — a denied asset would otherwise appear and then vanish on
                // reload. Stay in the picker only when the server genuinely REFUSED something and
                // nothing landed; a selection that was entirely duplicates has nothing left to do,
                // so it closes like any other success rather than trapping the user.
                if (!ok || (addedIds.length === 0 && deniedIds.length > 0)) {
                  return;
                }
                const accepted = new Set(addedIds);
                return handleAddAssetsSuccess(selected.filter(({ id }) => accepted.has(id)));
              });
            },
          }}
        />
      {/snippet}
    </ControlAppBar>
  </section>
{/if}
