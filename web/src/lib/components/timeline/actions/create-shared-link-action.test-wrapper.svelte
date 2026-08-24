<script lang="ts">
  // CreateSharedLinkAction renders an IconButton → Tooltip, which needs a TooltipProvider in
  // context. Mirrors remove-from-album-action.test-wrapper.svelte.
  import CreateSharedLinkAction from './CreateSharedLinkAction.svelte';
  import { TooltipProvider } from '@immich/ui';

  let { spaceId }: { spaceId?: string } = $props();
</script>

<TooltipProvider>
  <CreateSharedLinkAction {spaceId} />
</TooltipProvider>
