<script lang="ts">
  import PersonUnavailable from '#lib/gallery/people/PersonUnavailable.svelte';
  import { page } from '$app/state';
  import ErrorLayout from '../../../ErrorLayout.svelte';
</script>

{#if page.status === 404}
  <PersonUnavailable />
{:else}
  <ErrorLayout error={page.error} />
{/if}
