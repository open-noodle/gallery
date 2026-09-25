<script lang="ts">
  import { shortcuts } from '$lib/actions/shortcut';
  import OnEvents from '$lib/components/OnEvents.svelte';
  import BurstGroupCard from '$lib/components/cleanup/BurstGroupCard.svelte';
  import { queueShortcuts } from '$lib/components/cleanup/cleanup-shortcuts';
  import FormatMessage from '$lib/elements/FormatMessage.svelte';
  import { assetViewerManager } from '$lib/managers/asset-viewer-manager.svelte';
  import { CleanupQueuePager, type Removed } from '$lib/managers/cleanup-queue-pager.svelte';
  import { getByteUnitString } from '$lib/utils/byte-units';
  import { commitWithUndo, stackGroup } from '$lib/utils/cleanup-actions';
  import { burstDecision, burstMarkOf, CLEANUP_SDK_QUEUES, type BurstMark } from '$lib/utils/cleanup';
  import { handleError } from '$lib/utils/handle-error';
  import { navigate } from '$lib/utils/navigation';
  import { getCleanupQueueCount, type CleanupBurstGroupDto, type CleanupCountResponseDto } from '@immich/sdk';
  import { Button, isModalOpen } from '@immich/ui';
  import { onMount } from 'svelte';
  import { locale, t } from 'svelte-i18n';
  import { SvelteMap, SvelteSet } from 'svelte/reactivity';
  import QueueFooter from './QueueFooter.svelte';
  import QueueHeader from './QueueHeader.svelte';

  type Props = {
    title: string;
  };

  let { title }: Props = $props();

  const sdkQueue = CLEANUP_SDK_QUEUES.bursts;

  let count = $state<CleanupCountResponseDto>();
  let focusedId = $state<string | null>(null);
  let pageBusy = $state(false);
  const busyGroups = new SvelteSet<string>();
  /** Marks the user changed; any photo without one follows its group's suggestion. */
  const marks = new SvelteMap<string, BurstMark>();

  const pager = new CleanupQueuePager(sdkQueue.list);

  const lang = $derived($locale ?? 'en');
  const groupOf = $derived(
    new Map(pager.groups.flatMap((group) => group.assets.map((asset) => [asset.id, group] as const))),
  );
  const suggestedBytes = $derived(
    pager.groups.reduce(
      (sum, group) =>
        sum +
        group.assets
          .filter((asset) => burstMarkOf(group, marks, asset.id) === 'trash')
          .reduce((groupSum, asset) => groupSum + asset.fileSize, 0),
      0,
    ),
  );

  const load = async () => {
    try {
      await pager.loadMore();
    } catch (error) {
      handleError(error, $t('errors.failed_to_load_assets'));
    }
  };

  const loadCount = async () => {
    try {
      count = await getCleanupQueueCount({ queue: sdkQueue.count });
    } catch (error) {
      handleError(error, $t('errors.failed_to_load_assets'));
    }
  };

  const forget = (groups: CleanupBurstGroupDto[]) => {
    for (const group of groups) {
      for (const asset of group.assets) {
        marks.delete(asset.id);
        if (focusedId === asset.id) {
          focusedId = null;
        }
      }
    }
  };

  /**
   * After an undo, a group comes back with only its restored photos (the kept ones stay kept, so
   * the server leaves them out of bursts from now on), and only while it still has two or more.
   */
  const restoreGroups = (removed: Removed<CleanupBurstGroupDto>[], restoredIds: string[]) => {
    const restored = new Set(restoredIds);
    const entries = removed.flatMap(({ item, index }) => {
      const assets = item.assets.filter((asset) => restored.has(asset.id));
      if (assets.length < 2) {
        return [];
      }
      const suggestedKeepId = assets.some((asset) => asset.id === item.suggestedKeepId)
        ? item.suggestedKeepId
        : assets[0].id;
      return [{ index, item: { ...item, assets, suggestedKeepId } }];
    });
    pager.restoreGroups(entries);
  };

  /** Resolves whole groups in one commit: every member is kept or trashed. */
  const resolveGroups = async (
    groups: CleanupBurstGroupDto[],
    decide: (group: CleanupBurstGroupDto) => {
      keepIds: string[];
      trashIds: string[];
    },
  ) => {
    const keepIds: string[] = [];
    const trashIds: string[] = [];
    for (const group of groups) {
      const decision = decide(group);
      keepIds.push(...decision.keepIds);
      trashIds.push(...decision.trashIds);
    }

    let removed: Removed<CleanupBurstGroupDto>[] = [];
    const removeGroups = () => {
      if (removed.length > 0) {
        return;
      }

      forget(groups);
      removed = pager.removeGroups(groups.map((group) => group.groupId));
    };

    const result = await commitWithUndo(sdkQueue.commit, { keepIds, trashIds }, removeGroups, (restoredIds) => {
      restoreGroups(removed, restoredIds);
      void loadCount();
    });
    if (!result) {
      return;
    }
    if (result.failed) {
      // Some chunks committed and some did not; start the page again from the server's view.
      forget(pager.groups);
      pager.reset();
      void load();
    } else {
      removeGroups();
    }
    void loadCount();
  };

  const withGroupBusy = async (group: CleanupBurstGroupDto, action: () => Promise<unknown>) => {
    if (pageBusy || busyGroups.has(group.groupId)) {
      return;
    }
    busyGroups.add(group.groupId);
    try {
      await action();
    } finally {
      busyGroups.delete(group.groupId);
    }
  };

  const withPageBusy = async (action: () => Promise<unknown>) => {
    if (pageBusy || pager.groups.length === 0) {
      return;
    }
    pageBusy = true;
    try {
      await action();
    } finally {
      pageBusy = false;
    }
  };

  const keepAll = (group: CleanupBurstGroupDto) => ({ keepIds: group.assets.map(({ id }) => id), trashIds: [] });

  const onKeepAll = (group: CleanupBurstGroupDto) => withGroupBusy(group, () => resolveGroups([group], keepAll));

  const onResolve = (group: CleanupBurstGroupDto) =>
    withGroupBusy(group, () => resolveGroups([group], (g) => burstDecision(g, marks)));

  const onStack = (group: CleanupBurstGroupDto) =>
    withGroupBusy(group, async () => {
      // The suggested pick goes first, so it becomes the stack's primary.
      const ordered = [
        group.suggestedKeepId,
        ...group.assets.map(({ id }) => id).filter((id) => id !== group.suggestedKeepId),
      ];
      if (await stackGroup(ordered)) {
        // Stacked photos leave the bursts queue for good.
        forget([group]);
        pager.removeGroups([group.groupId]);
        void loadCount();
      }
    });

  const onKeepAllOnPage = () => withPageBusy(() => resolveGroups([...pager.groups], keepAll));

  const onAcceptSuggestions = () =>
    withPageBusy(() => resolveGroups([...pager.groups], (group) => burstDecision(group, marks)));

  const setMark = (id: string, mark?: BurstMark) => {
    const group = groupOf.get(id);
    if (!group) {
      return;
    }
    focusedId = id;
    const current = burstMarkOf(group, marks, id);
    marks.set(id, mark ?? (current === 'keep' ? 'trash' : 'keep'));
  };

  const openAsset = async (id: string | null) => {
    if (!id) {
      return;
    }

    focusedId = id;
    await navigate({ targetRoute: 'current', assetId: id });
  };

  // A double-click first registers as one click, which toggled the photo; take that back before opening.
  const onTileOpen = (id: string) => {
    setMark(id);
    void openAsset(id);
  };

  // Trashed from the viewer: the rest of that group is left for the user to resolve, unless fewer
  // than two photos remain, in which case it is no longer a burst.
  const onAssetsDelete = (ids: string[]) => {
    const deleted = new Set(ids);
    const emptied: CleanupBurstGroupDto[] = [];
    for (const group of pager.groups) {
      const assets = group.assets.filter((asset) => !deleted.has(asset.id));
      if (assets.length === group.assets.length) {
        continue;
      }
      if (assets.length < 2) {
        emptied.push(group);
        continue;
      }
      group.assets = assets;
      if (deleted.has(group.suggestedKeepId)) {
        group.suggestedKeepId = assets[0].id;
      }
    }
    forget(emptied);
    pager.removeGroups(emptied.map((group) => group.groupId));
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
          setMark(focusedId, 'trash');
        }
      },
      keep: () => {
        if (focusedId) {
          setMark(focusedId, 'keep');
        }
      },
      // Bursts are resolved a group at a time, so there is no selection to fill or clear.
      selectAll: () => {},
      clear: () => {},
      open: () => void openAsset(focusedId ?? pager.groups[0]?.assets[0]?.id ?? null),
    },
    () => assetViewerManager.isViewing || isModalOpen(),
  )}
/>

<OnEvents {onAssetsDelete} />

<QueueHeader {title}>
  {#snippet subtitle()}
    {#if count}
      <FormatMessage
        key="cleanup_bursts_subtitle"
        values={{ count: count.count, size: getByteUnitString(count.bytes, lang) }}
      >
        {#snippet children({ tag, message })}
          {#if tag === 'b'}<b class="text-success">{message}</b>{:else}{message}{/if}
        {/snippet}
      </FormatMessage>
    {/if}
  {/snippet}
  {#snippet actions()}
    <Button
      size="small"
      variant="outline"
      color="secondary"
      shape="round"
      disabled={pageBusy || pager.groups.length === 0}
      onclick={() => void onKeepAllOnPage()}
      data-testid="cleanup-bursts-keep-all-on-page"
    >
      {$t('cleanup_keep_all_on_page')}
    </Button>
    <Button
      size="small"
      shape="round"
      disabled={pageBusy || pager.groups.length === 0}
      loading={pageBusy}
      onclick={() => void onAcceptSuggestions()}
      data-testid="cleanup-bursts-accept-suggestions"
    >
      {$t('cleanup_accept_suggestions', { values: { size: getByteUnitString(suggestedBytes, lang) } })}
    </Button>
  {/snippet}
</QueueHeader>

{#each pager.groups as group (group.groupId)}
  <BurstGroupCard
    {group}
    {marks}
    {focusedId}
    busy={pageBusy || busyGroups.has(group.groupId)}
    onToggle={(id) => setMark(id)}
    onKeepAll={() => void onKeepAll(group)}
    onStack={() => void onStack(group)}
    onResolve={() => void onResolve(group)}
    onOpen={onTileOpen}
    onFocus={(id) => (focusedId = id)}
  />
{/each}

<QueueFooter {pager} empty={pager.groups.length === 0} onLoadMore={() => void load()} />
