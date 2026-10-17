<script lang="ts">
  import PeoplePage from '$lib/gallery/people/PeoplePage.svelte';
  import type { PageData } from './$types';

  interface Props {
    data: PageData;
  }

  let { data }: Props = $props();
</script>

<PeoplePage {data} />
