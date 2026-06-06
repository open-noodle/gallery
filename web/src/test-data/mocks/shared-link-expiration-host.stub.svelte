<script lang="ts">
  import SharedLinkExpiration from '$lib/components/SharedLinkExpiration.svelte';

  let expiresAt = $state<string | null>(null);
</script>

<!-- Surfaces the value SharedLinkExpiration binds out, so tests can assert the exact
     string that would be sent to the API as `expiresAt`. -->
<div data-testid="expires-at-value">{expiresAt ?? ''}</div>
<SharedLinkExpiration bind:expiresAt />
