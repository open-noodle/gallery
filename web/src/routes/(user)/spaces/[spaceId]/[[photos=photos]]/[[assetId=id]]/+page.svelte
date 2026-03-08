<script lang="ts">
  import { goto } from '$app/navigation';
  import OnEvents from '$lib/components/OnEvents.svelte';
  import UserPageLayout from '$lib/components/layouts/user-page-layout.svelte';
  import ControlAppBar from '$lib/components/shared-components/control-app-bar.svelte';
  import ButtonContextMenu from '$lib/components/shared-components/context-menu/button-context-menu.svelte';
  import SpaceMap from '$lib/components/spaces/space-map.svelte';
  import ArchiveAction from '$lib/components/timeline/actions/ArchiveAction.svelte';
  import ChangeDate from '$lib/components/timeline/actions/ChangeDateAction.svelte';
  import ChangeDescription from '$lib/components/timeline/actions/ChangeDescriptionAction.svelte';
  import ChangeLocation from '$lib/components/timeline/actions/ChangeLocationAction.svelte';
  import DownloadAction from '$lib/components/timeline/actions/DownloadAction.svelte';
  import FavoriteAction from '$lib/components/timeline/actions/FavoriteAction.svelte';
  import RemoveFromSpaceAction from '$lib/components/timeline/actions/RemoveFromSpaceAction.svelte';
  import SelectAllAssets from '$lib/components/timeline/actions/SelectAllAction.svelte';
  import TagAction from '$lib/components/timeline/actions/TagAction.svelte';
  import AssetSelectControlBar from '$lib/components/timeline/AssetSelectControlBar.svelte';
  import Timeline from '$lib/components/timeline/Timeline.svelte';
  import { TimelineManager } from '$lib/managers/timeline-manager/timeline-manager.svelte';
  import { eventManager } from '$lib/managers/event-manager.svelte';
  import SpaceMembersModal from '$lib/modals/SpaceMembersModal.svelte';
  import { Route } from '$lib/route';
  import { AssetInteraction } from '$lib/stores/asset-interaction.svelte';
  import { preferences, user } from '$lib/stores/user.store';
  import { cancelMultiselect } from '$lib/utils/asset-utils';
  import { handleError } from '$lib/utils/handle-error';
  import {
    addAssets,
    AssetVisibility,
    getSpace,
    removeSpace,
    Role,
    searchSmart,
    updateMemberTimeline,
    type AssetResponseDto,
    type SharedSpaceMemberResponseDto,
    type SharedSpaceResponseDto,
  } from '@immich/sdk';
  import { Icon, IconButton, LoadingSpinner, modalManager, toastManager } from '@immich/ui';
  import {
    mdiAccountMultipleOutline,
    mdiClose,
    mdiDeleteOutline,
    mdiDotsVertical,
    mdiEyeOffOutline,
    mdiEyeOutline,
    mdiImagePlusOutline,
    mdiMagnify,
    mdiPlus,
  } from '@mdi/js';
  import { t } from 'svelte-i18n';
  import type { PageData } from './$types';

  type ViewMode = 'view' | 'select-assets';

  interface Props {
    data: PageData;
  }

  let { data }: Props = $props();
  let space: SharedSpaceResponseDto = $state(data.space);
  let members: SharedSpaceMemberResponseDto[] = $state(data.members);
  let viewMode = $state<ViewMode>('view');

  let timelineManager = $state<TimelineManager>() as TimelineManager;

  const assetInteraction = new AssetInteraction();
  const timelineInteraction = new AssetInteraction();

  const currentMember = $derived(members.find((m) => m.userId === $user.id));
  const isOwner = $derived(currentMember?.role === Role.Owner);
  const isEditor = $derived(currentMember?.role === Role.Owner || currentMember?.role === Role.Editor);
  const showInTimeline = $derived(currentMember?.showInTimeline ?? true);

  const options = $derived.by(() => {
    if (viewMode === 'select-assets') {
      return { visibility: AssetVisibility.Timeline, timelineSpaceId: space.id };
    }
    return { spaceId: space.id };
  });

  const currentAssetInteraction = $derived(viewMode === 'select-assets' ? timelineInteraction : assetInteraction);
  const isSelectionMode = $derived(viewMode === 'select-assets');

  const refreshSpace = async () => {
    space = await getSpace({ id: space.id });
  };

  const handleEscape = () => {
    if (showSearchResults) {
      clearSearch();
      return;
    }
    if (viewMode === 'select-assets') {
      handleCloseSelectAssets();
      return;
    }
    if (assetInteraction.selectionActive) {
      cancelMultiselect(assetInteraction);
      return;
    }
    void goto(Route.spaces());
  };

  const handleCloseSelectAssets = () => {
    timelineInteraction.clearMultiselect();
    viewMode = 'view';
  };

  const handleAddAssets = async () => {
    const assetIds = timelineInteraction.selectedAssets.map((a) => a.id);
    if (assetIds.length === 0) {
      return;
    }
    try {
      await addAssets({ id: space.id, sharedSpaceAssetAddDto: { assetIds } });
      eventManager.emit('SpaceAddAssets', { assetIds, spaceId: space.id });
      toastManager.success($t('added_to_space_count', { values: { count: assetIds.length } }));
    } catch (error) {
      handleError(error, $t('errors.error_adding_assets_to_space'));
    }
  };

  const handleDelete = async () => {
    const confirmed = await modalManager.showDialog({
      prompt: $t('spaces_delete_confirmation', { values: { name: space.name } }),
      title: $t('spaces_delete'),
    });

    if (!confirmed) {
      return;
    }

    await removeSpace({ id: space.id });
    await goto(Route.spaces());
  };

  const handleToggleTimeline = async () => {
    try {
      const updated = await updateMemberTimeline({
        id: space.id,
        sharedSpaceMemberTimelineDto: { showInTimeline: !showInTimeline },
      });
      members = members.map((m) => (m.userId === updated.userId ? updated : m));
    } catch (error) {
      handleError(error, $t('errors.unable_to_update_timeline_display_status'));
    }
  };

  const handleShowMembers = async () => {
    const updatedMembers = await modalManager.show(SpaceMembersModal, {
      spaceId: space.id,
      members,
      isOwner,
    });
    if (updatedMembers) {
      members = updatedMembers;
    }
  };

  const handleRemoveAssets = async (assetIds: string[]) => {
    timelineManager.removeAssets(assetIds);
    await refreshSpace();
  };

  const onSpaceAddAssets = async () => {
    await refreshSpace();
    timelineInteraction.clearMultiselect();
    viewMode = 'view';
  };

  const onSpaceRemoveAssets = async ({ assetIds }: { assetIds: string[]; spaceId: string }) => {
    timelineManager.removeAssets(assetIds);
    await refreshSpace();
  };

  let searchQuery = $state('');
  let searchResults = $state<AssetResponseDto[]>([]);
  let isSearching = $state(false);
  let showSearchResults = $state(false);

  const handleSearch = async () => {
    const query = searchQuery.trim();
    if (!query) {
      showSearchResults = false;
      searchResults = [];
      return;
    }

    isSearching = true;
    showSearchResults = true;
    try {
      const { assets } = await searchSmart({
        smartSearchDto: { query, spaceId: space.id },
      });
      searchResults = assets.items;
    } catch {
      searchResults = [];
    } finally {
      isSearching = false;
    }
  };

  const clearSearch = () => {
    searchQuery = '';
    searchResults = [];
    showSearchResults = false;
  };
</script>

<OnEvents {onSpaceAddAssets} {onSpaceRemoveAssets} />

<UserPageLayout
  hideNavbar={assetInteraction.selectionActive || viewMode === 'select-assets'}
  title={viewMode === 'select-assets' ? undefined : space.name}
  scrollbar={false}
>
  {#snippet buttons()}
    {#if viewMode === 'view' && !assetInteraction.selectionActive}
      <div class="flex">
        {#if isEditor}
          <IconButton
            variant="ghost"
            shape="round"
            color="secondary"
            aria-label={$t('add_photos')}
            onclick={() => {
              viewMode = 'select-assets';
            }}
            icon={mdiImagePlusOutline}
          />
        {/if}

        <SpaceMap spaceId={space.id} />

        <IconButton
          variant="ghost"
          shape="round"
          color="secondary"
          aria-label={showInTimeline ? $t('spaces_hide_from_timeline') : $t('spaces_show_on_timeline')}
          title={showInTimeline ? $t('spaces_hide_from_timeline') : $t('spaces_show_on_timeline')}
          onclick={handleToggleTimeline}
          icon={showInTimeline ? mdiEyeOutline : mdiEyeOffOutline}
        />

        <IconButton
          variant="ghost"
          shape="round"
          color="secondary"
          aria-label={$t('members')}
          onclick={handleShowMembers}
          icon={mdiAccountMultipleOutline}
        />

        {#if isOwner}
          <IconButton
            variant="ghost"
            shape="round"
            color="secondary"
            aria-label={$t('spaces_delete')}
            onclick={handleDelete}
            icon={mdiDeleteOutline}
          />
        {/if}
      </div>
    {/if}
  {/snippet}

  {#if showSearchResults}
    <div class="px-4">
      {#if viewMode !== 'select-assets'}
        <section class="pt-4">
          <div class="flex gap-4 mt-2 text-sm text-immich-fg/60 dark:text-immich-dark-fg/60">
            <span>{space.assetCount ?? 0} {$t('photos')}</span>
            <span>{members.length} {$t('members')}</span>
          </div>

          <div class="mt-2 flex items-center gap-2">
            <form
              class="relative flex-1"
              onsubmit={(e) => {
                e.preventDefault();
                void handleSearch();
              }}
            >
              <input
                type="text"
                bind:value={searchQuery}
                placeholder={$t('search')}
                class="w-full rounded-lg border bg-transparent px-10 py-2 text-sm dark:border-gray-600 focus:border-immich-primary focus:outline-none"
              />
              <button type="submit" class="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">
                <Icon icon={mdiMagnify} size="18" />
              </button>
              {#if searchQuery}
                <button
                  type="button"
                  onclick={clearSearch}
                  class="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                >
                  <Icon icon={mdiClose} size="18" />
                </button>
              {/if}
            </form>
          </div>

          {#if space.description}
            <p
              class="whitespace-pre-line mb-6 mt-4 w-full pb-2 text-start font-medium text-base text-black dark:text-gray-300"
            >
              {space.description}
            </p>
          {/if}
        </section>
      {/if}

      <section class="py-4">
        {#if isSearching}
          <div class="flex justify-center py-8">
            <LoadingSpinner />
          </div>
        {:else if searchResults.length === 0}
          <p class="mt-8 text-center text-gray-500 dark:text-gray-400">{$t('search_no_result')}</p>
        {:else}
          <p class="mb-4 text-sm text-gray-500 dark:text-gray-400">
            {searchResults.length} results
          </p>
          <div class="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-1">
            {#each searchResults as asset (asset.id)}
              <a
                href="{Route.viewSpace({ id: space.id })}/photos/{asset.id}"
                class="aspect-square cursor-pointer overflow-hidden rounded"
              >
                <img
                  src="/api/assets/{asset.id}/thumbnail"
                  alt={asset.originalFileName}
                  class="h-full w-full object-cover"
                />
              </a>
            {/each}
          </div>
        {/if}
      </section>
    </div>
  {/if}

  <div class:hidden={showSearchResults}>
    <Timeline
      enableRouting={true}
      bind:timelineManager
      {options}
      assetInteraction={currentAssetInteraction}
      {isSelectionMode}
      onEscape={handleEscape}
    >
      {#if viewMode !== 'select-assets' && !showSearchResults}
        <section class="pt-4">
          <div class="flex gap-4 mt-2 text-sm text-immich-fg/60 dark:text-immich-dark-fg/60">
            <span>{space.assetCount ?? 0} {$t('photos')}</span>
            <span>{members.length} {$t('members')}</span>
          </div>

          <div class="mt-2 flex items-center gap-2">
            <form
              class="relative flex-1"
              onsubmit={(e) => {
                e.preventDefault();
                void handleSearch();
              }}
            >
              <input
                type="text"
                bind:value={searchQuery}
                placeholder={$t('search')}
                class="w-full rounded-lg border bg-transparent px-10 py-2 text-sm dark:border-gray-600 focus:border-immich-primary focus:outline-none"
              />
              <button type="submit" class="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">
                <Icon icon={mdiMagnify} size="18" />
              </button>
              {#if searchQuery}
                <button
                  type="button"
                  onclick={clearSearch}
                  class="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                >
                  <Icon icon={mdiClose} size="18" />
                </button>
              {/if}
            </form>
          </div>

          {#if space.description}
            <p
              class="whitespace-pre-line mb-6 mt-4 w-full pb-2 text-start font-medium text-base text-black dark:text-gray-300"
            >
              {space.description}
            </p>
          {/if}
        </section>
      {/if}

      {#snippet empty()}
        {#if viewMode === 'view'}
          <section class="mt-50 flex place-content-center place-items-center">
            <div class="w-75">
              <p class="uppercase text-xs dark:text-immich-dark-fg">{$t('spaces_no_assets')}</p>
              {#if isEditor}
                <button
                  type="button"
                  onclick={() => (viewMode = 'select-assets')}
                  class="mt-5 bg-subtle flex w-full place-items-center gap-6 rounded-2xl border px-8 py-8 text-immich-fg transition-all hover:bg-gray-100 dark:hover:bg-gray-500/20 hover:text-immich-primary dark:border-none dark:text-immich-dark-fg dark:hover:text-immich-dark-primary"
                >
                  <span class="text-primary">
                    <Icon icon={mdiPlus} size="24" />
                  </span>
                  <span class="text-lg">{$t('add_photos')}</span>
                </button>
              {/if}
            </div>
          </section>
        {/if}
      {/snippet}
    </Timeline>
  </div>
</UserPageLayout>

{#if assetInteraction.selectionActive && viewMode === 'view'}
  <AssetSelectControlBar
    assets={assetInteraction.selectedAssets}
    clearSelect={() => assetInteraction.clearMultiselect()}
  >
    <SelectAllAssets {timelineManager} {assetInteraction} />
    {#if isEditor}
      <RemoveFromSpaceAction spaceId={space.id} onRemove={handleRemoveAssets} />
    {/if}
    {#if assetInteraction.isAllUserOwned}
      <FavoriteAction
        removeFavorite={assetInteraction.isAllFavorite}
        onFavorite={(ids, isFavorite) => timelineManager.update(ids, (asset) => (asset.isFavorite = isFavorite))}
      />
    {/if}
    <ButtonContextMenu icon={mdiDotsVertical} title={$t('menu')} offset={{ x: 175, y: 25 }}>
      <DownloadAction menuItem />
      {#if assetInteraction.isAllUserOwned}
        <ChangeDate menuItem />
        <ChangeDescription menuItem />
        <ChangeLocation menuItem />
        <ArchiveAction
          menuItem
          unarchive={assetInteraction.isAllArchived}
          onArchive={(ids, visibility) => timelineManager.update(ids, (asset) => (asset.visibility = visibility))}
        />
      {/if}
      {#if $preferences.tags.enabled && assetInteraction.isAllUserOwned}
        <TagAction menuItem />
      {/if}
    </ButtonContextMenu>
  </AssetSelectControlBar>
{/if}

{#if viewMode === 'select-assets'}
  <ControlAppBar onClose={handleCloseSelectAssets}>
    {#snippet leading()}
      <p class="text-lg dark:text-immich-dark-fg">
        {#if !timelineInteraction.selectionActive}
          {$t('add_to_space')}
        {:else}
          {$t('selected_count', { values: { count: timelineInteraction.selectedAssets.length } })}
        {/if}
      </p>
    {/snippet}

    {#snippet trailing()}
      <IconButton
        variant="ghost"
        shape="round"
        color="secondary"
        aria-label={$t('add_to_space')}
        onclick={handleAddAssets}
        icon={mdiPlus}
        disabled={!timelineInteraction.selectionActive}
      />
    {/snippet}
  </ControlAppBar>
{/if}
