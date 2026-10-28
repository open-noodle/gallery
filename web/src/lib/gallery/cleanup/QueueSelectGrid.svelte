<script lang="ts">
  import { flipMotion } from '$lib/gallery/motion';
  import { flip } from 'svelte/animate';
  import CleanupTile from '$lib/gallery/cleanup/CleanupTile.svelte';
  import CleanupExpandButton from '$lib/gallery/cleanup/CleanupExpandButton.svelte';
  import { TILE_MIN_WIDTH, type TileSize } from '$lib/gallery/cleanup/tile-size';
  import { CleanupBlurReason, type CleanupAssetDto } from '@immich/sdk';
  import { Icon } from '@immich/ui';
  import { mdiCheck } from '@mdi/js';
  import { t } from 'svelte-i18n';

  type Props = {
    items: CleanupAssetDto[];
    /** `blurry` shows each tile's reason badge; `screenshots` does not. */
    variant: 'blurry' | 'screenshots';
    selected: ReadonlySet<string>;
    focusedId?: string | null;
    onToggle: (id: string) => void;
    onOpen: (id: string) => void;
    onFocus?: (id: string) => void;
    size: TileSize;
    /** Opens the photo window for a tile, growing out of its rect. */
    onExpand: (id: string, rect: DOMRect) => void;
  };

  let { items, variant, selected, focusedId = null, onToggle, onOpen, onFocus, size, onExpand }: Props = $props();

  const minWidth = $derived(TILE_MIN_WIDTH[variant][size]);
  // Screenshots are mostly tall phone screens: shown whole at their own shape, in columns.
  const isScreenshots = $derived(variant === 'screenshots');
  const PORTRAIT = 9 / 19.5;
  const PORTRAIT_FALLBACK = '9 / 19.5';
  const ratioOf = (item: CleanupAssetDto) =>
    item.width && item.height ? `${item.width} / ${item.height}` : PORTRAIT_FALLBACK;
  const widthOverHeight = (item: CleanupAssetDto) => (item.width && item.height ? item.width / item.height : PORTRAIT);
  // Screenshots sit in rows of one height, in reading order, so loading another page only adds rows at the
  // end. A portrait screenshot gets the size control's width; wider shots take proportionally more.
  const rowHeight = $derived(minWidth / PORTRAIT);
  const basisOf = (item: CleanupAssetDto) => Math.round(widthOverHeight(item) * rowHeight);

  const REASON_LABELS = {
    [CleanupBlurReason.All]: undefined,
    [CleanupBlurReason.Blurry]: 'cleanup_reason_blurry',
    [CleanupBlurReason.Dark]: 'cleanup_reason_dark',
    [CleanupBlurReason.Bright]: 'cleanup_reason_bright',
  } as const;

  const onTileClick = (event: MouseEvent, id: string) => {
    // The second click of a double-click opens the viewer instead of toggling again.
    if (event.detail > 1) {
      return;
    }
    onToggle(id);
  };
</script>

<div
  class={isScreenshots ? 'flex flex-wrap gap-2.5' : 'grid gap-2'}
  style:grid-template-columns={isScreenshots ? undefined : `repeat(auto-fill, minmax(${minWidth}px, 1fr))`}
  data-testid="cleanup-select-grid"
>
  {#each items as item (item.id)}
    {@const isSelected = selected.has(item.id)}
    {@const reason = variant === 'blurry' && item.reason ? REASON_LABELS[item.reason] : undefined}
    <div
      animate:flip={flipMotion()}
      class="group relative"
      data-asset={item.id}
      style:flex-basis={isScreenshots ? `${basisOf(item)}px` : undefined}
      style:flex-grow={isScreenshots ? widthOverHeight(item) : undefined}
      style:max-width={isScreenshots ? `${basisOf(item) * 1.6}px` : undefined}
    >
      <button
        type="button"
        class="relative block w-full rounded-md outline-none focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-primary {focusedId ===
        item.id
          ? 'outline-2 outline-offset-2 outline-primary/60'
          : ''}"
        data-testid="cleanup-item-{item.id}"
        data-asset-id={item.id}
        data-selected={isSelected}
        aria-label={item.originalFileName}
        aria-pressed={isSelected}
        onclick={(event) => onTileClick(event, item.id)}
        ondblclick={() => onOpen(item.id)}
        onfocus={() => onFocus?.(item.id)}
      >
        <CleanupTile
          id={item.id}
          thumbhash={item.thumbhash}
          duration={item.duration}
          alt={item.originalFileName}
          ratio={isScreenshots ? ratioOf(item) : undefined}
          fit={isScreenshots ? 'contain' : 'cover'}
        >
          {#snippet topLeft()}
            <span
              class="grid size-5 place-items-center rounded-full border-2 {isSelected
                ? 'border-primary bg-primary text-white'
                : 'border-white bg-black/20'}"
            >
              {#if isSelected}<Icon icon={mdiCheck} size="12" />{/if}
            </span>
          {/snippet}
          {#snippet topRight()}
            {#if reason}
              <span class="rounded-md bg-black/55 px-1.5 text-[10px] font-semibold text-white">{$t(reason)}</span>
            {/if}
          {/snippet}
        </CleanupTile>
      </button>
      <CleanupExpandButton id={item.id} {onExpand} class="absolute bottom-1.5 left-1.5" />
    </div>
  {/each}
</div>
