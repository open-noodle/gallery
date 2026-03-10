<script lang="ts">
  import { getAssetMediaUrl } from '$lib/utils';
  import type { SharedSpaceResponseDto } from '@immich/sdk';
  import { Icon } from '@immich/ui';
  import { mdiAccountMultipleOutline, mdiCameraOutline, mdiImageEditOutline } from '@mdi/js';
  import { t } from 'svelte-i18n';

  interface Props {
    space: SharedSpaceResponseDto;
    memberCount: number;
    assetCount: number;
    currentRole?: string;
    gradientClass?: string;
    onSetCover?: () => void;
  }

  let {
    space,
    memberCount,
    assetCount,
    currentRole,
    gradientClass = 'from-gray-400 to-gray-600',
    onSetCover,
  }: Props = $props();

  let coverUrl = $derived(space.thumbnailAssetId ? getAssetMediaUrl({ id: space.thumbnailAssetId }) : null);
  let showFullDescription = $state(false);

  const roleLabels: Record<string, string> = {
    owner: 'Owner',
    editor: 'Editor',
    viewer: 'Viewer',
  };
</script>

<div class="relative w-full overflow-hidden rounded-xl" style="height: 250px;" data-testid="space-hero">
  {#if coverUrl}
    <img
      src={coverUrl}
      alt={space.name}
      class="absolute inset-0 size-full object-cover"
      data-testid="hero-cover-image"
    />
  {:else}
    <div class="absolute inset-0 bg-gradient-to-br {gradientClass}" data-testid="hero-gradient"></div>
  {/if}

  <div class="absolute inset-0 bg-gradient-to-t from-black/70 via-black/20 to-transparent"></div>

  {#if onSetCover}
    <button
      type="button"
      class="absolute right-3 top-3 flex items-center gap-1.5 rounded-full bg-black/40 px-3 py-1.5 text-xs font-medium text-white backdrop-blur-sm transition-colors hover:bg-black/60"
      onclick={onSetCover}
      data-testid="hero-set-cover-button"
    >
      <Icon icon={mdiImageEditOutline} size="14" />
      {$t('set_cover_photo')}
    </button>
  {/if}

  <div class="absolute bottom-0 left-0 right-0 p-6 text-white">
    <h1 class="text-2xl font-bold drop-shadow-md" data-testid="hero-title">{space.name}</h1>

    {#if space.description}
      <p
        class="mt-1 text-sm text-white/80 drop-shadow-sm"
        class:line-clamp-2={!showFullDescription}
        data-testid="hero-description"
      >
        {space.description}
      </p>
      {#if space.description.length > 120}
        <button
          type="button"
          class="mt-0.5 text-xs text-white/60 hover:text-white/90"
          onclick={() => (showFullDescription = !showFullDescription)}
          data-testid="hero-show-more"
        >
          {showFullDescription ? $t('show_less') : $t('show_more')}
        </button>
      {/if}
    {/if}

    <div class="mt-2 flex flex-wrap items-center gap-2">
      <span
        class="inline-flex items-center gap-1.5 rounded-full bg-white/20 px-3 py-1 text-sm backdrop-blur-sm"
        data-testid="hero-photo-count"
      >
        <Icon icon={mdiCameraOutline} size="16" />
        {assetCount}
        {$t('photos')}
      </span>
      <span
        class="inline-flex items-center gap-1.5 rounded-full bg-white/20 px-3 py-1 text-sm backdrop-blur-sm"
        data-testid="hero-member-count"
      >
        <Icon icon={mdiAccountMultipleOutline} size="16" />
        {memberCount}
        {$t('members')}
      </span>
      {#if currentRole}
        <span
          class="inline-flex items-center rounded-full bg-white/20 px-2.5 py-0.5 text-xs font-medium capitalize backdrop-blur-sm"
          data-testid="hero-role-badge"
        >
          {roleLabels[currentRole] ?? currentRole}
        </span>
      {/if}
    </div>
  </div>
</div>
