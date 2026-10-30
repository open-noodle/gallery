<script lang="ts">
  import { FOCUS_RING } from '$lib/gallery/cleanup/cleanup';
  import CleanupTile from '$lib/gallery/cleanup/CleanupTile.svelte';
  import CleanupExpandButton from '$lib/gallery/cleanup/CleanupExpandButton.svelte';
  import { duration as motionDuration, pop } from '$lib/gallery/motion';
  import { getAssetMediaUrl } from '$lib/utils';
  import { getByteUnitString } from '$lib/utils/byte-units';
  import { burstMarkOf, burstTimeRange, dominantCity, type BurstMark } from '$lib/gallery/cleanup/cleanup';
  import { AssetMediaSize, CleanupBurstSource, type CleanupBurstGroupDto } from '@immich/sdk';
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
    /** Opens the photo window on a frame, growing out of its rect. */
    onExpand: (id: string, rect: DOMRect) => void;
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
    onExpand,
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

  // The frame shown large; it starts on the suggested pick.
  // svelte-ignore state_referenced_locally
  let shownId = $state(group.suggestedKeepId ?? group.assets[0].id);
  const shownIndex = $derived(
    Math.max(
      0,
      group.assets.findIndex(({ id }) => id === shownId),
    ),
  );
  const shown = $derived(group.assets[shownIndex]);
  const shownMark = $derived(markOf(shown.id));
  const shownTime = $derived(
    new Intl.DateTimeFormat(lang, { hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: 'UTC' }).format(
      new Date(shown.localDateTime),
    ),
  );

  // Best first; frames without a score go last and get no bar.
  const bySharpness = $derived([...group.assets].sort((a, b) => (b.sharpness ?? -1) - (a.sharpness ?? -1)));
  const maxSharpness = $derived(Math.max(1, ...group.assets.map((asset) => asset.sharpness ?? 0)));

  const preview = (id: string) =>
    getAssetMediaUrl({
      id,
      size: AssetMediaSize.Preview,
      cacheKey: group.assets.find((asset) => asset.id === id)?.thumbhash,
    });

  let card = $state<HTMLElement>();
  // The big frame loads its preview only once the card nears the viewport.
  let nearViewport = $state(typeof IntersectionObserver === 'undefined');
  $effect(() => {
    if (!card || nearViewport || typeof IntersectionObserver === 'undefined') {
      return;
    }
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          nearViewport = true;
          observer.disconnect();
        }
      },
      { rootMargin: '600px' },
    );
    observer.observe(card);
    return () => observer.disconnect();
  });

  // Hovering or focusing a card warms the frames either side of the one shown.
  const preloadNeighbours = () => {
    for (const neighbour of [group.assets[shownIndex - 1], group.assets[shownIndex + 1]]) {
      if (neighbour) {
        new Image().src = preview(neighbour.id);
      }
    }
  };

  const show = (id: string) => {
    shownId = id;
    onFocus?.(id);
  };

  const onFilmstripKey = (event: KeyboardEvent) => {
    const delta = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
    const next = delta === 0 ? undefined : group.assets[shownIndex + delta];
    if (!next) {
      return;
    }
    event.preventDefault();
    show(next.id);
    card?.querySelector<HTMLElement>(`[data-testid="cleanup-item-${CSS.escape(next.id)}"]`)?.focus();
  };

  // A mark landing on the big frame pops its badge.
  let markBadge = $state<HTMLElement>();
  let previousMark: { id: string; mark: string } | undefined;
  $effect(() => {
    const current = { id: shown.id, mark: shownMark };
    if (previousMark?.id === current.id && previousMark.mark !== current.mark && markBadge) {
      pop(markBadge);
    }
    previousMark = current;
  });

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

    <div
      bind:this={card}
      class="grid gap-3 md:grid-cols-[minmax(0,1fr)_220px]"
      onmouseenter={preloadNeighbours}
      onfocusin={preloadNeighbours}
      role="presentation"
    >
      <div
        class="group relative overflow-hidden rounded-xl bg-black"
        data-testid="cleanup-burst-frame-{group.groupId}"
        data-shown-id={shown.id}
        data-asset={shown.id}
      >
        <button
          type="button"
          class="block aspect-3/2 w-full outline-none focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-primary focus-visible:outline-solid"
          aria-label={shown.originalFileName}
          aria-pressed={shownMark === 'keep'}
          data-testid="cleanup-burst-frame-toggle-{group.groupId}"
          onclick={() => onToggle(shown.id)}
          ondblclick={() => onOpen?.(shown.id)}
        >
          {#if nearViewport}
            {#key shown.id}
              <img
                src={preview(shown.id)}
                alt={shown.originalFileName}
                draggable="false"
                class="size-full object-contain transition-[filter] duration-(--motion-base) {shownMark === 'trash'
                  ? 'brightness-50 grayscale'
                  : ''}"
                data-motion-reveal
                style:animation-duration="{motionDuration.quick}ms"
              />
            {/key}
          {/if}
        </button>
        {#if shown.id === group.suggestedKeepId}
          <span
            class="pointer-events-none absolute top-2.5 left-2.5 rounded-md bg-warning px-2 py-0.5 text-xs font-bold text-white uppercase"
          >
            ★ {$t('cleanup_sharpest')}
          </span>
        {/if}
        <span
          bind:this={markBadge}
          class="pointer-events-none absolute top-2.5 right-2.5 rounded-full px-2.5 py-0.5 text-xs font-semibold text-white uppercase {shownMark ===
          'keep'
            ? 'bg-success'
            : 'bg-danger'}"
        >
          {$t(shownMark === 'keep' ? 'keep' : 'trash')}
        </span>
        <span
          class="pointer-events-none absolute bottom-2.5 left-2.5 rounded-lg bg-black/60 px-2 py-1 text-xs text-white tabular-nums"
        >
          {$t('cleanup_frame_position', { values: { index: shownIndex + 1, total: group.assets.length } })} · {shownTime}
        </span>
        <CleanupExpandButton id={shown.id} {onExpand} class="absolute right-2.5 bottom-2.5" />
      </div>

      <div class="rounded-xl bg-subtle p-3" data-testid="cleanup-burst-sharpness">
        <p class="mb-2 text-xs font-semibold tracking-wide text-muted uppercase">{$t('cleanup_sharpness')}</p>
        <ul class="flex flex-col gap-2">
          {#each bySharpness as asset (asset.id)}
            {@const index = group.assets.indexOf(asset) + 1}
            <li
              class="cursor-default text-xs {asset.id === shown.id ? 'font-semibold' : ''}"
              data-testid="cleanup-burst-sharpness-row-{asset.id}"
              onmouseenter={() => show(asset.id)}
            >
              <span class="tabular-nums"
                >{$t('cleanup_frame_position', { values: { index, total: group.assets.length } })}</span
              >
              {#if asset.sharpness !== null && asset.sharpness !== undefined}
                <div class="mt-1 h-1.5 overflow-hidden rounded-full bg-light">
                  <span
                    class="block h-full rounded-full {markOf(asset.id) === 'keep' ? 'bg-success' : 'bg-warning'}"
                    data-testid="cleanup-burst-sharpness-bar-{asset.id}"
                    style:width="{Math.max(4, (asset.sharpness / maxSharpness) * 100)}%"
                  ></span>
                </div>
              {/if}
            </li>
          {/each}
        </ul>
      </div>
    </div>

    <div class="mt-2.5 grid grid-cols-4 gap-1.5 sm:grid-cols-8">
      {#each group.assets as asset (asset.id)}
        {@const tileMark = markOf(asset.id)}
        {@const suggested = asset.id === group.suggestedKeepId}
        <button
          type="button"
          class="relative block rounded-md {shownId === asset.id || focusedId === asset.id
            ? FOCUS_RING
            : 'outline-none'}"
          data-testid="cleanup-item-{asset.id}"
          data-asset-id={asset.id}
          data-asset={asset.id}
          data-mark={tileMark}
          aria-label={asset.originalFileName}
          aria-pressed={tileMark === 'keep'}
          onclick={(event) => onTileClick(event, asset.id)}
          ondblclick={() => onOpen?.(asset.id)}
          onfocus={() => show(asset.id)}
          onmouseenter={() => show(asset.id)}
          onkeydown={onFilmstripKey}
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
