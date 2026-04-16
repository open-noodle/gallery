<script lang="ts">
  import { Icon } from '@immich/ui';
  import { mdiTag } from '@mdi/js';
  import type { TagResponseDto } from '@immich/sdk';

  interface Props {
    item: TagResponseDto;
  }
  let { item }: Props = $props();
</script>

<div
  class="flex h-[52px] items-center gap-3 rounded-lg px-3 py-2 transition-colors duration-[80ms] ease-out group-data-[selected]:bg-primary/10"
>
  <div class="flex h-8 w-8 items-center justify-center rounded-md bg-subtle/40">
    {#if item.color}
      <span class="h-2 w-2 rounded-full" style:background-color={item.color}></span>
    {:else}
      <Icon icon={mdiTag} size="1.125em" class="text-gray-500 dark:text-gray-400" />
    {/if}
  </div>
  <div class="min-w-0 flex-1">
    <div class="truncate text-sm font-medium">{item.name}</div>
  </div>
</div>
