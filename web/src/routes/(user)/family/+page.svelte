<script lang="ts">
  import { goto } from '$app/navigation';
  import FamilyCanvas from '$lib/components/family/FamilyCanvas.svelte';
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

  const clusterChipLabel = (cluster: (typeof data.clusters)[number]) =>
    clusterContainsRoot(cluster.rootCandidateId) ? $t('family_canvas_cluster_around_you') : cluster.label;
</script>

<UserPageLayout title={data.meta.title} description={$t('family_canvas_subtitle')}>
  <div data-testid="family-page" class="flex flex-col gap-2">
    {#if data.clusters.length === 0}
      <EmptyPlaceholder title={$t('family_canvas_empty_title')} text={$t('family_canvas_empty_text')} fullWidth />
    {:else}
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
        <!-- Slice 11 checked again: `GET /family/me` (`FamilyMyRootResponseDto`) still carries
             only `identityId`, no `access` field — the fix that would let the caller's own
             `view`/`contribute` level be resolved from a real signal has not landed on this
             branch. `canContribute` stays wired to the same `false` placeholder slice 10 used
             (see its report) rather than inventing a second way to guess the level; the drop
             zones and union editor added in slice 11 are gated on this exact prop, so wiring a
             real signal here is the one change slice 12+ needs to make to turn them on. -->
        <FamilyCanvas unions={data.unions} identities={data.identities} rootId={layoutRootId} canContribute={false} />
      {/if}
    {/if}
  </div>
</UserPageLayout>
