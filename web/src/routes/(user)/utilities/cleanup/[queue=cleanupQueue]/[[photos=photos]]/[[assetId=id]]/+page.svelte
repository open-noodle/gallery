<script lang="ts">
  import CleanupViewerLayout from '$lib/gallery/cleanup/pages/CleanupViewerLayout.svelte';
  import CleanupQueuePage from '$lib/gallery/cleanup/pages/queues/CleanupQueuePage.svelte';
  import type { PageData } from './$types';

  type Props = {
    data: PageData;
  };

  let { data }: Props = $props();
</script>

<CleanupViewerLayout asset={data.asset}>
  <CleanupQueuePage queue={data.queue} slug={data.slug} title={data.meta.title} />
</CleanupViewerLayout>
