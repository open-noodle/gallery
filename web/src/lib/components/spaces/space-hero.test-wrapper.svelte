<script lang="ts">
  import type { SharedSpaceResponseDto } from '@immich/sdk';
  import { TooltipProvider } from '@immich/ui';
  import SpaceHero from './space-hero.svelte';

  interface Props {
    space: SharedSpaceResponseDto;
    currentRole?: string;
    gradientClass?: string;
    canEdit?: boolean;
    onChangeCover?: () => void;
    onEditSpace?: () => void;
    onReposition?: () => void;
    repositioning?: boolean;
    onSavePosition?: (cropY: number) => void;
    onCancelReposition?: () => void;
    compact?: boolean;
    collapsed?: boolean;
  }

  let props: Props = $props();
</script>

<TooltipProvider>
  <SpaceHero {...props} />
</TooltipProvider>
