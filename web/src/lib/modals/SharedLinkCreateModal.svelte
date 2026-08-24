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
     * How many selected assets were dropped because the user does not own them. Off a space
     * surface a shared link can only cover the caller's own assets, so the caller narrows
     * `assetIds` and reports the remainder here rather than letting the request fail or the
     * narrowing go unnoticed.
     */
    excludedCount?: number;
    /**
     * #1018: the space this link is created from. Present only when the caller is a space
     * Owner/Editor; the server then authorizes the link against the space, so nothing is narrowed
     * out and the link covers what the space shows.
     */
    spaceId?: string;
    /**
     * #1018: how many of `assetIds` other members contributed. Drives the consent warning — those
     * photos are about to become publicly visible on someone else's behalf, so the caller is told
     * before the link exists rather than after.
     */
    contributedCount?: number;
  }

  let { onClose, albumId, assetIds, excludedCount = 0, spaceId, contributedCount = 0 }: Props = $props();

  let description = $state('');
  let allowDownload = $state(true);
  let allowUpload = $state(false);
  let showMetadata = $state(true);
  let password = $state('');
  let slug = $state('');
  let expiresAt = $state<string | null>(null);

  let type = $derived(albumId ? SharedLinkType.Album : SharedLinkType.Individual);

  // For a selection the caller already knows how many photos are someone else's. For an album link
  // they do not — the album's contributed share is only known server-side — so a space-scoped album
  // link always warns, with wording that claims no count.
  let showContributedWarning = $derived(
    spaceId !== undefined && (type === SharedLinkType.Album || contributedCount > 0),
  );

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
      spaceId,
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

  <!--
    #1018: publishing someone else's photo is the caller's decision to make on their behalf, so it
    is stated plainly and before the fact. Warning colours, not the muted grey of the notice above —
    that one reports a narrowing, this one reports a disclosure.
  -->
  {#if showContributedWarning}
    <div
      class="rounded-lg bg-warning/10 p-3 text-sm text-warning"
      role="status"
      data-testid="shared-link-contributed-warning"
    >
      {#if type === SharedLinkType.Album}
        {$t('shared_link_album_includes_contributed_assets')}
      {:else}
        {$t('shared_link_includes_contributed_assets', { values: { count: contributedCount } })}
      {/if}
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
