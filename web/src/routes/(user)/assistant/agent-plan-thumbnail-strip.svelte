<script lang="ts">
  import { getAssetMediaUrl } from '$lib/utils';
  import { AssetMediaSize } from '@immich/sdk';
  import { t } from 'svelte-i18n';
  import { buildAgentPlanThumbnailStrip, type OperationReviewGroup } from './agent-operation-plan-ui';
  import { editActionsForOperation, fetchEditPreview } from './agent-plan-edit-preview';

  interface Props {
    group: OperationReviewGroup;
    variant?: 'strip' | 'mosaic' | 'compact';
    maxVisible?: number;
  }

  let { group, variant = 'strip', maxVisible }: Props = $props();
  let failedAssetIds = $state(new Set<string>());
  /** Map from assetId → object URL (ready) or 'failed'. Only populated when editActions is non-null. */
  let afterUrls = $state<Record<string, string | 'failed'>>({});

  const strip = $derived(buildAgentPlanThumbnailStrip(group, maxVisible));

  // Derive the first operation's raw DTO so we can inspect its type + payload.
  const firstOp = $derived(group.operations[0]?.operation);
  const editActions = $derived(
    firstOp ? editActionsForOperation(firstOp.type, firstOp.payload as Record<string, unknown>) : null,
  );

  const wrapperClass = $derived(
    variant === 'mosaic' ? 'grid grid-cols-3 gap-2 sm:grid-cols-4' : 'flex flex-wrap gap-1.5',
  );
  const tileBaseClass =
    'relative overflow-hidden border border-gray-200 bg-gray-100 dark:border-gray-700 dark:bg-gray-800';
  const tileClass = (index: number) => {
    if (variant === 'mosaic') {
      return `${tileBaseClass} aspect-square rounded-lg ${index === 0 ? 'sm:col-span-2 sm:row-span-2' : ''}`;
    }

    if (variant === 'compact') {
      return `${tileBaseClass} size-10 rounded`;
    }

    return `${tileBaseClass} size-14 rounded-md`;
  };
  const overflowClass = $derived(
    variant === 'mosaic'
      ? 'flex aspect-square items-center justify-center rounded-lg border border-gray-200 bg-gray-100 text-sm font-semibold text-gray-600 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300'
      : variant === 'compact'
        ? 'flex size-10 items-center justify-center rounded border border-gray-200 bg-gray-100 text-xs font-semibold text-gray-600 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300'
        : 'flex size-14 items-center justify-center rounded-md border border-gray-200 bg-gray-100 text-sm font-semibold text-gray-600 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300',
  );

  const markFailed = (assetId: string) => {
    if (failedAssetIds.has(assetId)) {
      return;
    }

    failedAssetIds = new Set([...failedAssetIds, assetId]);
  };

  /**
   * Fetch after-preview URLs whenever the edit actions or displayed asset IDs change.
   * This is the "iterate" loop: when the user revises, editActions changes → re-fetch.
   * Cleanup aborts in-flight requests and revokes previously created object URLs.
   */
  $effect(() => {
    const actions = editActions; // read reactive dependency
    const currentAssetIds = strip.assetIds.slice(); // snapshot — reactive dependency via strip

    if (!actions) {
      afterUrls = {};
      return;
    }

    const ac = new AbortController();
    const createdUrls: string[] = [];

    void (async () => {
      const results: Record<string, string | 'failed'> = {};

      for (const assetId of currentAssetIds) {
        if (ac.signal.aborted) {
          break;
        }

        try {
          const url = await fetchEditPreview(assetId, actions, ac.signal);

          if (ac.signal.aborted) {
            // The cleanup already ran — revoke immediately and discard.
            URL.revokeObjectURL(url);
            break;
          }

          createdUrls.push(url);
          results[assetId] = url;
        } catch {
          if (!ac.signal.aborted) {
            results[assetId] = 'failed';
          }
        }
      }

      if (!ac.signal.aborted) {
        afterUrls = results;
      }
    })();

    return () => {
      ac.abort();
      for (const url of createdUrls) {
        URL.revokeObjectURL(url);
      }
    };
  });
</script>

{#if strip.totalCount > 0}
  <div
    class="mt-4"
    data-testid="agent-plan-thumbnail-strip"
    aria-label={$t('assistant_operation_thumbnail_strip_label', { values: { count: strip.totalCount } })}
  >
    {#if editActions}
      <!-- Before/after preview mode: render one before+after pair per representative asset. -->
      {#if strip.hasThumbnails}
        <div class="flex flex-col gap-3">
          {#each strip.assetIds as assetId, index (assetId)}
            <div class="flex items-start gap-2">
              <!-- Before tile -->
              <figure class={tileClass(index)} data-testid="agent-plan-thumbnail-tile">
                <img
                  class="size-full object-cover"
                  data-testid="agent-plan-thumbnail-image"
                  src={getAssetMediaUrl({ id: assetId, size: AssetMediaSize.Thumbnail })}
                  alt={$t('assistant_operation_preview_before')}
                  loading="lazy"
                  draggable="false"
                />
                <span
                  class="absolute bottom-0 left-0 right-0 bg-black/40 px-1 py-0.5 text-center text-[9px] text-white"
                >
                  {$t('assistant_operation_preview_before')}
                </span>
              </figure>

              <!-- After tile -->
              {#if afterUrls[assetId] === 'failed'}
                <figure
                  class="{tileClass(index)} flex items-center justify-center"
                  data-testid="agent-plan-after-failed"
                >
                  <span
                    class="absolute inset-0 flex items-center justify-center bg-gray-200 px-1 text-center text-[10px] leading-tight text-gray-600 dark:bg-gray-800 dark:text-gray-300"
                  >
                    {$t('assistant_operation_preview_failed')}
                  </span>
                </figure>
              {:else if afterUrls[assetId]}
                <figure class={tileClass(index)}>
                  <img
                    class="size-full object-cover"
                    data-testid="agent-plan-after-image"
                    src={afterUrls[assetId] as string}
                    alt={$t('assistant_operation_preview_after')}
                    loading="lazy"
                    draggable="false"
                  />
                  <span
                    class="absolute bottom-0 left-0 right-0 bg-black/40 px-1 py-0.5 text-center text-[9px] text-white"
                  >
                    {$t('assistant_operation_preview_after')}
                  </span>
                </figure>
              {:else}
                <!-- Loading state -->
                <figure
                  class="{tileClass(index)} flex items-center justify-center"
                  aria-label={$t('assistant_operation_preview_loading')}
                >
                  <span class="absolute inset-0 animate-pulse bg-gray-200 dark:bg-gray-700"></span>
                </figure>
              {/if}
            </div>
          {/each}

          {#if strip.hasMore}
            <p class="text-xs text-gray-500 dark:text-gray-400">
              {$t('assistant_operation_preview_applies_to_all', { values: { count: strip.totalCount } })}
            </p>
          {/if}
        </div>
      {:else}
        <p class="rounded-md bg-gray-100 px-3 py-2 text-sm text-gray-500 dark:bg-gray-800 dark:text-gray-400">
          {$t('assistant_operation_thumbnail_empty', { values: { count: strip.totalCount } })}
        </p>
      {/if}
    {:else}
      <!-- Existing plain-strip rendering (no before/after preview). -->
      {#if strip.hasThumbnails}
        <div class={wrapperClass}>
          {#each strip.assetIds as assetId, index (assetId)}
            <figure class={tileClass(index)} data-testid="agent-plan-thumbnail-tile">
              <img
                class="size-full object-cover"
                data-testid="agent-plan-thumbnail-image"
                src={getAssetMediaUrl({ id: assetId, size: AssetMediaSize.Thumbnail })}
                alt={$t('assistant_operation_thumbnail_alt', {
                  values: { index: index + 1, count: strip.totalCount },
                })}
                loading="lazy"
                draggable="false"
                onerror={() => markFailed(assetId)}
              />
              {#if failedAssetIds.has(assetId)}
                <span
                  class="absolute inset-0 flex items-center justify-center bg-gray-200 px-1 text-center text-[10px] leading-tight text-gray-600 dark:bg-gray-800 dark:text-gray-300"
                >
                  {$t('assistant_operation_thumbnail_unavailable')}
                </span>
              {/if}
            </figure>
          {/each}

          {#if strip.hasMore}
            <div
              class={overflowClass}
              aria-label={$t('assistant_operation_thumbnail_overflow_label', {
                values: { count: strip.overflowCount },
              })}
            >
              {$t('assistant_operation_thumbnail_overflow', { values: { count: strip.overflowCount } })}
            </div>
          {/if}
        </div>
      {:else}
        <p class="rounded-md bg-gray-100 px-3 py-2 text-sm text-gray-500 dark:bg-gray-800 dark:text-gray-400">
          {$t('assistant_operation_thumbnail_empty', { values: { count: strip.totalCount } })}
        </p>
      {/if}
    {/if}
  </div>
{/if}
