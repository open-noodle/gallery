<script lang="ts">
  // RemoveFromAlbumAction renders an IconButton → Tooltip, which needs a TooltipProvider in
  // context. The wrapper supplies it and forwards RemoveFromAlbumAction's props verbatim.
  import RemoveFromAlbumAction from './RemoveFromAlbumAction.svelte';
  import type { AlbumResponseDto } from '@immich/sdk';
  import { TooltipProvider } from '@immich/ui';

  interface Props {
    album: AlbumResponseDto;
    onRemove: ((assetIds: string[]) => void) | undefined;
    assetIds?: string[];
    menuItem?: boolean;
    'data-testid'?: string;
  }

  let props: Props = $props();
</script>

<TooltipProvider>
  <RemoveFromAlbumAction {...props} />
</TooltipProvider>
