<script lang="ts">
  import CleanupHubPage from '$lib/gallery/cleanup/pages/CleanupHubPage.svelte';
  import type { PageData } from './$types';

  type Props = {
    data: PageData;
  };

  let { data }: Props = $props();
</script>

<CleanupHubPage {data} />
