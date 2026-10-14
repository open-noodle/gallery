<script lang="ts">
  import { goto, invalidateAll } from '$app/navigation';
  import OnEvents from '$lib/components/OnEvents.svelte';
  import ControlAppBar from '$lib/components/shared-components/ControlAppBar.svelte';
  import SpaceNewAssetsDivider from '$lib/components/spaces/space-new-assets-divider.svelte';
  import SpaceOnboardingBanner from '$lib/components/spaces/space-onboarding-banner.svelte';
  import SpaceAssetLimitWarning from '$lib/components/spaces/space-asset-limit-warning.svelte';
  import SelectionToolbar from '$lib/components/timeline/SelectionToolbar.svelte';
  import Timeline from '$lib/components/timeline/Timeline.svelte';
  import { TimelineManager } from '$lib/managers/timeline-manager/timeline-manager.svelte';
  import { createSpaceTimeline } from '$lib/gallery/filtered-timeline/space-timeline';
  import FilteredTimeline from '$lib/gallery/filtered-timeline/FilteredTimeline.svelte';
  import { registerSpaceContext } from '$lib/managers/command-context-manager.svelte';
  import { eventManager } from '$lib/managers/event-manager.svelte';
  import { spaceUiManager } from '$lib/managers/space-ui-manager.svelte';
  import { Route } from '$lib/route';
  import { MAX_SPACE_ASSETS_PER_REQUEST } from '$lib/constants';
  import { assetMultiSelectManager } from '$lib/managers/asset-multi-select-manager.svelte';
  import { authManager } from '$lib/managers/auth-manager.svelte';
  import { handleError } from '$lib/utils/handle-error';
  import {
    addAssets,
    AssetVisibility,
    getSpace,
    markSpaceViewed,
    SharedSpaceRole,
    updateSpace,
    UserAvatarColor,
    type SharedSpaceMemberResponseDto,
    type SharedSpaceResponseDto,
  } from '@immich/sdk';
  import { IconButton, toastManager } from '@immich/ui';
  import { mdiImageOutline, mdiPlus } from '@mdi/js';
  import { t } from 'svelte-i18n';
  import type { PageData } from './$types';

  type ViewMode = 'view' | 'select-assets' | 'select-cover';

  interface Props {
    data: PageData;
  }

  let { data }: Props = $props();
  let space: SharedSpaceResponseDto = $state(data.space);
  let members: SharedSpaceMemberResponseDto[] = $state(data.members);

  let viewMode = $state<ViewMode>('view');

  let initializedSpaceId = $state('');

  let timelineManager = $state<TimelineManager>() as TimelineManager;

  const filtered = createSpaceTimeline({
    getSpace: () => space,
    getMembers: () => members,
    getTimelineManager: () => timelineManager,
    canZoom: () => viewMode === 'view',
    // Committing or clearing the query swaps the timeline for the results grid and back, and the
    // incoming surface mounts at the top, so a collapse inherited from the outgoing one would hide
    // the cover with nothing scrolled under it.
    onQueryChange: () => spaceUiManager.setCoverCollapsed(false),
  });

  // Sync when navigating between spaces (component persists, data updates). `pre` so the switch
  // re-seeds the controller before its URL effect sees the new URL as a query change.
  $effect.pre(() => {
    if (data.space.id === space.id) {
      return;
    }

    space = data.space;
    members = data.members;
    filtered.reset();
    viewMode = 'view';
    assetMultiSelectManager.clear();
  });

  const currentMember = $derived(members.find((m) => m.userId === authManager.user.id));
  const isOwner = $derived(currentMember?.role === SharedSpaceRole.Owner);
  const isEditor = $derived(
    currentMember?.role === SharedSpaceRole.Owner || currentMember?.role === SharedSpaceRole.Editor,
  );

  registerSpaceContext(
    () => space,
    () => members,
    {
      getAddPhotosToCurrentSpace: () =>
        viewMode === 'view' && isEditor && !assetMultiSelectManager.selectionActive
          ? () => {
              viewMode = 'select-assets';
            }
          : undefined,
    },
  );

  const options = $derived(
    viewMode === 'select-assets'
      ? { visibility: AssetVisibility.Timeline, timelineSpaceId: space.id }
      : filtered.options,
  );

  const isSelectionMode = $derived(viewMode === 'select-assets' || viewMode === 'select-cover');

  const refreshSpace = async () => {
    space = await getSpace({ id: space.id });
  };

  const handleEscape = () => {
    if (filtered.showSearchResults) {
      filtered.clearSearch();
      return;
    }
    if (viewMode === 'select-assets') {
      handleCloseSelectAssets();
      return;
    }
    if (viewMode === 'select-cover') {
      handleCloseSelectCover();
      return;
    }
    if (assetMultiSelectManager.selectionActive) {
      assetMultiSelectManager.clear();
      return;
    }
    void goto(Route.spaces());
  };

  const handleCloseSelectAssets = () => {
    assetMultiSelectManager.clear();
    viewMode = 'view';
  };

  const openSelectCover = () => {
    filtered.grouping = 'day';
    filtered.temporalAnchor = undefined;
    viewMode = 'select-cover';
  };

  const handleCloseSelectCover = () => {
    assetMultiSelectManager.clear();
    viewMode = 'view';
  };

  const handleSetCoverFromSelection = async () => {
    const assets = assetMultiSelectManager.assets;
    if (assets.length !== 1) {
      return;
    }
    try {
      await updateSpace({ id: space.id, sharedSpaceUpdateDto: { thumbnailAssetId: assets[0].id } });
      await invalidateAll();
      toastManager.success($t('space_cover_updated'));
      assetMultiSelectManager.clear();
      viewMode = 'view';
    } catch (error) {
      handleError(error, $t('errors.unable_to_update_space_cover'));
    }
  };

  let skipNextLocalSpaceAddEventForSpaceId: string | null = null;

  const applySpaceAddSuccess = async () => {
    await refreshSpace();
    // Also revalidate layout data so the shell's Photos tab count badge updates.
    await invalidateAll();
    assetMultiSelectManager.clear();
    viewMode = 'view';
  };

  const addSelectedAssetsToCurrentSpace = async () => {
    const assetIds = assetMultiSelectManager.assets.map((a) => a.id);
    if (assetIds.length === 0 || assetIds.length > MAX_SPACE_ASSETS_PER_REQUEST) {
      return false;
    }
    try {
      await addAssets({ id: space.id, sharedSpaceAssetAddDto: { assetIds } });
      skipNextLocalSpaceAddEventForSpaceId = space.id;
      eventManager.emit('SpaceAddAssets', {
        assetIds,
        spaceId: space.id,
        hiddenFromMyTimeline: currentMember?.showInTimeline === false,
      });
      toastManager.success($t('added_to_space_count', { values: { count: assetIds.length } }));
      await applySpaceAddSuccess();
      return true;
    } catch (error) {
      handleError(error, $t('errors.error_adding_assets_to_space'));
      return false;
    } finally {
      skipNextLocalSpaceAddEventForSpaceId = null;
    }
  };

  const handleAddAssets = async () => {
    await addSelectedAssetsToCurrentSpace();
  };

  filtered.registerSelectionContext({
    canAct: () => viewMode === 'view',
    canAddToAlbum: () => true,
    getOnDelete: undefined,
    getOnUndoDelete: undefined,
    getAddSelectedToCurrentSpace: () =>
      viewMode === 'select-assets' && isEditor ? addSelectedAssetsToCurrentSpace : undefined,
  });

  const handleRemoveAssets = async (assetIds: string[]) => {
    filtered.onAssetDelete(assetIds);
    await refreshSpace();
    // Also revalidate layout data so the shell's Photos tab count badge updates.
    await invalidateAll();
  };

  const handleSetAsCover = async () => {
    const assets = assetMultiSelectManager.assets;
    if (assets.length !== 1) {
      return;
    }
    try {
      await updateSpace({ id: space.id, sharedSpaceUpdateDto: { thumbnailAssetId: assets[0].id } });
      await invalidateAll();
      toastManager.success($t('space_cover_updated'));
      assetMultiSelectManager.clear();
    } catch (error) {
      handleError(error, $t('errors.unable_to_update_space_cover'));
    }
  };

  const onSpaceAddAssets = async ({ spaceId }: { assetIds: string[]; spaceId: string }) => {
    if (spaceId !== space.id) {
      return;
    }
    if (skipNextLocalSpaceAddEventForSpaceId === spaceId) {
      return;
    }
    await applySpaceAddSuccess();
  };

  const onSpaceRemoveAssets = async ({ assetIds }: { assetIds: string[]; spaceId: string }) => {
    await handleRemoveAssets(assetIds);
  };

  // Not `isTimelineEmpty`'s isEmptyForOptions: a filter that empties the timeline gets the clear prompt.
  const isFilteredTimelineEmpty = $derived(
    !!timelineManager?.isInitialized &&
      filtered.totalAssetCount === 0 &&
      filtered.activeFilterCount > 0 &&
      !filtered.showSearchResults,
  );

  // Collapse the shell's cover once the reader scrolls past it. Both surfaces this tab can show —
  // the browse timeline and the search results grid — scroll independently, so both report here;
  // wiring only the timeline left the cover pinned open over search results, which on a phone is
  // most of the screen (#1028).
  const COVER_COLLAPSE_SCROLL_THRESHOLD = 64;
  const handleSurfaceScroll = (scrollTop: number) =>
    spaceUiManager.setCoverCollapsed(scrollTop > COVER_COLLAPSE_SCROLL_THRESHOLD);

  const gradientClasses: Record<string, string> = {
    [UserAvatarColor.Primary]: 'from-immich-primary/60 to-immich-primary',
    [UserAvatarColor.Pink]: 'from-pink-300 to-pink-500',
    [UserAvatarColor.Red]: 'from-red-400 to-red-600',
    [UserAvatarColor.Yellow]: 'from-yellow-300 to-yellow-500',
    [UserAvatarColor.Blue]: 'from-blue-400 to-blue-600',
    [UserAvatarColor.Green]: 'from-green-400 to-green-700',
    [UserAvatarColor.Purple]: 'from-purple-400 to-purple-700',
    [UserAvatarColor.Orange]: 'from-orange-400 to-orange-600',
    [UserAvatarColor.Gray]: 'from-gray-400 to-gray-600',
    [UserAvatarColor.Amber]: 'from-amber-400 to-amber-600',
  };

  const spaceGradient = $derived(gradientClasses[space.color ?? 'primary'] ?? gradientClasses[UserAvatarColor.Primary]);

  $effect(() => {
    if (!space?.id || space.id === initializedSpaceId) {
      return;
    }

    initializedSpaceId = space.id;
    void markSpaceViewed({ id: space.id });
  });

  // Consume add-photos / change-cover intents triggered from the shell app bar.
  $effect(() => {
    const intent = spaceUiManager.intent;
    if (!intent) {
      return;
    }
    spaceUiManager.consumeIntent();
    if (intent === 'add-assets') {
      viewMode = 'select-assets';
    } else if (intent === 'set-cover') {
      openSelectCover();
    }
  });

  $effect(() => {
    spaceUiManager.setChromeHidden(
      assetMultiSelectManager.selectionActive || viewMode === 'select-assets' || viewMode === 'select-cover',
    );
  });

  // Reset shell state when leaving the Photos page.
  $effect(() => () => spaceUiManager.reset());
</script>

<OnEvents {onSpaceAddAssets} {onSpaceRemoveAssets} onAssetsDelete={refreshSpace} />

<FilteredTimeline
  controller={filtered}
  chrome={viewMode === 'view'}
  testId="discovery-timeline"
  searchResults={{ space: { id: space.id, canWrite: isEditor }, isShared: true, onScroll: handleSurfaceScroll }}
  filteredEmpty={{ message: $t('spaces_no_filtered_assets'), clearLabel: $t('spaces_clear_all_filters') }}
  isFilteredEmpty={isFilteredTimelineEmpty}
>
  <Timeline
    enableRouting={false}
    bind:timelineManager
    {options}
    withStacked
    assetInteraction={assetMultiSelectManager}
    {isSelectionMode}
    onEscape={handleEscape}
    spaceId={space.id}
    space={{ id: space.id, canWrite: isEditor }}
    {...filtered.timelineProps}
    onScroll={handleSurfaceScroll}
  >
    {#if viewMode === 'view'}
      {#if isOwner}
        <SpaceOnboardingBanner
          {space}
          gradientClass={spaceGradient}
          onAddPhotos={() => (viewMode = 'select-assets')}
          onInviteMembers={() => void goto(`/spaces/${space.id}/members`)}
          onSetCover={openSelectCover}
        />
      {/if}

      {#if (space.newAssetCount ?? 0) > 0 && space.lastViewedAt}
        <SpaceNewAssetsDivider
          newAssetCount={space.newAssetCount ?? 0}
          lastViewedAt={space.lastViewedAt}
          spaceColor={space.color ?? 'primary'}
        />
      {/if}
    {/if}

    {#snippet empty()}
      {#if viewMode === 'view'}
        <div class="mx-auto max-w-md py-16 text-center">
          <p class="text-gray-500 dark:text-gray-400">{$t('spaces_no_assets')}</p>
        </div>
      {/if}
    {/snippet}
  </Timeline>
</FilteredTimeline>

{#if assetMultiSelectManager.selectionActive && viewMode === 'view'}
  <div class="fixed inset-s-0 top-0 z-2 w-full">
    <SelectionToolbar
      timelineManager={filtered.showSearchResults ? undefined : timelineManager}
      assetInteraction={assetMultiSelectManager}
      onSelectAll={filtered.onSelectAll}
      space={{ id: space.id, canWrite: isEditor, members }}
      onRemove={handleRemoveAssets}
      onSetCover={handleSetAsCover}
      onFavorite={filtered.onFavorite}
      onArchive={filtered.onArchive}
      onVisibilitySet={filtered.onSetVisibility}
      onAssetDelete={filtered.onAssetDelete}
      onUndoDelete={filtered.onUndoDelete}
    />
  </div>
{/if}

{#if viewMode === 'select-assets'}
  <div class="fixed inset-s-0 top-0 z-2 w-full">
    <ControlAppBar onClose={handleCloseSelectAssets}>
      {#snippet leading()}
        <p class="text-lg dark:text-immich-dark-fg">
          {#if !assetMultiSelectManager.selectionActive}
            {$t('add_to_space')}
          {:else}
            {$t('selected_count', { values: { count: assetMultiSelectManager.assets.length } })}
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
          disabled={!assetMultiSelectManager.selectionActive ||
            assetMultiSelectManager.assets.length > MAX_SPACE_ASSETS_PER_REQUEST}
        />
      {/snippet}
    </ControlAppBar>
    <SpaceAssetLimitWarning selectedCount={assetMultiSelectManager.assets.length} />
  </div>
{/if}

{#if viewMode === 'select-cover'}
  <div class="fixed inset-s-0 top-0 z-2 w-full">
    <ControlAppBar onClose={handleCloseSelectCover}>
      {#snippet leading()}
        <p class="text-lg dark:text-immich-dark-fg">
          {#if !assetMultiSelectManager.selectionActive}
            {$t('set_cover_photo')}
          {:else}
            {$t('selected_count', { values: { count: assetMultiSelectManager.assets.length } })}
          {/if}
        </p>
      {/snippet}

      {#snippet trailing()}
        <IconButton
          variant="ghost"
          shape="round"
          color="secondary"
          aria-label={$t('set_cover_photo')}
          onclick={handleSetCoverFromSelection}
          icon={mdiImageOutline}
          disabled={assetMultiSelectManager.assets.length !== 1}
        />
      {/snippet}
    </ControlAppBar>
  </div>
{/if}
