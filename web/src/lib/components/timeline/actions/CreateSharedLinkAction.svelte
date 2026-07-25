<script lang="ts">
  import { assetMultiSelectManager } from '$lib/managers/asset-multi-select-manager.svelte';
  import { authManager } from '$lib/managers/auth-manager.svelte';
  import SharedLinkCreateModal from '$lib/modals/SharedLinkCreateModal.svelte';
  import { IconButton, modalManager, toastManager } from '@immich/ui';
  import { mdiShareVariantOutline } from '@mdi/js';
  import { t } from 'svelte-i18n';

  const handleClick = async () => {
    // `Permission.AssetShare` is owner ∪ partner only and rejects the ENTIRE request if it names
    // one asset the caller does not own, so send the owned subset rather than the raw selection.
    // The excluded count is surfaced in the modal so the narrowing is never silent.
    //
    // `ownedAssets` falls back to the FULL selection when unauthenticated, so gate on
    // authentication too rather than trusting that field alone.
    const ownedAssetIds = authManager.authenticated ? assetMultiSelectManager.ownedAssets.map(({ id }) => id) : [];
    if (ownedAssetIds.length === 0) {
      // Surfaces that render this action ungated (partner page, regular album page, search) can
      // hold a selection the user owns none of. The modal would offer a form the server can only
      // reject ("Invalid assetIds"), so say so now instead of after it is filled in.
      toastManager.warning($t('shared_link_nothing_owned_to_share'));
      return;
    }
    await modalManager.show(SharedLinkCreateModal, {
      assetIds: ownedAssetIds,
      excludedCount: assetMultiSelectManager.assets.length - ownedAssetIds.length,
    });
  };
</script>

<IconButton
  shape="round"
  color="secondary"
  variant="ghost"
  aria-label={$t('share')}
  icon={mdiShareVariantOutline}
  onclick={handleClick}
/>
