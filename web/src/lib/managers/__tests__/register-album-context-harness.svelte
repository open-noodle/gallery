<script lang="ts">
  import { registerAlbumContext } from '$lib/managers/command-context-manager.svelte';
  import type { AlbumResponseDto } from '@immich/sdk';

  let { thunk }: { thunk: () => AlbumResponseDto } = $props();

  registerAlbumContext(thunk);
</script>
