<script lang="ts">
  import ButtonContextMenu from '$lib/components/shared-components/context-menu/ButtonContextMenu.svelte';
  import MenuOption from '$lib/components/shared-components/context-menu/MenuOption.svelte';
  import { getAssetMediaUrl } from '$lib/utils';
  import { AssetMediaSize, type SharedSpaceResponseDto } from '@immich/sdk';
  import { Icon } from '@immich/ui';
  import { mdiCameraOutline, mdiCursorMove, mdiImageEditOutline, mdiPencilOutline } from '@mdi/js';
  import { t } from 'svelte-i18n';

  interface Props {
    space: SharedSpaceResponseDto;
    currentRole?: string;
    gradientClass?: string;
    canEdit?: boolean;
    onChangeCover?: () => void;
    onReposition?: () => void;
    repositioning?: boolean;
    onSavePosition?: (cropY: number) => void;
    onCancelReposition?: () => void;
    assetCount?: number;
    compact?: boolean;
    collapsed?: boolean;
  }

  let {
    space,
    currentRole,
    gradientClass = 'from-gray-400 to-gray-600',
    canEdit = false,
    onChangeCover,
    onReposition,
    repositioning = false,
    onSavePosition,
    onCancelReposition,
    assetCount,
    compact = false,
    collapsed = false,
  }: Props = $props();

  let coverUrl = $derived(
    space.thumbnailAssetId ? getAssetMediaUrl({ id: space.thumbnailAssetId, size: AssetMediaSize.Preview }) : null,
  );

  // Drag-to-reposition state
  let dragCropY = $state(50);
  let isDragging = $state(false);
  let dragStartY = $state(0);
  let dragStartCropY = $state(50);
  let hasInteracted = $state(false);

  $effect(() => {
    if (repositioning) {
      dragCropY = space.thumbnailCropY ?? 50;
      hasInteracted = false;
    }
  });

  let displayCropY = $derived(repositioning ? dragCropY : (space.thumbnailCropY ?? 50));

  let hasCover = $derived(!!space.thumbnailAssetId);

  const TALL = 220;
  const COMPACT = 96;
  let effectiveHeight = $derived(repositioning ? TALL : collapsed ? 0 : compact ? COMPACT : TALL);

  const handlePointerDown = (e: PointerEvent) => {
    if (!repositioning) {
      return;
    }
    isDragging = true;
    dragStartY = e.clientY;
    dragStartCropY = dragCropY;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e: PointerEvent) => {
    if (!isDragging) {
      return;
    }
    hasInteracted = true;
    const deltaY = e.clientY - dragStartY;
    const deltaPct = -(deltaY / 2.5);
    dragCropY = Math.round(Math.min(100, Math.max(0, dragStartCropY + deltaPct)));
  };

  const handlePointerUp = () => {
    isDragging = false;
  };
</script>

<div
  class="group relative w-full overflow-hidden rounded-xl"
  style="height: {effectiveHeight}px; transition: height 300ms ease;"
  data-testid="space-hero"
>
  {#if coverUrl}
    <img
      src={coverUrl}
      alt={space.name}
      class="absolute inset-0 size-full object-cover select-none"
      class:cursor-grab={repositioning && !isDragging}
      class:cursor-grabbing={repositioning && isDragging}
      style="object-position: center {displayCropY}%;"
      draggable="false"
      data-testid="hero-cover-image"
      onpointerdown={handlePointerDown}
      onpointermove={handlePointerMove}
      onpointerup={handlePointerUp}
    />
  {:else}
    <div class="absolute inset-0 bg-linear-to-br {gradientClass}" data-testid="hero-gradient"></div>
  {/if}

  {#if repositioning}
    <!-- Reposition mode overlay -->
    <div class="pointer-events-none absolute inset-x-0 top-0 h-16 bg-linear-to-b from-black/50 to-transparent"></div>
    <div class="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-linear-to-t from-black/50 to-transparent"></div>

    {#if !hasInteracted}
      <div class="pointer-events-none absolute inset-0 flex items-center justify-center" data-testid="reposition-hint">
        <span class="rounded-full bg-black/60 px-4 py-2 text-sm font-medium text-white backdrop-blur-sm">
          {$t('drag_to_reposition')}
        </span>
      </div>
    {/if}

    <div class="absolute right-3 bottom-3 flex gap-2" data-testid="reposition-controls">
      <button
        type="button"
        class="rounded-full bg-white/20 px-4 py-1.5 text-sm font-medium text-white backdrop-blur-sm transition-colors hover:bg-white/30"
        onclick={onCancelReposition}
        data-testid="reposition-cancel-button"
      >
        {$t('cancel')}
      </button>
      <button
        type="button"
        class="rounded-full bg-white px-4 py-1.5 text-sm font-medium text-black transition-colors hover:bg-white/90"
        onclick={() => onSavePosition?.(dragCropY)}
        data-testid="reposition-save-button"
      >
        {$t('save')}
      </button>
    </div>
  {:else}
    <div class="absolute inset-0 bg-linear-to-t from-black/70 via-black/20 to-transparent"></div>

    <div class="absolute inset-x-0 bottom-0 p-5 text-white">
      <h1 class="text-2xl font-bold drop-shadow-md" data-testid="hero-title">{space.name}</h1>
      {#if space.description}
        <p class="mt-1 line-clamp-2 text-sm text-white/80 drop-shadow-sm" data-testid="hero-description">
          {space.description}
        </p>
      {/if}
      {#if assetCount != null}
        <span
          class="mt-2 inline-flex items-center gap-1.5 rounded-full bg-white/20 px-2.5 py-1 text-xs font-medium backdrop-blur-sm"
          data-testid="hero-photo-count"
        >
          <Icon icon={mdiCameraOutline} size="14" />
          {assetCount}
          {$t('photos')}
        </span>
      {/if}
    </div>

    <!-- Mockup: hover ✎ (editors) + role badge grouped at the top-right of the cover. -->
    <div class="absolute top-3 right-3 flex items-center gap-2">
      {#if canEdit && hasCover}
        <div class="transition" data-testid="hero-edit-cover">
          <ButtonContextMenu
            icon={mdiPencilOutline}
            title={$t('edit')}
            color="secondary"
            align="top-right"
            direction="left"
          >
            <MenuOption text={$t('change_cover_photo')} icon={mdiImageEditOutline} onClick={() => onChangeCover?.()} />
            <MenuOption text={$t('reposition')} icon={mdiCursorMove} onClick={() => onReposition?.()} />
          </ButtonContextMenu>
        </div>
      {/if}
      {#if currentRole}
        <span
          class="inline-flex items-center rounded-full bg-white/20 px-2.5 py-0.5 text-xs font-medium text-white capitalize backdrop-blur-sm"
          data-testid="hero-role-badge"
        >
          {currentRole}
        </span>
      {/if}
    </div>

    {#if canEdit && !hasCover}
      <button
        type="button"
        class="absolute top-3 left-3 flex items-center gap-1.5 rounded-full bg-black/40 px-3 py-1.5 text-xs font-medium text-white backdrop-blur-sm transition hover:bg-black/60"
        onclick={onChangeCover}
        data-testid="hero-set-cover-button"
      >
        <Icon icon={mdiImageEditOutline} size="14" />
        {$t('set_cover_photo')}
      </button>
    {/if}
  {/if}
</div>
