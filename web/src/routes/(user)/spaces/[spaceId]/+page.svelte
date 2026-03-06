<script lang="ts">
  import { goto } from '$app/navigation';
  import OnEvents from '$lib/components/OnEvents.svelte';
  import ControlAppBar from '$lib/components/shared-components/control-app-bar.svelte';
  import DownloadAction from '$lib/components/timeline/actions/DownloadAction.svelte';
  import FavoriteAction from '$lib/components/timeline/actions/FavoriteAction.svelte';
  import RemoveFromSpaceAction from '$lib/components/timeline/actions/RemoveFromSpaceAction.svelte';
  import SelectAllAssets from '$lib/components/timeline/actions/SelectAllAction.svelte';
  import AssetSelectControlBar from '$lib/components/timeline/AssetSelectControlBar.svelte';
  import Timeline from '$lib/components/timeline/Timeline.svelte';
  import { TimelineManager } from '$lib/managers/timeline-manager/timeline-manager.svelte';
  import { eventManager } from '$lib/managers/event-manager.svelte';
  import SpaceMembersModal from '$lib/modals/SpaceMembersModal.svelte';
  import { Route } from '$lib/route';
  import { AssetInteraction } from '$lib/stores/asset-interaction.svelte';
  import { user } from '$lib/stores/user.store';
  import { cancelMultiselect } from '$lib/utils/asset-utils';
  import { handleError } from '$lib/utils/handle-error';
  import {
    addAssets,
    AssetVisibility,
    getSpace,
    removeSpace,
    Role,
    type SharedSpaceMemberResponseDto,
    type SharedSpaceResponseDto,
  } from '@immich/sdk';
  import { IconButton, modalManager, toastManager } from '@immich/ui';
  import { mdiAccountMultipleOutline, mdiArrowLeft, mdiDeleteOutline, mdiImagePlusOutline, mdiPlus } from '@mdi/js';
  import { Icon } from '@immich/ui';
  import { t } from 'svelte-i18n';
  import type { PageData } from './$types';

  type ViewMode = 'view' | 'select-assets';

  interface Props {
    data: PageData;
  }

  let { data }: Props = $props();
  let space: SharedSpaceResponseDto = $state(data.space);
  let members: SharedSpaceMemberResponseDto[] = $state(data.members);
  let viewMode: ViewMode = $state('view');

  let timelineManager = $state<TimelineManager>() as TimelineManager;

  const assetInteraction = new AssetInteraction();
  const timelineInteraction = new AssetInteraction();

  const currentMember = $derived(members.find((m) => m.userId === $user.id));
  const isOwner = $derived(currentMember?.role === Role.Owner);
  const isEditor = $derived(currentMember?.role === Role.Owner || currentMember?.role === Role.Editor);

  const options = $derived.by(() => {
    if (viewMode === 'select-assets') {
      return { visibility: AssetVisibility.Timeline };
    }
    return { spaceId: space.id };
  });

  const currentAssetInteraction = $derived(viewMode === 'select-assets' ? timelineInteraction : assetInteraction);
  const isSelectionMode = $derived(viewMode === 'select-assets');

  const refreshSpace = async () => {
    space = await getSpace({ id: space.id });
  };

  const handleEscape = () => {
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
</script>

<OnEvents {onSpaceAddAssets} {onSpaceRemoveAssets} />

<div class="flex overflow-hidden">
  <div class="relative w-full shrink">
    <main class="relative h-dvh overflow-hidden px-2 md:px-6 max-md:pt-(--navbar-height-md) pt-(--navbar-height)">
      <Timeline
        enableRouting={false}
        bind:timelineManager
        {options}
        assetInteraction={currentAssetInteraction}
        {isSelectionMode}
        onEscape={handleEscape}
      >
        {#if viewMode !== 'select-assets'}
          <section class="pt-8 md:pt-24">
            <h1 class="text-2xl md:text-4xl lg:text-6xl text-primary outline-none transition-all">
              {space.name}
            </h1>

            <div class="flex gap-4 mt-2 text-sm text-immich-fg/60 dark:text-immich-dark-fg/60">
              <span>{space.assetCount ?? 0} {$t('photos')}</span>
              <span>{members.length} {$t('members')}</span>
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
    </main>

    {#if assetInteraction.selectionActive && viewMode === 'view'}
      <AssetSelectControlBar
        assets={assetInteraction.selectedAssets}
        clearSelect={() => assetInteraction.clearMultiselect()}
      >
        <SelectAllAssets {timelineManager} {assetInteraction} />
        {#if isEditor}
          <RemoveFromSpaceAction spaceId={space.id} onRemove={handleRemoveAssets} />
        {/if}
        <DownloadAction />
        {#if assetInteraction.isAllUserOwned}
          <FavoriteAction
            removeFavorite={assetInteraction.isAllFavorite}
            onFavorite={(ids, isFavorite) => timelineManager.update(ids, (asset) => (asset.isFavorite = isFavorite))}
          />
        {/if}
      </AssetSelectControlBar>
    {:else}
      {#if viewMode === 'view'}
        <ControlAppBar showBackButton backIcon={mdiArrowLeft} onClose={() => goto(Route.spaces())}>
          {#snippet trailing()}
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
          {/snippet}
        </ControlAppBar>
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
    {/if}
  </div>
</div>
