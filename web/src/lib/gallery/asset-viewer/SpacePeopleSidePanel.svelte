<script lang="ts">
  import SpacePersonSidePanel from '$lib/components/asset-viewer/SpacePersonSidePanel.svelte';
  import { assetViewerManager } from '$lib/managers/asset-viewer-manager.svelte';
  import { handleError } from '$lib/utils/handle-error';
  import { refreshAssetPeople } from '$lib/utils/refresh-asset-people';
  import type { AssetResponseDto } from '@immich/sdk';
  import { t } from 'svelte-i18n';

  type Props = { asset: AssetResponseDto; spaceId: string };

  const { asset, spaceId }: Props = $props();

  // The space panel applies each action (name, detach, delete a box) as it happens, so it refreshes
  // the People row after every one and stays open for the next -- unlike the owner panel, which
  // batches its changes and refreshes once on "Done". The panel does not await this, so a failed
  // refresh is reported here rather than left as an unhandled rejection.
  const handleSpacePeopleChanged = async () => {
    try {
      await refreshAssetPeople(asset.id, spaceId);
    } catch (error) {
      handleError(error, $t('errors.failed_to_load_people'));
    }
  };
</script>

<SpacePersonSidePanel
  {spaceId}
  assetId={asset.id}
  assetType={asset.type}
  onClose={() => assetViewerManager.closeEditFacesPanel()}
  onRefresh={() => void handleSpacePeopleChanged()}
/>
