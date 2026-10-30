<script lang="ts">
  import CleanupViewerLayout from '$lib/gallery/cleanup/pages/CleanupViewerLayout.svelte';
  import RewindDay from '$lib/gallery/cleanup/pages/rewind/RewindDay.svelte';
  import type { PageData } from './$types';

  type Props = {
    data: PageData;
  };

  let { data }: Props = $props();
</script>

<CleanupViewerLayout asset={data.asset}>
  <!-- Keyed on the date so the marks, loaded years and focus start afresh on every date. -->
  {#key data.monthDay}
    <RewindDay monthDay={data.monthDay} years={data.years} firstYear={data.firstYear} title={data.meta.title} />
  {/key}
</CleanupViewerLayout>
