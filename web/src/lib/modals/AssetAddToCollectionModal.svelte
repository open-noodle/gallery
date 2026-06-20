<script lang="ts">
  import type { PickerCollection } from '$lib/components/shared-components/collection-selection/collection-selection-utils';
  import CollectionPickerModal from '$lib/modals/CollectionPickerModal.svelte';
  import { addAssetsToCollections } from '$lib/services/collection.service';

  type Props = {
    assetIds: string[];
    onClose: () => void;
  };

  const { assetIds, onClose }: Props = $props();

  let pending = false;

  const handleClose = async (collections?: PickerCollection[]) => {
    if (!collections || collections.length === 0) {
      onClose();
      return;
    }
    if (pending) {
      return; // re-entrancy guard: a dispatch is already in flight
    }
    pending = true;
    const ok = await addAssetsToCollections(collections, assetIds);
    pending = false;
    if (ok) {
      onClose();
    }
  };
</script>

<CollectionPickerModal assetCount={assetIds.length} onClose={handleClose} />
