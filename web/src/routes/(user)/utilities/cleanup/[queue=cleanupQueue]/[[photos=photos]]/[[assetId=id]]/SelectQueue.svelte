<script lang="ts">
  import { shortcuts } from '$lib/actions/shortcut';
  import OnEvents from '$lib/components/OnEvents.svelte';
  import { queueShortcuts } from '$lib/components/cleanup/cleanup-shortcuts';
  import QueueSelectGrid from '$lib/components/cleanup/QueueSelectGrid.svelte';
  import { assetViewerManager } from '$lib/managers/asset-viewer-manager.svelte';
  import { CleanupQueuePager, type Removed } from '$lib/managers/cleanup-queue-pager.svelte';
  import { keep, trashWithUndo } from '$lib/utils/cleanup-actions';
  import { CLEANUP_SDK_QUEUES } from '$lib/utils/cleanup';
  import { handleError } from '$lib/utils/handle-error';
  import { navigate } from '$lib/utils/navigation';
  import {
    CleanupBlurReason,
    CleanupStrictness,
    getCleanupQueueCount,
    type CleanupAssetDto,
    type CleanupCountResponseDto,
  } from '@immich/sdk';
  import { Button, Card, isModalOpen } from '@immich/ui';
  import { onMount } from 'svelte';
  import { t } from 'svelte-i18n';
  import { SvelteSet } from 'svelte/reactivity';
  import QueueFooter from './QueueFooter.svelte';
  import QueueHeader from './QueueHeader.svelte';

  type Props = {
    queue: 'blurry' | 'screenshots';
    title: string;
  };

  let { queue, title }: Props = $props();

  const STRICTNESS = [CleanupStrictness.Lenient, CleanupStrictness.Balanced, CleanupStrictness.Strict];
  const STRICTNESS_LABELS = [
    'cleanup_strictness_lenient',
    'cleanup_strictness_balanced',
    'cleanup_strictness_strict',
  ] as const;
  const REASONS = [
    { reason: CleanupBlurReason.All, label: 'all' },
    { reason: CleanupBlurReason.Blurry, label: 'cleanup_reason_blurry' },
    { reason: CleanupBlurReason.Dark, label: 'cleanup_reason_dark' },
    { reason: CleanupBlurReason.Bright, label: 'cleanup_reason_bright' },
  ] as const;

  // The page keys this component on the queue, so the prop is only read once.
  // svelte-ignore state_referenced_locally
  const sdkQueue = CLEANUP_SDK_QUEUES[queue];
  // svelte-ignore state_referenced_locally
  const isBlurry = queue === 'blurry';

  let reason = $state<CleanupBlurReason>(CleanupBlurReason.All);
  let strictness = $state(1);
  let hideFaces = $state(true);
  let counts = $state<Partial<Record<CleanupBlurReason, CleanupCountResponseDto>>>({});
  let focusedId = $state<string | null>(null);
  let acting = $state(false);
  const selected = new SvelteSet<string>();

  const filters = () =>
    isBlurry ? { reason, strictness: STRICTNESS[strictness], hideFaces } : ({} as Record<string, never>);
  const pager = new CleanupQueuePager(sdkQueue.list, filters);

  const total = $derived(counts[CleanupBlurReason.All]?.count);

  const load = async () => {
    try {
      await pager.loadMore();
    } catch (error) {
      handleError(error, $t('errors.failed_to_load_assets'));
    }
  };

  let countsRequest = 0;
  const loadCounts = async () => {
    const request = ++countsRequest;
    const reasons = isBlurry ? REASONS.map((r) => r.reason) : [CleanupBlurReason.All];
    try {
      const results = await Promise.all(
        reasons.map((r) =>
          getCleanupQueueCount(
            isBlurry
              ? { queue: sdkQueue.count, reason: r, strictness: STRICTNESS[strictness], hideFaces }
              : { queue: sdkQueue.count },
          ),
        ),
      );
      if (request === countsRequest) {
        counts = Object.fromEntries(reasons.map((r, i) => [r, results[i]]));
      }
    } catch (error) {
      handleError(error, $t('errors.failed_to_load_assets'));
    }
  };

  const applyFilters = () => {
    selected.clear();
    focusedId = null;
    pager.reset();
    void load();
    void loadCounts();
  };

  const setReason = (next: CleanupBlurReason) => {
    if (next === reason) {
      return;
    }

    reason = next;
    applyFilters();
  };

  /** The selection, or the focused tile when nothing is selected. */
  const targets = () => (selected.size > 0 ? [...selected] : focusedId ? [focusedId] : []);

  const removeLocally = (ids: string[]) => {
    for (const id of ids) {
      selected.delete(id);
    }
    if (focusedId && ids.includes(focusedId)) {
      focusedId = null;
    }
    return pager.removeItems(ids);
  };

  const onTrash = async (ids = targets()) => {
    if (acting || ids.length === 0) {
      return;
    }
    acting = true;
    let removed: Removed<CleanupAssetDto>[] = [];
    try {
      const result = await trashWithUndo(
        sdkQueue.commit,
        ids,
        (trashed) => (removed = removeLocally(trashed)),
        (restored) => {
          pager.restoreItems(removed.filter(({ item }) => restored.includes(item.id)));
          void loadCounts();
        },
      );
      if (result) {
        // Skipped photos are already gone or out of scope; drop them from the page too.
        removeLocally(result.skipped.map(({ id }) => id));
        void loadCounts();
      }
    } finally {
      acting = false;
    }
  };

  const onKeep = async (ids = targets()) => {
    if (acting || ids.length === 0) {
      return;
    }
    acting = true;
    try {
      if (await keep(sdkQueue.commit, ids, removeLocally)) {
        void loadCounts();
      }
    } finally {
      acting = false;
    }
  };

  const toggle = (id: string) => {
    focusedId = id;
    if (selected.has(id)) {
      selected.delete(id);
    } else {
      selected.add(id);
    }
  };

  const openAsset = async (id: string | null) => {
    if (!id) {
      return;
    }

    focusedId = id;
    await navigate({ targetRoute: 'current', assetId: id });
  };

  // A double-click first registers as one click, which toggled the tile; take that back before opening.
  const onTileOpen = (id: string) => {
    toggle(id);
    void openAsset(id);
  };

  const onAssetsDelete = (ids: string[]) => {
    removeLocally(ids);
    void loadCounts();
  };

  onMount(() => {
    void load();
    void loadCounts();
  });

  const chip =
    'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium whitespace-nowrap tabular-nums transition-colors';
</script>

<svelte:document
  use:shortcuts={queueShortcuts(
    {
      trash: () => void onTrash(),
      keep: () => void onKeep(),
      selectAll: () => {
        for (const item of pager.items) {
          selected.add(item.id);
        }
      },
      clear: () => selected.clear(),
      open: () => void openAsset(focusedId ?? pager.items[0]?.id ?? null),
    },
    () => assetViewerManager.isViewing || isModalOpen(),
  )}
/>

<OnEvents {onAssetsDelete} />

<QueueHeader {title}>
  {#snippet subtitle()}
    {#if total !== undefined}
      {$t(isBlurry ? 'cleanup_blurry_subtitle' : 'cleanup_screenshots_subtitle', { values: { count: total } })}
    {/if}
  {/snippet}
  {#snippet actions()}
    <Button
      size="small"
      variant="outline"
      color="secondary"
      shape="round"
      disabled={acting || selected.size === 0}
      onclick={() => void onKeep([...selected])}
      data-testid="cleanup-keep-selected"
    >
      {$t('cleanup_not_a_problem')}
    </Button>
    <Button
      size="small"
      color="danger"
      shape="round"
      disabled={acting || selected.size === 0}
      loading={acting}
      onclick={() => void onTrash([...selected])}
      data-testid="cleanup-trash-selected"
    >
      {$t('cleanup_trash_selected', { values: { count: selected.size } })}
    </Button>
  {/snippet}
</QueueHeader>

{#if isBlurry}
  <Card class="mb-3.5" data-testid="cleanup-blurry-toolbar">
    <div class="flex flex-wrap items-center gap-3 px-3.5 py-2.5">
      <div class="flex flex-wrap gap-2" role="group">
        {#each REASONS as option (option.reason)}
          {@const active = reason === option.reason}
          <button
            type="button"
            class="{chip} {active
              ? 'border-primary/30 bg-primary/10 text-primary'
              : 'bg-subtle text-dark hover:border-primary/30'}"
            aria-pressed={active}
            data-testid="cleanup-reason-{option.reason}"
            onclick={() => setReason(option.reason)}
          >
            {$t(option.label)}
            {#if counts[option.reason]}<span>{counts[option.reason]?.count}</span>{/if}
          </button>
        {/each}
      </div>
      <label class="ms-auto flex items-center gap-2 text-xs text-muted">
        {$t('cleanup_strictness')}
        <input
          type="range"
          min="0"
          max="2"
          step="1"
          class="w-40 accent-primary"
          value={strictness}
          aria-valuetext={$t(STRICTNESS_LABELS[strictness])}
          data-testid="cleanup-strictness"
          oninput={(event) => (strictness = Number(event.currentTarget.value))}
          onchange={applyFilters}
        />
        <b class="min-w-16 text-dark">{$t(STRICTNESS_LABELS[strictness])}</b>
      </label>
      <label class="{chip} cursor-pointer bg-subtle text-dark">
        <input
          type="checkbox"
          class="accent-primary"
          checked={hideFaces}
          data-testid="cleanup-hide-faces"
          onchange={(event) => {
            hideFaces = event.currentTarget.checked;
            applyFilters();
          }}
        />
        {$t('cleanup_hide_faces')}
      </label>
    </div>
  </Card>
{/if}

<QueueSelectGrid
  items={pager.items}
  variant={queue}
  {selected}
  {focusedId}
  onToggle={toggle}
  onOpen={onTileOpen}
  onFocus={(id) => (focusedId = id)}
/>

<QueueFooter {pager} empty={pager.items.length === 0} onLoadMore={() => void load()} />
