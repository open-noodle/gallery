<script lang="ts">
  import { getAssetMediaUrl } from '$lib/utils';
  import { getFaceCropTransform, type FaceBox } from '$lib/utils/people-utils';
  import { AssetMediaSize } from '@immich/sdk';

  interface Props {
    face: FaceBox & { assetId: string };
    label: string;
    class?: string;
  }

  let { face, label, class: className = '' }: Props = $props();

  const url = $derived(getAssetMediaUrl({ id: face.assetId, size: AssetMediaSize.Preview }));
  const transform = $derived(getFaceCropTransform(face));
</script>

<div
  role="img"
  aria-label={label}
  data-testid="face-crop"
  class="aspect-square w-full overflow-hidden rounded-lg bg-gray-200 bg-no-repeat dark:bg-gray-800 {className}"
  style="background-image: url('{url}'); background-size: {transform.backgroundSize}; background-position: {transform.backgroundPosition};"
></div>
