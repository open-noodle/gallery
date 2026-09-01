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
  <div data-testid="family-page" class="flex flex-col gap-2">
    {#if data.clusters.length === 0}
      <EmptyPlaceholder title={$t('family_canvas_empty_title')} text={$t('family_canvas_empty_text')} fullWidth />
      {#if data.canContribute}
        <div class="flex flex-col items-center gap-3 pb-6 text-center">
          <p class="max-w-md text-sm text-gray-500 dark:text-gray-400">{$t('family_first_run_text')}</p>
          <button
            type="button"
            data-testid="family-first-run-action"
            class="rounded-full bg-primary px-4 py-2 text-sm text-white"
            onclick={() => (linking = true)}
          >
            {$t('family_first_run_action')}
          </button>
        </div>
      {/if}
    {:else}
      {#if data.canContribute}
        <div class="flex justify-end px-1">
          <button
            type="button"
            data-testid="family-add-person"
            class="rounded-full border border-gray-300 px-3 py-1 text-sm dark:border-gray-600"
            onclick={() => (linking = true)}
          >
            {$t('family_link_add_action')}
          </button>
        </div>
      {/if}
      <div class="flex gap-2 overflow-x-auto px-1 pb-1">
        {#each data.clusters as cluster, index (cluster.rootCandidateId)}
          <button
            type="button"
            data-testid="family-cluster-chip"
            data-active={index === selectedClusterIndex}
            class="flex-none rounded-full border border-gray-300 px-3 py-1 text-sm whitespace-nowrap dark:border-gray-600"
            class:bg-primary={index === selectedClusterIndex}
            class:text-white={index === selectedClusterIndex}
            onclick={() => (selectedClusterIndex = index)}
          >
            {clusterChipLabel(cluster)} · {$t('family_canvas_people_count', { values: { count: cluster.size } })}
          </button>
        {/each}
      </div>

      {#if layoutRootId}
        <FamilyCanvas
          unions={data.unions}
          identities={data.identities}
          rootId={layoutRootId}
          canContribute={data.canContribute}
        />
      {/if}
    {/if}

    {#if linking}
      <FamilyLinkDialog onClose={closeLinkDialog} />
    {/if}
  </div>
</UserPageLayout>
