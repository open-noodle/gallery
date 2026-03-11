<script lang="ts">
  import { getPeopleThumbnailUrl } from '$lib/utils';
  import type { SharedSpacePersonResponseDto } from '@immich/sdk';
  import { Icon } from '@immich/ui';
  import { mdiAccountMultipleCheckOutline, mdiPencilOutline } from '@mdi/js';
  import { t } from 'svelte-i18n';

  interface Props {
    person: SharedSpacePersonResponseDto;
    spaceId: string;
    canEdit?: boolean;
    onSetAlias?: (personId: string) => void;
    onMerge?: (personId: string) => void;
  }

  let { person, spaceId, canEdit = false, onSetAlias, onMerge }: Props = $props();

  let showActions = $state(false);

  const displayName = $derived(person.alias || person.name || 'Unknown');

  const getThumbUrl = (p: SharedSpacePersonResponseDto): string => {
    return getPeopleThumbnailUrl({ id: p.id, name: p.name, updatedAt: p.updatedAt } as any);
  };
</script>

<div
  class="group relative"
  data-testid="person-card-{person.id}"
  onmouseenter={() => (showActions = true)}
  onmouseleave={() => (showActions = false)}
  role="group"
>
  <a
    href="/spaces/{spaceId}/people/{person.id}"
    class="block"
    data-testid="person-card-link"
    onfocus={() => (showActions = true)}
  >
    <div class="overflow-hidden rounded-xl" data-testid="person-card-thumbnail">
      <img
        src={getThumbUrl(person)}
        alt={displayName}
        class="aspect-square w-full object-cover transition-transform duration-200 group-hover:scale-105"
        loading="lazy"
      />
    </div>

    <div class="mt-2 px-1">
      <p class="truncate text-sm font-medium" data-testid="person-card-name">
        {displayName}
      </p>
      {#if person.alias && person.name}
        <p class="truncate text-xs text-gray-500 dark:text-gray-400" data-testid="person-card-original-name">
          {person.name}
        </p>
      {/if}
      <p class="text-xs text-gray-400 dark:text-gray-500" data-testid="person-card-count">
        {person.assetCount}
        {$t('photos')}
      </p>
    </div>
  </a>

  {#if canEdit && showActions}
    <div class="absolute right-2 top-2 flex gap-1">
      <button
        type="button"
        class="rounded-full bg-black/50 p-1.5 text-white backdrop-blur-sm transition-colors hover:bg-black/70"
        onclick={(e: MouseEvent) => {
          e.stopPropagation();
          e.preventDefault();
          onSetAlias?.(person.id);
        }}
        title={$t('spaces_set_alias')}
        data-testid="set-alias-button"
      >
        <Icon icon={mdiPencilOutline} size="16" />
      </button>
      <button
        type="button"
        class="rounded-full bg-black/50 p-1.5 text-white backdrop-blur-sm transition-colors hover:bg-black/70"
        onclick={(e: MouseEvent) => {
          e.stopPropagation();
          e.preventDefault();
          onMerge?.(person.id);
        }}
        title={$t('merge_people')}
        data-testid="merge-button"
      >
        <Icon icon={mdiAccountMultipleCheckOutline} size="16" />
      </button>
    </div>
  {/if}
</div>
