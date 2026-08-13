<script lang="ts">
  import { longPress } from '$lib/actions/long-press';
  import { SCROLL_PROPERTIES } from '$lib/components/shared-components/album-selection/album-selection-utils';
  import { mediaQueryManager } from '$lib/stores/media-query-manager.svelte';
  import { Icon } from '@immich/ui';
  import { mdiCheckCircle, mdiImageMultipleOutline } from '@mdi/js';
  import type { Action } from 'svelte/action';
  import { t } from 'svelte-i18n';

  /**
   * "Add to space" — the pool of an expanded space, offered as a child row alongside that
   * space's linked albums (#965).
   *
   * It carries the same `PickerCollection` as its parent space row, so ticking either one
   * means the same destination and both show the tick.
   */
  interface Props {
    spaceId: string;
    selected: boolean;
    multiSelected?: boolean;
    onClick: () => void;
    onMultiSelect: () => void;
  }

  let { spaceId, selected = false, multiSelected = false, onClick, onMultiSelect }: Props = $props();

  const scrollIntoViewIfSelected: Action = (node) => {
    $effect(() => {
      if (selected) {
        node.scrollIntoView(SCROLL_PROPERTIES);
      }
    });
  };

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
    'relative flex w-full justify-between rounded-xl text-start transition-colors hover:cursor-pointer hover:bg-gray-200 dark:hover:bg-gray-700',
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
    onclick={onClick}
    use:scrollIntoViewIfSelected
    use:longPress={{ onLongPress: () => handleMultiSelectClicked() }}
    class="flex w-full items-center gap-3 py-3 ps-11 pe-5 text-start"
    class:bg-gray-200={selected}
    class:dark:bg-gray-700={selected}
    data-testid={`space-pool-child-${spaceId}`}
  >
    <Icon icon={mdiImageMultipleOutline} size="1.25rem" />
    <span>{$t('add_to_space')}</span>
  </button>

  {#if mouseOver || multiSelected}
    <button
      type="button"
      onclick={handleMultiSelectClicked}
      class="absolute inset-e-0 top-2 p-3 hover:cursor-pointer focus:outline-none"
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
