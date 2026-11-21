<script lang="ts">
  import { TooltipProvider } from '@immich/ui';
  import type { ComponentProps } from 'svelte';
  import Manage from '../../../../routes/(user)/people/manage/+page.svelte';

  let props: ComponentProps<typeof Manage> = $props();
</script>

<TooltipProvider>
  <Manage {...props} />
</TooltipProvider>
