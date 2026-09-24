<script lang="ts">
  import Thumbhash from '$lib/components/Thumbhash.svelte';
  import { getAssetMediaUrl } from '$lib/utils';
  import { AssetMediaSize } from '@immich/sdk';
  import { Duration } from 'luxon';
  import type { Snippet } from 'svelte';

  type Props = {
    id: string;
    thumbhash: string | null;
    /** Video length in milliseconds; renders a ▶ tag when set. */
    duration?: number | null;
    alt?: string;
    class?: string;
    /** Bottom-left badge, e.g. a blur reason or ★ SHARPEST. */
    badge?: Snippet;
    /** Top-right corner, e.g. a selection or mark dot. */
    topRight?: Snippet;
    /** Full-tile overlay for keep / favourite / trash marks. */
    mark?: Snippet;
  };

  let { id, thumbhash, duration, alt = '', class: className = '', badge, topRight, mark }: Props = $props();

  let loaded = $state(false);

  const src = $derived(getAssetMediaUrl({ id, size: AssetMediaSize.Thumbnail, cacheKey: thumbhash }));
  const durationLabel = $derived.by(() => {
    if (!duration) {
      return;
    }
    return Duration.fromMillis(duration).toFormat(duration >= 3_600_000 ? 'h:mm:ss' : 'm:ss');
  });
</script>

<div
  class="relative aspect-square overflow-hidden rounded-md bg-gray-200 dark:bg-gray-700 {className}"
  data-testid="cleanup-tile"
>
  {#if thumbhash && !loaded}
    <Thumbhash base64ThumbHash={thumbhash} class="absolute inset-0 size-full" />
  {/if}
  <img
    {src}
    {alt}
    loading="lazy"
    draggable="false"
    class="absolute inset-0 size-full object-cover transition-opacity {loaded ? 'opacity-100' : 'opacity-0'}"
    onload={() => (loaded = true)}
  />
  {#if durationLabel}
    <span
      class="absolute right-1.5 bottom-1.5 rounded-md bg-black/55 px-1.5 text-[10px] font-semibold text-white tabular-nums"
    >
      ▶ {durationLabel}
    </span>
  {/if}
  {#if badge}
    <div class="absolute bottom-1.5 left-1.5">{@render badge()}</div>
  {/if}
  {#if topRight}
    <div class="absolute top-1.5 right-1.5">{@render topRight()}</div>
  {/if}
  {@render mark?.()}
</div>
