<script lang="ts">
  import SharedLinkFormFields from '$lib/components/SharedLinkFormFields.svelte';
  import { handleCreateSharedLink } from '$lib/services/shared-link.service';
  import { SharedLinkType } from '@immich/sdk';
  import { FormModal } from '@immich/ui';
  import { mdiLink } from '@mdi/js';
  import { t } from 'svelte-i18n';

  interface Props {
    onClose: () => void;
    albumId?: string;
    assetIds?: string[];
    /**
     * How many selected assets were dropped because the user does not own them. A shared link
     * can only cover the caller's own assets, so the caller narrows `assetIds` and reports the
     * remainder here rather than letting the request fail or the narrowing go unnoticed.
     */
    excludedCount?: number;
  }

  let { onClose, albumId, assetIds, excludedCount = 0 }: Props = $props();

  let description = $state('');
  let allowDownload = $state(true);
  let allowUpload = $state(false);
  let showMetadata = $state(true);
  let password = $state('');
  let slug = $state('');
  let expiresAt = $state<string | null>(null);

  let type = $derived(albumId ? SharedLinkType.Album : SharedLinkType.Individual);

  const onSubmit = async () => {
    const success = await handleCreateSharedLink({
      type,
      albumId,
      assetIds,
      expiresAt,
      allowUpload,
      description,
      password,
      allowDownload,
      showMetadata,
      slug,
    });
    if (success) {
      onClose();
    }
  };
</script>

<FormModal
  title={$t('create_link_to_share')}
  icon={mdiLink}
  size="small"
  {onClose}
  {onSubmit}
  submitText={$t('create_link')}
>
  {#if type === SharedLinkType.Album}
    <div>{$t('album_with_link_access')}</div>
  {/if}

  {#if type === SharedLinkType.Individual}
    <div>{$t('create_link_to_share_description')}</div>
  {/if}

  {#if excludedCount > 0}
    <div class="text-sm text-gray-500 dark:text-gray-400" data-testid="shared-link-excluded-notice">
      {$t('shared_link_excludes_other_owners', { values: { count: excludedCount } })}
    </div>
  {/if}

  <SharedLinkFormFields
    bind:slug
    bind:password
    bind:description
    bind:allowDownload
    bind:allowUpload
    bind:showMetadata
    bind:expiresAt
  />
</FormModal>
