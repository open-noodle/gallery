<script lang="ts">
  import { registerSpaceContext } from '$lib/managers/command-context-manager.svelte';
  import type { SharedSpaceMemberResponseDto, SharedSpaceResponseDto } from '@immich/sdk';

  let {
    spaceThunk,
    membersThunk,
  }: {
    spaceThunk: () => SharedSpaceResponseDto | undefined;
    membersThunk: () => SharedSpaceMemberResponseDto[] | undefined;
  } = $props();

  registerSpaceContext(spaceThunk, membersThunk);
</script>
