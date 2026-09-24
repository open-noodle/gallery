<script lang="ts">
  import { shortcuts } from '$lib/actions/shortcut';
  import OnEvents from '$lib/components/OnEvents.svelte';
  import { queueShortcuts } from '$lib/components/cleanup/cleanup-shortcuts';
  import SpaceHogList from '$lib/components/cleanup/SpaceHogList.svelte';
  import FormatMessage from '$lib/elements/FormatMessage.svelte';
  import { assetViewerManager } from '$lib/managers/asset-viewer-manager.svelte';
  import { authManager } from '$lib/managers/auth-manager.svelte';
  import { CleanupQueuePager, type Removed } from '$lib/managers/cleanup-queue-pager.svelte';
  import { getByteUnitString } from '$lib/utils/byte-units';
  import { keep, trashWithUndo } from '$lib/utils/cleanup-actions';
  import {
    CLEANUP_SDK_QUEUES,
    CLEANUP_SPACE_HOG_DEFAULT_MIN_SIZE,
    CLEANUP_SPACE_HOG_MIN_SIZES,
  } from '$lib/utils/cleanup';
  import { handleError } from '$lib/utils/handle-error';
  import { navigate } from '$lib/utils/navigation';
  import {
    CleanupAssetTypeFilter,
    getCleanupQueueCount,
    type CleanupAssetDto,
    type CleanupCountResponseDto,
  } from '@immich/sdk';
  import { isModalOpen } from '@immich/ui';
  import { onMount } from 'svelte';
  import { locale, t } from 'svelte-i18n';
  import { SvelteSet } from 'svelte/reactivity';
  import QueueFooter from './QueueFooter.svelte';
  import QueueHeader from './QueueHeader.svelte';

  type Props = {
    title: string;
  };

  let { title }: Props = $props();

  const TYPES = [
    { value: CleanupAssetTypeFilter.Video, label: 'videos' },
    { value: CleanupAssetTypeFilter.Image, label: 'photos' },
    { value: CleanupAssetTypeFilter.All, label: 'all' },
  ] as const;

  const sdkQueue = CLEANUP_SDK_QUEUES.space_hogs;

  let type = $state<CleanupAssetTypeFilter>(CleanupAssetTypeFilter.Video);
  let minSize = $state(CLEANUP_SPACE_HOG_DEFAULT_MIN_SIZE);
  let count = $state<CleanupCountResponseDto>();
  let focusedId = $state<string | null>(null);
  const busyIds = new SvelteSet<string>();

  const pager = new CleanupQueuePager(sdkQueue.list, () => ({ $type: type, minSize }));

  const lang = $derived($locale ?? 'en');
  // Everything the user has uploaded, as tracked for storage quotas. Without it the share of the
  // library is left out of the header.
  const usage = $derived(authManager.authenticated ? authManager.user.quotaUsageInBytes : null);
  const percent = $derived(
    count && usage && usage > 0 ? Math.min(100, Math.round((count.bytes / usage) * 100)) : undefined,
  );

  const load = async () => {
    try {
      await pager.loadMore();
    } catch (error) {
      handleError(error, $t('errors.failed_to_load_assets'));
    }
  };

  let countRequest = 0;
  const loadCount = async () => {
    const request = ++countRequest;
    try {
      const result = await getCleanupQueueCount({ queue: sdkQueue.count, $type: type, minSize });
      if (request === countRequest) {
        count = result;
      }
    } catch (error) {
      handleError(error, $t('errors.failed_to_load_assets'));
    }
  };

  const applyFilters = () => {
    focusedId = null;
    count = undefined;
    pager.reset();
    void load();
    void loadCount();
  };

  const removeLocally = (ids: string[]) => {
    if (focusedId && ids.includes(focusedId)) {
      focusedId = null;
    }
    return pager.removeItems(ids);
  };

  const withBusy = async (id: string, action: () => Promise<unknown>) => {
    if (busyIds.has(id)) {
      return;
    }
    busyIds.add(id);
    try {
      await action();
    } finally {
      busyIds.delete(id);
    }
  };

  const onTrash = (id: string) =>
    withBusy(id, async () => {
      let removed: Removed<CleanupAssetDto>[] = [];
      const result = await trashWithUndo(
        sdkQueue.commit,
        [id],
        (trashed) => (removed = removeLocally(trashed)),
        () => {
          pager.restoreItems(removed);
          void loadCount();
        },
      );
      if (result) {
        removeLocally(result.skipped.map((skipped) => skipped.id));
        void loadCount();
      }
    });

  const onKeep = (id: string) =>
    withBusy(id, async () => {
      if (await keep(sdkQueue.commit, [id], removeLocally)) {
        void loadCount();
      }
    });

  const openAsset = async (id: string | null) => {
    if (!id) {
      return;
    }

    focusedId = id;
    await navigate({ targetRoute: 'current', assetId: id });
  };

  const onAssetsDelete = (ids: string[]) => {
    removeLocally(ids);
    void loadCount();
  };

  onMount(() => {
    void load();
    void loadCount();
  });
</script>

<svelte:document
  use:shortcuts={queueShortcuts(
    {
      trash: () => {
        if (focusedId) {
          void onTrash(focusedId);
        }
      },
      keep: () => {
        if (focusedId) {
          void onKeep(focusedId);
        }
      },
      // Space hogs acts on one row at a time, so there is no selection to fill or clear.
      selectAll: () => {},
      clear: () => (focusedId = null),
      open: () => void openAsset(focusedId ?? pager.items[0]?.id ?? null),
    },
    () => assetViewerManager.isViewing || isModalOpen(),
  )}
/>

<OnEvents {onAssetsDelete} />

<QueueHeader {title}>
  {#snippet subtitle()}
    {#if count}
      {@const values = { count: count.count, size: getByteUnitString(count.bytes, lang), percent: percent ?? 0 }}
      <FormatMessage
        key={percent === undefined ? 'cleanup_space_hogs_subtitle_no_percent' : 'cleanup_space_hogs_subtitle'}
        {values}
      >
        {#snippet children({ tag, message })}
          {#if tag === 'b'}<b class="text-dark">{message}</b>{:else}{message}{/if}
        {/snippet}
      </FormatMessage>
    {/if}
  {/snippet}
  {#snippet actions()}
    <div class="inline-flex rounded-full border bg-light p-0.5" role="group">
      {#each TYPES as option (option.value)}
        <button
          type="button"
          class="rounded-full px-3 py-1 text-xs font-semibold transition-colors {type === option.value
            ? 'bg-primary/10 text-primary'
            : 'text-muted hover:text-dark'}"
          aria-pressed={type === option.value}
          data-testid="cleanup-hog-type-{option.value}"
          onclick={() => {
            if (type === option.value) {
              return;
            }

            type = option.value;
            applyFilters();
          }}
        >
          {$t(option.label)}
        </button>
      {/each}
    </div>
    <label
      class="inline-flex items-center gap-1.5 rounded-full border bg-light px-3 py-1 text-xs font-semibold text-dark"
    >
      {$t('cleanup_min_size')}
      <select
        class="cursor-pointer bg-transparent font-semibold tabular-nums outline-none"
        value={minSize}
        data-testid="cleanup-hog-min-size"
        onchange={(event) => {
          minSize = Number(event.currentTarget.value);
          applyFilters();
        }}
      >
        {#each CLEANUP_SPACE_HOG_MIN_SIZES as size (size)}
          <option value={size}>{getByteUnitString(size, lang)}</option>
        {/each}
      </select>
    </label>
  {/snippet}
</QueueHeader>

{#if pager.items.length > 0}
  <SpaceHogList
    items={pager.items}
    {focusedId}
    {busyIds}
    onKeep={(id) => void onKeep(id)}
    onTrash={(id) => void onTrash(id)}
    onOpen={(id) => void openAsset(id)}
    onFocus={(id) => (focusedId = id)}
  />
{/if}

<QueueFooter {pager} empty={pager.items.length === 0} onLoadMore={() => void load()} />
