<script lang="ts">
  import ActionMenuItem from '$lib/components/ActionMenuItem.svelte';
  import { getStackBulkActions } from '$lib/services/stack.service';
  import { t } from 'svelte-i18n';

  // Stack / Unstack in an album's selection menu, as on /photos. The album reloads after either
  // (TimelineManager #reloadAlbumStacks), since the server picks the photo that stands for a stack.
  const { Stack, Unstack } = $derived(getStackBulkActions($t));
</script>

<ActionMenuItem action={Stack} />
<ActionMenuItem action={Unstack} />
