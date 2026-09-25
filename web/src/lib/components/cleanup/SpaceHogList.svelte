<script lang="ts">
  import CleanupTile from '$lib/components/cleanup/CleanupTile.svelte';
  import { getByteUnitString } from '$lib/utils/byte-units';
  import { AssetTypeEnum, type CleanupAssetDto } from '@immich/sdk';
  import { Button, Card } from '@immich/ui';
  import { Duration } from 'luxon';
  import { locale, t } from 'svelte-i18n';

  type Props = {
    items: CleanupAssetDto[];
    focusedId?: string | null;
    busyIds?: ReadonlySet<string>;
    onKeep: (id: string) => void;
    onTrash: (id: string) => void;
    onOpen: (id: string) => void;
    onFocus?: (id: string) => void;
  };

  let { items, focusedId = null, busyIds, onKeep, onTrash, onOpen, onFocus }: Props = $props();

  const lang = $derived($locale ?? 'en');
  // Bars are relative to the first (largest) row.
  const largest = $derived(Math.max(items[0]?.fileSize ?? 0, 1));

  const signals = (item: CleanupAssetDto) => {
    const parts = [$t(item.type === AssetTypeEnum.Video ? 'video' : 'cleanup_photo')];
    if (item.width && item.height) {
      parts.push(`${item.width}×${item.height}`);
    }
    if (item.type === AssetTypeEnum.Video && item.duration) {
      parts.push(Duration.fromMillis(item.duration).toFormat(item.duration >= 3_600_000 ? 'h:mm:ss' : 'm:ss'));
    }
    parts.push(item.localDateTime.slice(0, 4));
    if (item.inAlbum) {
      parts.push($t('cleanup_in_album'));
    }
    if (item.isFavorite) {
      parts.push(`♥ ${$t('favorite')}`);
    }
    return parts.join(' · ');
  };
</script>

<Card data-testid="cleanup-hog-list">
  <div class="divide-y">
    {#each items as item (item.id)}
      {@const busy = busyIds?.has(item.id) ?? false}
      <div
        class="grid grid-cols-[60px_minmax(0,1fr)_auto] items-center gap-3.5 px-3.5 py-2.5 md:grid-cols-[72px_minmax(0,1fr)_200px_auto] {focusedId ===
        item.id
          ? 'bg-primary/5'
          : ''}"
        data-testid="cleanup-hog-row-{item.id}"
        data-asset-id={item.id}
      >
        <button
          type="button"
          class="block rounded-md outline-none focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-primary"
          aria-label={item.originalFileName}
          data-testid="cleanup-hog-open-{item.id}"
          onclick={() => onOpen(item.id)}
          onfocus={() => onFocus?.(item.id)}
        >
          <CleanupTile id={item.id} thumbhash={item.thumbhash} alt={item.originalFileName} aspect="aspect-16/10">
            {#snippet badge()}
              {#if item.type === AssetTypeEnum.Video}
                <span class="rounded-md bg-black/55 px-1.5 text-[10px] font-semibold text-white">▶</span>
              {/if}
            {/snippet}
          </CleanupTile>
        </button>

        <div class="min-w-0">
          <b class="block truncate text-sm" title={item.originalFileName}>{item.originalFileName}</b>
          <small class="text-xs text-muted tabular-nums" data-testid="cleanup-hog-signals">{signals(item)}</small>
          <div class="text-sm font-semibold tabular-nums md:hidden">{getByteUnitString(item.fileSize, lang)}</div>
        </div>

        <div class="hidden md:block">
          <div class="text-base font-semibold tabular-nums">{getByteUnitString(item.fileSize, lang)}</div>
          <div class="mt-1 h-1.5 overflow-hidden rounded-full bg-gray-200 dark:bg-gray-700">
            <span
              class="block h-full bg-warning"
              data-testid="cleanup-hog-bar"
              style:width="{Math.round((item.fileSize / largest) * 1000) / 10}%"
            ></span>
          </div>
        </div>

        <div class="flex gap-1.5">
          <Button
            size="small"
            variant="outline"
            color="secondary"
            shape="round"
            disabled={busy}
            onclick={() => onKeep(item.id)}
            data-testid="cleanup-hog-keep-{item.id}"
          >
            {$t('keep')}
          </Button>
          <Button
            size="small"
            color="danger"
            shape="round"
            disabled={busy}
            onclick={() => onTrash(item.id)}
            data-testid="cleanup-hog-trash-{item.id}"
          >
            {$t('trash')}
          </Button>
        </div>
      </div>
    {/each}
  </div>
</Card>
