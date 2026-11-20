<script lang="ts">
  import type { PickerCollection } from '#lib/components/shared-components/collection-selection/collection-selection-utils.ts';
  import { authManager } from '#lib/managers/auth-manager.svelte.ts';
  import CollectionPickerModal from '#lib/modals/CollectionPickerModal.svelte';
  import { addAssetsToCollections } from '#lib/services/collection.service.ts';
  import { collectSearchResultAssets, type SearchTerms } from '#lib/services/search.service.ts';
  import { handleError } from '#lib/utils/handle-error.ts';
  import { LoadingSpinner, Modal, ModalBody } from '@immich/ui';
  import { t } from 'svelte-i18n';

  interface Props {
    terms: SearchTerms;
    total: number;
    smartSearchEnabled: boolean;
    language: string;
    onClose: () => void;
  }

  const { terms, total, smartSearchEnabled, language, onClose }: Props = $props();

  let pending = $state(false);

  const handleClose = async (collections?: PickerCollection[]) => {
    if (!collections || collections.length === 0) {
      onClose();
      return;
    }
    if (pending) {
      return; // re-entrancy guard
    }
    pending = true;
    try {
      const assets = await collectSearchResultAssets(terms, { smartSearchEnabled, language });
      const assetIds = assets.map(({ id }) => id);
      // The server rejects a space add that includes any asset the caller does not own, so spaces
      // get only the caller's own assets. Albums keep the full selection.
      const userId = authManager.user?.id;
      const ownedAssetIds = assets.filter(({ ownerId }) => ownerId === userId).map(({ id }) => id);
      const ok = await addAssetsToCollections(collections, assetIds, { spaceAssetIds: ownedAssetIds });
      if (ok) {
        onClose();
      }
    } catch (error) {
      handleError(error, $t('loading_search_results_failed'));
    } finally {
      pending = false;
    }
  };
</script>

{#if pending}
  <Modal title={$t('add_to_album_or_space')} onClose={() => {}} size="medium">
    <ModalBody>
      <div class="flex items-center justify-center gap-3 py-16" data-testid="preparing-indicator">
        <LoadingSpinner />
        <span>{$t('preparing_assets')}</span>
      </div>
    </ModalBody>
  </Modal>
{:else}
  <CollectionPickerModal assetCount={total} onClose={handleClose} />
{/if}
