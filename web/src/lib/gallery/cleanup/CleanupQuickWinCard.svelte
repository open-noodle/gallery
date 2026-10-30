<script lang="ts">
  import { countMotion, pop } from '$lib/gallery/motion';
  import { getAssetMediaUrl } from '$lib/utils';
  import { getByteUnitString } from '$lib/utils/byte-units';
  import { AssetMediaSize, type CleanupAssetDto, type CleanupCountResponseDto } from '@immich/sdk';
  import { Icon } from '@immich/ui';
  import { mdiCheckCircle } from '@mdi/js';
  import { locale, t, type Translations } from 'svelte-i18n';
  import { Tween } from 'svelte/motion';

  type Props = {
    queue: string;
    href: string;
    icon: string;
    title: Translations;
    count?: CleanupCountResponseDto;
    cover?: CleanupAssetDto;
    /** The count in the queue's own unit ("12 files", "up to 40", "9 so far"). */
    label: (count: CleanupCountResponseDto) => string;
    /** Set while quality analysis is still running for this queue. */
    analysing?: string;
  };

  let { queue, href, icon, title, count, cover, label, analysing }: Props = $props();

  // Both figures count up from zero the first time they load, then follow later changes.
  const shownCount = new Tween(0, countMotion());
  const shownBytes = new Tween(0, countMotion());
  $effect(() => {
    void shownCount.set(count?.count ?? 0);
    void shownBytes.set(count?.bytes ?? 0);
  });

  const isClear = $derived(count?.count === 0);
  let clearCheck = $state<HTMLElement>();

  // The check lands with a pop when a queue is (or becomes) empty.
  $effect(() => {
    if (clearCheck) {
      pop(clearCheck);
    }
  });
</script>

<a
  {href}
  data-testid="cleanup-queue-{queue}"
  data-state={isClear ? 'clear' : undefined}
  data-motion-lift-group
  class="group block rounded-2xl outline-none focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-primary"
>
  <div data-motion-lift class="relative aspect-4/3 overflow-hidden rounded-2xl bg-subtle {isClear ? 'opacity-70' : ''}">
    {#if cover}
      <img
        src={getAssetMediaUrl({ id: cover.id, size: AssetMediaSize.Thumbnail, cacheKey: cover.thumbhash })}
        alt=""
        draggable="false"
        class="absolute inset-0 size-full object-cover transition-[scale] duration-(--motion-slow) ease-(--ease-settle) group-hover:scale-105"
      />
    {:else}
      <div class="absolute inset-0 grid place-items-center bg-primary/10 text-primary" data-testid="cleanup-card-icon">
        <Icon {icon} size="40" class="opacity-70" />
      </div>
    {/if}

    <div
      class="absolute inset-0 flex flex-col justify-end gap-0.5 bg-linear-to-b from-transparent from-35% to-black/80 p-3 text-white"
    >
      <span class="truncate text-sm font-semibold">{$t(title)}</span>
      {#if !count}
        <span class="flex flex-col gap-1" data-testid="cleanup-queue-skeleton">
          <span class="h-3 w-20 animate-pulse rounded-sm bg-white/30"></span>
        </span>
      {:else if isClear}
        <span class="inline-flex items-center gap-1 text-xs text-white/85">
          <span bind:this={clearCheck} class="inline-grid"><Icon icon={mdiCheckCircle} size="14" /></span>
          {$t('cleanup_all_clear')}
        </span>
      {:else}
        <span class="truncate text-xs text-white/85 tabular-nums">
          {#if analysing}
            <span class="text-yellow-300">{analysing}</span> ·
          {/if}
          <span>{label({ ...count, count: Math.round(shownCount.current) })}</span>
          {#if count.bytes > 0}
            · <span class="font-semibold text-green-300" data-testid="cleanup-card-bytes"
              >−{getByteUnitString(Math.round(shownBytes.current), $locale ?? undefined)}</span
            >
          {/if}
        </span>
      {/if}
    </div>
  </div>
</a>
