<script lang="ts">
  import { authManager } from '$lib/managers/auth-manager.svelte';

  const isReadOnlyDemo = $derived(authManager.isReadOnlyDemo);
</script>

{#if isReadOnlyDemo}
  <div
    data-testid="read-only-demo-notice"
    class="mb-4 rounded-md border border-blue-300 bg-blue-50 px-4 py-3 text-sm text-blue-950 dark:border-blue-700 dark:bg-blue-950/30 dark:text-blue-100"
  >
    <p class="font-medium">Read-only demo</p>
    <p>Admin controls are visible for evaluation. Changes are disabled in this public demo.</p>
  </div>
{/if}
