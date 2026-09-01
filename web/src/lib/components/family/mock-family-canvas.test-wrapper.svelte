<script lang="ts">
  import type { FamilyIdentityDto, FamilyUnionDto } from '@immich/sdk';

  interface Props {
    unions: FamilyUnionDto[];
    identities: Record<string, FamilyIdentityDto>;
    rootId: string;
    canContribute: boolean;
  }

  let { unions, identities, rootId, canContribute }: Props = $props();
</script>

<div
  data-testid="family-canvas"
  data-root-id={rootId}
  data-can-contribute={String(canContribute)}
  data-union-count={unions.length}
  data-identity-count={Object.keys(identities).length}
></div>
