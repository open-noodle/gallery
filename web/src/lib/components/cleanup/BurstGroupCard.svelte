<script lang="ts">
  import CleanupTile from '$lib/components/cleanup/CleanupTile.svelte';
  import { getByteUnitString } from '$lib/utils/byte-units';
  import { burstMarkOf, burstTimeRange, dominantCity, type BurstMark } from '$lib/utils/cleanup';
  import { CleanupBurstSource, type CleanupBurstGroupDto } from '@immich/sdk';
  import { Button, Card, Icon } from '@immich/ui';
  import { mdiCheck } from '@mdi/js';
  import { locale, t } from 'svelte-i18n';

  type Props = {
    group: CleanupBurstGroupDto;
    /** Marks the user changed; any member without one follows the suggestion. */
    marks: ReadonlyMap<string, BurstMark>;
    focusedId?: string | null;
    busy?: boolean;
    onToggle: (id: string) => void;
    onKeepAll: () => void;
    onStack: () => void;
    onResolve: () => void;
    onOpen?: (id: string) => void;
    onFocus?: (id: string) => void;
  };

  let {
    group,
    marks,
    focusedId = null,
    busy = false,
    onToggle,
    onKeepAll,
    onStack,
    onResolve,
    onOpen,
    onFocus,
  }: Props = $props();

  const lang = $derived($locale ?? 'en');
  const markOf = (id: string) => burstMarkOf(group, marks, id);
  const keepCount = $derived(group.assets.filter(({ id }) => markOf(id) === 'keep').length);
  const totalSize = $derived(group.assets.reduce((sum, asset) => sum + asset.fileSize, 0));
  const city = $derived(dominantCity(group.assets));
  const timeRange = $derived(burstTimeRange(group.assets[0].localDateTime, group.assets.at(-1)!.localDateTime, lang));
  const isBurstId = $derived(group.source === CleanupBurstSource.BurstId);

  const onTileClick = (event: MouseEvent, id: string) => {
    // The second click of a double-click opens the viewer instead of toggling again.
    if (event.detail > 1) {
      return;
    }
    onToggle(id);
  };

  const chip = 'inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium whitespace-nowrap';
</script>

<Card class="mb-3" data-testid="cleanup-burst-{group.groupId}">
  <div class="p-3.5 md:px-4">
    <div class="mb-2.5 flex flex-wrap items-center gap-2.5">
      <b class="text-sm tabular-nums">{timeRange}</b>
      <span class="{chip} bg-subtle tabular-nums">
        {$t('cleanup_shots_chip', {
          values: { count: group.assets.length, size: getByteUnitString(totalSize, lang) },
        })}
      </span>
      <span
        class="{chip} {isBurstId ? 'bg-subtle' : 'border-warning/30 bg-warning/10 text-warning'}"
        data-testid="cleanup-burst-source"
        data-tone={isBurstId ? 'neutral' : 'warning'}
      >
        {$t(isBurstId ? 'cleanup_source_burst' : 'cleanup_source_time_window')}
      </span>
      {#if city}
        <span class="text-xs text-muted">{city}</span>
      {/if}
      <div class="ms-auto flex flex-wrap gap-2">
        <Button
          size="small"
          variant="outline"
          color="secondary"
          shape="round"
          disabled={busy}
          onclick={onKeepAll}
          data-testid="cleanup-burst-keep-all"
        >
          {$t('cleanup_keep_all')}
        </Button>
        <Button
          size="small"
          variant="outline"
          color="secondary"
          shape="round"
          disabled={busy}
          onclick={onStack}
          data-testid="cleanup-burst-stack"
        >
          {$t('cleanup_stack_instead')}
        </Button>
        <Button size="small" shape="round" disabled={busy} onclick={onResolve} data-testid="cleanup-burst-resolve">
          {$t('cleanup_keep_n_trash_m', {
            values: { keep: keepCount, trash: group.assets.length - keepCount },
          })}
        </Button>
      </div>
    </div>

    <div class="grid grid-cols-4 gap-1.5 md:grid-cols-8">
      {#each group.assets as asset (asset.id)}
        {@const tileMark = markOf(asset.id)}
        {@const suggested = asset.id === group.suggestedKeepId}
        <button
          type="button"
          class="relative block rounded-md outline-none focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-primary {focusedId ===
          asset.id
            ? 'outline-2 outline-offset-2 outline-primary/60'
            : ''}"
          data-testid="cleanup-item-{asset.id}"
          data-asset-id={asset.id}
          data-mark={tileMark}
          aria-label={asset.originalFileName}
          aria-pressed={tileMark === 'keep'}
          onclick={(event) => onTileClick(event, asset.id)}
          ondblclick={() => onOpen?.(asset.id)}
          onfocus={() => onFocus?.(asset.id)}
        >
          <CleanupTile
            id={asset.id}
            thumbhash={asset.thumbhash}
            alt={asset.originalFileName}
            class={tileMark === 'trash' ? '[&_canvas]:grayscale [&_img]:brightness-60 [&_img]:grayscale' : ''}
          >
            {#snippet topLeft()}
              {#if suggested}
                <span
                  class="rounded-md bg-warning px-1.5 text-[10px] font-bold whitespace-nowrap text-white uppercase"
                  title={$t('cleanup_sharpest')}
                >
                  ★ {$t('cleanup_sharpest')}
                </span>
              {/if}
            {/snippet}
            {#snippet topRight()}
              {#if tileMark === 'keep'}
                <span class="grid size-5.5 place-items-center rounded-full bg-success text-white">
                  <Icon icon={mdiCheck} size="14" />
                </span>
              {/if}
            {/snippet}
            {#snippet mark()}
              {#if tileMark === 'keep'}
                <span class="pointer-events-none absolute inset-0 rounded-md border-3 border-success"></span>
              {:else}
                <span
                  class="pointer-events-none absolute inset-0 grid place-items-center rounded-md bg-danger/35 text-xs font-bold text-white uppercase"
                >
                  {$t('trash')}
                </span>
              {/if}
            {/snippet}
          </CleanupTile>
        </button>
      {/each}
    </div>

    <p class="mt-2 text-xs text-muted">{$t('cleanup_burst_hint')}</p>
  </div>
</Card>
