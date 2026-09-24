<script lang="ts">
  import CleanupTile from '$lib/components/cleanup/CleanupTile.svelte';
  import { Route } from '$lib/route';
  import { getByteUnitString } from '$lib/utils/byte-units';
  import { queueToSlug } from '$lib/utils/cleanup';
  import {
    CleanupCountQueue,
    type CleanupAssetDto,
    type CleanupCountResponseDto,
    type CleanupTrashResponseDto,
  } from '@immich/sdk';
  import { Button, Card, Heading, Icon, Text } from '@immich/ui';
  import {
    mdiBlur,
    mdiCellphoneScreenshot,
    mdiContentDuplicate,
    mdiDeleteOutline,
    mdiHarddisk,
    mdiImageMultipleOutline,
  } from '@mdi/js';
  import { locale, t } from 'svelte-i18n';

  type Props = {
    counts: Partial<Record<CleanupCountQueue, CleanupCountResponseDto | undefined>>;
    trash?: CleanupTrashResponseDto;
    /** Optional cover asset per queue; rows without one show the queue icon. */
    covers?: Partial<Record<CleanupCountQueue, CleanupAssetDto | undefined>>;
    onEmptyTrash: () => void;
  };

  let { counts, trash, covers = {}, onEmptyTrash }: Props = $props();

  const rows = [
    {
      queue: CleanupCountQueue.SpaceHogs,
      icon: mdiHarddisk,
      title: 'cleanup_queue_space_hogs',
      description: 'cleanup_queue_space_hogs_description',
    },
    {
      queue: CleanupCountQueue.Bursts,
      icon: mdiImageMultipleOutline,
      title: 'cleanup_queue_bursts',
      description: 'cleanup_queue_bursts_description',
    },
    {
      queue: CleanupCountQueue.Screenshots,
      icon: mdiCellphoneScreenshot,
      title: 'cleanup_queue_screenshots',
      description: 'cleanup_queue_screenshots_description',
    },
    {
      queue: CleanupCountQueue.Duplicates,
      icon: mdiContentDuplicate,
      title: 'cleanup_queue_duplicates',
      description: 'cleanup_queue_duplicates_description',
    },
    {
      queue: CleanupCountQueue.Blurry,
      icon: mdiBlur,
      title: 'cleanup_queue_blurry',
      description: 'cleanup_queue_blurry_description',
    },
  ] as const;

  const hrefFor = (queue: CleanupCountQueue) =>
    queue === CleanupCountQueue.Duplicates
      ? Route.duplicatesUtility()
      : Route.cleanupQueue({ queue: queueToSlug(queue) });

  const formatBytes = (bytes: number) => getByteUnitString(bytes, $locale ?? undefined);
  const formatCount = (count: number) => count.toLocaleString($locale ?? undefined);
</script>

<Card class="overflow-hidden" data-testid="cleanup-rail">
  <div class="px-4 pt-4 pb-2">
    <Heading size="tiny" tag="h3">{$t('cleanup_queues')}</Heading>
  </div>

  <div class="flex flex-col">
    {#each rows as row (row.queue)}
      {@const count = counts[row.queue]}
      {@const cover = covers[row.queue]}
      {@const analysing = count?.analysedPercent !== undefined && count.analysedPercent < 100}
      <a
        href={hrefFor(row.queue)}
        data-testid="cleanup-queue-{row.queue}"
        class="grid grid-cols-[2.5rem_minmax(0,1fr)_auto] items-center gap-3 border-t px-4 py-2.5 transition-colors first:border-t-0 hover:bg-subtle focus-visible:bg-subtle focus-visible:outline-none"
      >
        {#if cover}
          <CleanupTile id={cover.id} thumbhash={cover.thumbhash} class="size-10" />
        {:else}
          <span class="flex size-10 items-center justify-center rounded-md bg-primary/10 text-primary">
            <Icon icon={row.icon} size="20" />
          </span>
        {/if}

        <span class="min-w-0">
          <Text size="small" fontWeight="semi-bold" class="truncate">{$t(row.title)}</Text>
          {#if analysing}
            <Text size="tiny" class="truncate text-warning tabular-nums">
              {$t('cleanup_analysing_percent', { values: { percent: count?.analysedPercent } })}
            </Text>
          {:else}
            <Text size="tiny" color="muted" class="truncate">{$t(row.description)}</Text>
          {/if}
        </span>

        {#if count}
          <span class="text-end text-xs">
            <span class="block text-sm font-semibold tabular-nums">
              {#if row.queue === CleanupCountQueue.Bursts}
                {$t('cleanup_up_to_count', { values: { count: formatCount(count.count) } })}
              {:else}
                {formatCount(count.count)}
              {/if}
            </span>
            {#if count.bytes > 0}
              <span class="font-semibold text-success tabular-nums">−{formatBytes(count.bytes)}</span>
            {/if}
          </span>
        {:else}
          <span class="flex flex-col items-end gap-1" data-testid="cleanup-queue-skeleton">
            <span class="h-3.5 w-8 animate-pulse rounded-sm bg-gray-200 dark:bg-gray-700"></span>
            <span class="h-3 w-12 animate-pulse rounded-sm bg-gray-200 dark:bg-gray-700"></span>
          </span>
        {/if}
      </a>
    {/each}
  </div>

  <div class="flex items-center gap-3 border-t bg-subtle px-4 py-3" data-testid="cleanup-trash-footer">
    <span class="flex size-8 items-center justify-center rounded-lg bg-danger/10 text-danger">
      <Icon icon={mdiDeleteOutline} size="18" />
    </span>
    <Text size="small" class="min-w-0 flex-1 truncate tabular-nums">
      {#if trash}
        {$t('cleanup_trash_holds', { values: { size: formatBytes(trash.bytes) } })}
      {:else}
        <span class="inline-block h-3.5 w-24 animate-pulse rounded-sm bg-gray-200 align-middle dark:bg-gray-700"></span>
      {/if}
    </Text>
    <Button
      size="small"
      variant="ghost"
      color="danger"
      disabled={!trash || trash.count === 0}
      onclick={() => onEmptyTrash()}
    >
      {$t('empty_trash')}
    </Button>
  </div>
</Card>
