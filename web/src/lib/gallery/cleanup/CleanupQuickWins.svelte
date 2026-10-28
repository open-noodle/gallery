<script lang="ts">
  import CleanupQuickWinCard from '$lib/gallery/cleanup/CleanupQuickWinCard.svelte';
  import { staggerDelay } from '$lib/gallery/motion';
  import { Route } from '$lib/route';
  import { getByteUnitString } from '$lib/utils/byte-units';
  import { queueToSlug } from '$lib/utils/cleanup';
  import {
    CleanupCountQueue,
    type CleanupAssetDto,
    type CleanupCountResponseDto,
    type CleanupTrashResponseDto,
  } from '@immich/sdk';
  import { Button, Heading, Text } from '@immich/ui';
  import { mdiBlur, mdiCellphoneScreenshot, mdiContentDuplicate, mdiHarddisk, mdiImageMultipleOutline } from '@mdi/js';
  import { locale, t } from 'svelte-i18n';

  type Props = {
    counts: Partial<Record<CleanupCountQueue, CleanupCountResponseDto | undefined>>;
    trash?: CleanupTrashResponseDto;
    /** Optional cover asset per queue; cards without one show the queue icon. */
    covers?: Partial<Record<CleanupCountQueue, CleanupAssetDto | undefined>>;
    /** False when the server's trash is turned off: Cleanup then deletes permanently and there is no trash. */
    showTrash?: boolean;
    onEmptyTrash: () => void;
  };

  let { counts, trash, covers = {}, showTrash = true, onEmptyTrash }: Props = $props();

  const cards = [
    { queue: CleanupCountQueue.SpaceHogs, icon: mdiHarddisk, title: 'cleanup_queue_space_hogs' },
    { queue: CleanupCountQueue.Bursts, icon: mdiImageMultipleOutline, title: 'cleanup_queue_bursts' },
    { queue: CleanupCountQueue.Screenshots, icon: mdiCellphoneScreenshot, title: 'cleanup_queue_screenshots' },
    { queue: CleanupCountQueue.Duplicates, icon: mdiContentDuplicate, title: 'cleanup_queue_duplicates' },
    { queue: CleanupCountQueue.Blurry, icon: mdiBlur, title: 'cleanup_queue_blurry' },
  ] as const;

  const hrefFor = (queue: CleanupCountQueue) =>
    queue === CleanupCountQueue.Duplicates
      ? Route.duplicatesUtility()
      : Route.cleanupQueue({ queue: queueToSlug(queue) });

  const formatBytes = (bytes: number) => getByteUnitString(bytes, $locale ?? undefined);
  const formatCount = (count: number) => count.toLocaleString($locale ?? undefined);
  const isAnalysing = (analysedPercent?: number) => analysedPercent !== undefined && analysedPercent < 100;

  // Units: files for space hogs, groups for duplicates, "up to" for bursts (a series can end up kept
  // whole), and "so far" while quality analysis is still running.
  const countLabel = (queue: CleanupCountQueue, { count, analysedPercent }: CleanupCountResponseDto) => {
    switch (queue) {
      case CleanupCountQueue.SpaceHogs: {
        return $t('cleanup_queue_count_files', { values: { count } });
      }
      case CleanupCountQueue.Bursts: {
        return $t('cleanup_up_to_count', { values: { count: formatCount(count) } });
      }
      case CleanupCountQueue.Duplicates: {
        return $t('cleanup_queue_count_groups', { values: { count } });
      }
      default: {
        return isAnalysing(analysedPercent)
          ? $t('cleanup_queue_count_so_far', { values: { count: formatCount(count) } })
          : formatCount(count);
      }
    }
  };
</script>

<section data-testid="cleanup-quick-wins">
  <div class="mb-2.5 flex flex-wrap items-center justify-between gap-2">
    <Heading size="tiny" tag="h3">{$t('cleanup_quick_wins')}</Heading>
    {#if showTrash}
      <div class="flex items-center gap-2" data-testid="cleanup-trash-footer">
        <Text size="tiny" color="muted" class="tabular-nums">
          {#if trash}
            {$t('cleanup_trash_holds', { values: { size: formatBytes(trash.bytes) } })}
          {:else}
            <span class="inline-block h-3 w-24 animate-pulse rounded-sm bg-gray-200 align-middle dark:bg-gray-700"
            ></span>
          {/if}
        </Text>
        <Button
          size="tiny"
          variant="ghost"
          color="danger"
          shape="round"
          disabled={!trash || trash.count === 0}
          onclick={() => onEmptyTrash()}
        >
          {$t('cleanup_trash_empty')}
        </Button>
      </div>
    {/if}
  </div>

  <div class="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-5">
    {#each cards as card, index (card.queue)}
      {@const count = counts[card.queue]}
      <div data-motion-reveal style:animation-delay={staggerDelay(index + 1)}>
        <CleanupQuickWinCard
          queue={card.queue}
          href={hrefFor(card.queue)}
          icon={card.icon}
          title={card.title}
          {count}
          cover={covers[card.queue]}
          label={(value) => countLabel(card.queue, value)}
          analysing={isAnalysing(count?.analysedPercent)
            ? $t('cleanup_analysing_percent', { values: { percent: count?.analysedPercent } })
            : undefined}
        />
      </div>
    {/each}
  </div>
</section>
