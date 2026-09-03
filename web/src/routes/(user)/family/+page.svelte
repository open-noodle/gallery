<script lang="ts">
  import { goto, invalidateAll } from '$app/navigation';
  import FamilyCanvas from '$lib/components/family/FamilyCanvas.svelte';
  import FamilyLinkDialog from '$lib/components/family/FamilyLinkDialog.svelte';
  import UserPageLayout from '$lib/components/layouts/UserPageLayout.svelte';
  import EmptyPlaceholder from '$lib/components/shared-components/EmptyPlaceholder.svelte';
  import { Route } from '$lib/route';
  import { handlePromiseError } from '$lib/utils';
  import { assignGenerations } from '$lib/utils/family-layout';
  import { t } from 'svelte-i18n';
  import type { PageData } from './$types';

  interface Props {
    data: PageData;
  }

  let { data }: Props = $props();

  // A1/A12: a viewer whose effective family access is `none` gets no `/family` surface at all —
  // redirected away rather than shown an error or an empty version of the page.
  if (!data.granted) {
    handlePromiseError(goto(Route.photos()));
  }

  // D8.3: never recompute the cluster LIST — `data.clusters` comes straight from the server. This
  // only reuses the shared reachability walk to work out which of the server's clusters the
  // viewer's own root happens to fall in, so the page can open on it by default.
  const clusterContainsRoot = (rootCandidateId: string) =>
    data.rootId !== null && assignGenerations(data.unions, rootCandidateId).has(data.rootId);

  const defaultClusterIndex = (() => {
    if (data.rootId === null) {
      return 0;
    }
    const index = data.clusters.findIndex((cluster) => clusterContainsRoot(cluster.rootCandidateId));
    return index === -1 ? 0 : index;
  })();

  let selectedClusterIndex = $state(defaultClusterIndex);
  const selectedCluster = $derived(data.clusters[selectedClusterIndex] as (typeof data.clusters)[number] | undefined);

  // D6: layout is computed per viewer, never stored — the viewer's own root when it is actually a
  // member of the selected cluster, otherwise that cluster's own `rootCandidateId`, so there is
  // always some anchor to lay the graph out around.
  const layoutRootId = $derived(
    selectedCluster
      ? data.rootId && clusterContainsRoot(selectedCluster.rootCandidateId)
        ? data.rootId
        : selectedCluster.rootCandidateId
      : null,
  );

  // The canvas can only rearrange people it already renders, and it only renders people who are
  // in a union — so without this dialog a cold start has no way to create its first union, and a
  // populated graph has no way to admit anyone new. Both entry points open the same dialog.
  let linking = $state(false);

  const closeLinkDialog = (created: boolean) => {
    linking = false;
    if (created) {
      handlePromiseError(invalidateAll());
    }
  };

  const clusterChipLabel = (cluster: (typeof data.clusters)[number]) =>
    clusterContainsRoot(cluster.rootCandidateId) ? $t('family_canvas_cluster_around_you') : cluster.label;
</script>

<UserPageLayout title={data.meta.title} description={$t('family_canvas_subtitle')}>
  <div data-testid="family-page" class="flex flex-col gap-3">
    {#if data.clusters.length === 0}
      <EmptyPlaceholder title={$t('family_canvas_empty_title')} text={$t('family_canvas_empty_text')} fullWidth />
      {#if data.canContribute}
        <div class="flex flex-col items-center gap-3 pb-6 text-center">
          <p class="max-w-md text-sm text-gray-500 dark:text-gray-400">{$t('family_first_run_text')}</p>
          <button
            type="button"
            data-testid="family-first-run-action"
            class="rounded-full bg-primary px-4 py-2 text-sm text-white dark:text-black"
            onclick={() => (linking = true)}
          >
            {$t('family_first_run_action')}
          </button>
        </div>
      {/if}
    {:else}
      <!-- Cluster chips: the answer to "multiple family trees" — disconnected components of the
           graph, computed per request and never stored (D8.3).
           The trailing action is how a NEW one gets started. The canvas tray can only drop someone
           onto a card that is already drawn, which by definition joins them to the tree on screen;
           a family with no connection to it needs a union created from two people at once, which
           is exactly what the link dialog does. -->
      <div class="flex items-center gap-2 overflow-x-auto pb-1">
        {#each data.clusters as cluster, index (cluster.rootCandidateId)}
          {@const active = index === selectedClusterIndex}
          <button
            type="button"
            data-testid="family-cluster-chip"
            data-active={active}
            class={[
              'flex-none rounded-full border px-3.5 py-1.5 text-[13px] whitespace-nowrap transition-colors',
              active
                ? 'border-transparent bg-primary/15 text-primary'
                : 'border-gray-300 text-gray-500 hover:bg-gray-100 dark:border-gray-700 dark:hover:bg-gray-800',
            ]}
            onclick={() => (selectedClusterIndex = index)}
          >
            <b class="font-semibold">{clusterChipLabel(cluster)}</b>
            · {$t('family_canvas_people_count', { values: { count: cluster.size } })}
          </button>
        {/each}

        {#if data.canContribute}
          <button
            type="button"
            data-testid="family-new-cluster"
            class="flex-none rounded-full border border-dashed border-gray-400 px-3.5 py-1.5 text-[13px] whitespace-nowrap text-gray-500 transition-colors hover:bg-gray-100 dark:border-gray-600 dark:hover:bg-gray-800"
            onclick={() => (linking = true)}
          >
            {$t('family_canvas_new_family_action')}
          </button>
        {/if}
      </div>

      {#if layoutRootId}
        <FamilyCanvas
          unions={data.unions}
          identities={data.identities}
          rootId={layoutRootId}
          viewerRootId={data.rootId}
          canContribute={data.canContribute}
          onGraphChanged={() => handlePromiseError(invalidateAll())}
        />
      {/if}
    {/if}

    {#if linking}
      <FamilyLinkDialog onClose={closeLinkDialog} />
    {/if}
  </div>
</UserPageLayout>
