<script lang="ts">
  import { FOCUS_RING } from '$lib/gallery/cleanup/cleanup';
  import { flipMotion, pop } from '$lib/gallery/motion';
  import { flip } from 'svelte/animate';
  import CleanupTile from '$lib/gallery/cleanup/CleanupTile.svelte';
  import type { RewindMark } from '$lib/gallery/cleanup/rewind-session.svelte';
  import type { CleanupAssetDto } from '@immich/sdk';
  import { Button, Heading, Icon } from '@immich/ui';
  import { mdiCheck, mdiHeart } from '@mdi/js';
  import { t } from 'svelte-i18n';

  type Props = {
    year: number;
    yearsAgo: number;
    /** Total photos on this date in this year, including hidden ones. */
    count: number;
    city?: string | null;
    /** The tiles to show; the page drops reviewed ones when "Hide reviewed" is on. */
    assets: CleanupAssetDto[];
    marks: ReadonlyMap<string, RewindMark>;
    focusedId: string | null;
    onCycle: (id: string) => void;
    onOpen: (id: string) => void;
    onKeepRemaining: (year: number) => void;
  };

  let { year, yearsAgo, count, city, assets, marks, focusedId, onCycle, onOpen, onKeepRemaining }: Props = $props();

  const remaining = $derived(assets.filter((asset) => !asset.kept && !marks.has(asset.id)).length);

  const markOf = (asset: CleanupAssetDto) => marks.get(asset.id) ?? (asset.kept ? 'kept' : 'none');

  let section = $state<HTMLElement>();
  let reviewedBadge = $state<HTMLElement>();
  // Bookkeeping for the effects below, not state: what was marked last time, so only a change pops.
  let previousMarks: Map<string, RewindMark | undefined> | undefined;
  let previousRemaining: number | undefined;

  // A badge lands with a pop when the user marks its tile; marks already there when the page loads stay still.
  $effect(() => {
    const current = new Map(assets.map((asset) => [asset.id, marks.get(asset.id)]));
    if (previousMarks) {
      for (const [id, mark] of current) {
        if ((mark !== 'keep' && mark !== 'fav') || previousMarks.get(id) === mark) {
          continue;
        }
        const badge = section?.querySelector(`[data-testid="cleanup-mark-badge-${CSS.escape(id)}"]`);
        if (badge) {
          pop(badge);
        }
      }
    }
    previousMarks = current;
  });

  $effect(() => {
    if (previousRemaining !== undefined && previousRemaining > 0 && remaining === 0 && reviewedBadge) {
      pop(reviewedBadge);
    }
    previousRemaining = remaining;
  });

  const onTileClick = (event: MouseEvent, id: string) => {
    // The second click of a double-click opens the viewer instead of cycling the mark again.
    if (event.detail > 1) {
      return;
    }
    onCycle(id);
  };
</script>

<section bind:this={section} class="mt-5 first:mt-2" data-testid="cleanup-rewind-year-{year}">
  <div class="mb-2 flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
    <Heading size="small" tag="h3" class="tabular-nums">{year}</Heading>
    <span class="text-sm text-muted tabular-nums" data-testid="cleanup-rewind-year-meta">
      {$t('cleanup_years_ago', { values: { count: yearsAgo } })}
      {#if city}· {city}{/if}
      · {$t('items_count', { values: { count } })}
    </span>
    <div class="ms-auto">
      {#if remaining > 0}
        <Button
          size="small"
          variant="outline"
          color="secondary"
          shape="round"
          leadingIcon={mdiCheck}
          onclick={() => onKeepRemaining(year)}
          data-testid="cleanup-keep-remaining-{year}"
        >
          {$t('cleanup_keep_all_remaining')}
        </Button>
      {:else}
        <span
          bind:this={reviewedBadge}
          data-testid="cleanup-year-reviewed"
          data-motion-reveal
          class="inline-flex items-center rounded-full border border-success/30 bg-success/10 px-3 py-1 text-xs font-medium text-success"
        >
          {$t('cleanup_year_reviewed')}
        </span>
      {/if}
    </div>
  </div>

  <div class="grid grid-cols-[repeat(auto-fill,minmax(118px,1fr))] gap-1.5">
    {#each assets as asset (asset.id)}
      {@const tileMark = markOf(asset)}
      {@const focused = focusedId === asset.id}
      <button
        animate:flip={flipMotion()}
        type="button"
        class="relative block rounded-xl {focused ? FOCUS_RING : 'outline-none'}"
        data-testid="cleanup-rewind-tile-{asset.id}"
        data-asset-id={asset.id}
        data-asset={asset.id}
        data-mark={tileMark}
        data-focused={focused}
        aria-label={asset.originalFileName}
        aria-pressed={tileMark !== 'none' && tileMark !== 'kept'}
        onclick={(event) => onTileClick(event, asset.id)}
        ondblclick={() => onOpen(asset.id)}
      >
        <CleanupTile
          id={asset.id}
          thumbhash={asset.thumbhash}
          duration={asset.duration}
          radius="rounded-xl"
          class="[&_img]:transition-[filter] [&_img]:duration-(--motion-base) [&_img]:ease-(--ease-standard) {tileMark ===
          'trash'
            ? '[&_canvas]:grayscale [&_img]:brightness-50 [&_img]:grayscale'
            : ''}"
        >
          {#snippet topRight()}
            {#if tileMark === 'keep'}
              <span
                class="grid size-5.5 place-items-center rounded-full bg-success text-white shadow-sm"
                data-testid="cleanup-mark-badge-{asset.id}"
              >
                <Icon icon={mdiCheck} size="14" />
              </span>
            {:else if tileMark === 'fav'}
              <span
                class="grid size-5.5 place-items-center rounded-full bg-pink-500 text-white shadow-sm"
                data-testid="cleanup-mark-badge-{asset.id}"
              >
                <Icon icon={mdiHeart} size="13" />
              </span>
            {:else if tileMark === 'kept'}
              <span class="grid size-5.5 place-items-center rounded-full bg-white/85 text-success shadow-sm">
                <Icon icon={mdiCheck} size="14" />
              </span>
            {/if}
          {/snippet}
          {#snippet mark()}
            {#if tileMark === 'keep'}
              <span class="pointer-events-none absolute inset-0 rounded-xl border-3 border-success" data-motion-reveal
              ></span>
            {:else if tileMark === 'fav'}
              <span class="pointer-events-none absolute inset-0 rounded-xl border-3 border-pink-500" data-motion-reveal
              ></span>
            {:else if tileMark === 'trash'}
              <span
                class="pointer-events-none absolute inset-0 grid place-items-center bg-danger/35 text-xs font-bold tracking-wide text-white uppercase"
              >
                {$t('trash')}
              </span>
            {/if}
          {/snippet}
        </CleanupTile>
      </button>
    {/each}
  </div>
</section>
