<script lang="ts">
  import { Icon } from '@immich/ui';
  import { mdiMapMarker } from '@mdi/js';
  import type { PlacesResponseDto } from '@immich/sdk';

  interface Props {
    item: PlacesResponseDto;
  }
  let { item }: Props = $props();

  const subtitle = $derived([item.admin1name, item.admin2name].filter(Boolean).join(' · '));
</script>

<div
  class="flex h-[52px] items-center gap-3 rounded-lg px-3 py-2 transition-colors duration-[80ms] ease-out group-data-[selected]:bg-primary/10"
>
  <div class="flex h-8 w-8 items-center justify-center rounded-md bg-subtle/40">
    <Icon icon={mdiMapMarker} size="1.125em" class="text-gray-500 dark:text-gray-400" />
  </div>
  <div class="min-w-0 flex-1">
    <div class="truncate text-sm font-medium">{item.name}</div>
    {#if subtitle}
      <div class="truncate text-xs text-gray-500 dark:text-gray-400">{subtitle}</div>
    {/if}
  </div>
</div>
