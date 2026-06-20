<script lang="ts">
  import { longPress } from '$lib/actions/long-press';
  import { SCROLL_PROPERTIES } from '$lib/components/shared-components/album-selection/album-selection-utils';
  import SpaceCollage from '$lib/components/spaces/space-collage.svelte';
  import { mediaQueryManager } from '$lib/stores/media-query-manager.svelte';
  import { normalizeSearchString } from '$lib/utils/string-utils';
  import type { SharedSpaceResponseDto } from '@immich/sdk';
  import { Icon } from '@immich/ui';
  import { mdiAccountMultipleOutline, mdiCheckCircle } from '@mdi/js';
  import type { Action } from 'svelte/action';
  import { t } from 'svelte-i18n';

  interface Props {
    space: SharedSpaceResponseDto;
    searchQuery?: string;
    selected: boolean;
    multiSelected?: boolean;
    onSpaceClick: () => void;
    onMultiSelect: () => void;
  }

  let {
    space,
    searchQuery = '',
    selected = false,
    multiSelected = false,
    onSpaceClick,
    onMultiSelect,
  }: Props = $props();

  const scrollIntoViewIfSelected: Action = (node) => {
    $effect(() => {
      if (selected) {
        node.scrollIntoView(SCROLL_PROPERTIES);
      }
    });
  };

  const nameParts: string[] = $derived.by(() => {
    const name = space.name;
    if (searchQuery.length === 0) {
      return [name, '', ''];
    }
    const index = normalizeSearchString(name).indexOf(normalizeSearchString(searchQuery));
    if (index === -1) {
      return [name, '', ''];
    }
    return [
      name.slice(0, index),
      name.slice(index, index + searchQuery.length),
      name.slice(index + searchQuery.length),
    ];
  });

  const collageAssets = $derived((space.recentAssetIds ?? []).map((id) => ({ id, thumbhash: null })));

  let usingMobileDevice = $derived(mediaQueryManager.pointerCoarse);
  let mouseOver = $state(false);

  const handleMultiSelectClicked = (event?: MouseEvent) => {
    event?.stopPropagation();
    event?.preventDefault();
    onMultiSelect();
  };
</script>

<div
  role="group"
  class={[
    'relative flex w-full text-start justify-between transition-colors hover:bg-gray-200 dark:hover:bg-gray-700 rounded-xl my-2 hover:cursor-pointer',
    { 'bg-primary/10 hover:bg-primary/10': multiSelected },
  ]}
  onmouseenter={() => {
    if (!usingMobileDevice) {
      mouseOver = true;
    }
  }}
  onmouseleave={() => (mouseOver = false)}
>
  <button
    type="button"
    onclick={onSpaceClick}
    use:scrollIntoViewIfSelected
    class="flex w-full gap-4 px-2 py-2 text-start"
    class:bg-gray-200={selected}
    class:dark:bg-gray-700={selected}
    use:longPress={{ onLongPress: () => handleMultiSelectClicked() }}
    data-testid="space-row"
  >
    <span class="relative h-16 w-16 shrink-0">
      <SpaceCollage assets={collageAssets} />
      <span
        class="absolute -bottom-1.5 -end-1.5 flex h-6 w-6 items-center justify-center rounded-full bg-immich-bg ring-2 ring-immich-bg dark:bg-immich-dark-gray dark:ring-immich-dark-gray"
        data-testid="space-row-badge"
      >
        <Icon icon={mdiAccountMultipleOutline} size="0.9rem" class="text-pink-500" />
      </span>
    </span>
    <span class="flex h-full flex-col items-start justify-center overflow-hidden">
      <span class="w-full shrink overflow-hidden text-ellipsis whitespace-nowrap"
        >{nameParts[0]}<b>{nameParts[1]}</b>{nameParts[2]}</span
      >
      <span class="flex gap-2 text-sm" data-testid="space-row-details">
        {#if space.assetCount != null}
          <span>{$t('items_count', { values: { count: space.assetCount } })}</span>
        {/if}
        {#if space.assetCount != null && space.memberCount != null}
          <span>&middot;</span>
        {/if}
        {#if space.memberCount != null}
          <span>{space.memberCount} {$t('members')}</span>
        {/if}
      </span>
    </span>
  </button>

  {#if mouseOver || multiSelected}
    <button
      type="button"
      onclick={handleMultiSelectClicked}
      class="absolute end-0 top-4 p-3 focus:outline-none hover:cursor-pointer"
      role="checkbox"
      tabindex={-1}
      aria-checked={multiSelected}
    >
      <Icon
        icon={mdiCheckCircle}
        size="24"
        class={multiSelected ? 'text-primary' : 'text-gray-300 hover:text-primary/75'}
      />
    </button>
  {/if}
</div>
