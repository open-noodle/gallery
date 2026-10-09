<script lang="ts">
  import CleanupTile from '$lib/components/cleanup/CleanupTile.svelte';
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
  };

  let { items, variant, selected, focusedId = null, onToggle, onOpen, onFocus }: Props = $props();

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

<div class="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-2" data-testid="cleanup-select-grid">
  {#each items as item (item.id)}
    {@const isSelected = selected.has(item.id)}
    {@const reason = variant === 'blurry' && item.reason ? REASON_LABELS[item.reason] : undefined}
    <button
      type="button"
      class="relative block rounded-md outline-none focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-primary {focusedId ===
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
      <CleanupTile id={item.id} thumbhash={item.thumbhash} duration={item.duration} alt={item.originalFileName}>
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
  {/each}
</div>
