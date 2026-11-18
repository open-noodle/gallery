<script lang="ts">
  import type { FamilyIdentityDto, FamilyUnionDto } from '@immich/sdk';

  interface Props {
    unions: FamilyUnionDto[];
    identities: Record<string, FamilyIdentityDto>;
    rootId: string;
    viewerRootId: string | null;
    canContribute: boolean;
    onGraphChanged?: () => void;
  }

  let { unions, identities, rootId, viewerRootId, canContribute, onGraphChanged }: Props = $props();
</script>

<div
  data-testid="family-canvas"
  data-root-id={rootId}
  data-viewer-root-id={viewerRootId ?? ''}
  data-can-contribute={String(canContribute)}
  data-has-graph-changed-handler={String(onGraphChanged !== undefined)}
  data-union-count={unions.length}
  data-identity-count={Object.keys(identities).length}
></div>
