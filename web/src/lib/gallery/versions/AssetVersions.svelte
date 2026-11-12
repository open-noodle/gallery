<script lang="ts">
  import AssetVersionCard from '#lib/gallery/versions/AssetVersionCard.svelte';
  import AssetVersionPreviewModal from '#lib/gallery/versions/AssetVersionPreviewModal.svelte';
  import { getAssetVersionDownloadUrl, getAssetVersionThumbnailUrl } from '#lib/gallery/versions/asset-versions.ts';
  import { authManager } from '#lib/managers/auth-manager.svelte.ts';
  import { featureFlagsManager } from '#lib/managers/feature-flags-manager.svelte.ts';
  import { downloadUrl, getSharedLink } from '#lib/utils.ts';
  import { handleError } from '#lib/utils/handle-error.ts';
  import {
    AssetTypeEnum,
    AssetVersionImageSize,
    getAssetVersions,
    type AssetResponseDto,
    type AssetVersionResponseDto,
    type AssetVersionsResponseDto,
  } from '@immich/sdk';
  import { Icon, Text, modalManager, toastManager } from '@immich/ui';
  import { mdiLayersOutline } from '@mdi/js';
  import { onDestroy, untrack } from 'svelte';
  import { t } from 'svelte-i18n';

  // The Versions section of a photo's detail panel (specs/2026-11-07-asset-versions-design.md): the files of the
  // photo's shot (its edits, the camera's own file, the RAW), its own file included, with the one its picture comes
  // from marked. Everyone who sees the photo sees them. Gallery arranges them itself, so the section only shows,
  // previews and downloads. Hidden when the photo has none, and when
  // the call fails: a server without versions answers 404, which reads as "no versions" (rule 6).

  type Props = {
    asset: AssetResponseDto;
  };

  let { asset }: Props = $props();

  let response = $state<AssetVersionsResponseDto>();
  let failed = $state(false);
  let controller: AbortController | undefined;

  const isImage = $derived(asset.type === AssetTypeEnum.Image);
  // A response for another photo (the user moved on before it arrived) is never shown.
  const current = $derived(isImage && response?.assetId === asset.id ? response : undefined);
  const versions = $derived(current?.versions ?? []);
  const isOwner = $derived(authManager.authenticated && authManager.user.id === asset.ownerId);
  // Like the viewer's download action: a shared link shows it only when the link allows downloads.
  const canDownload = $derived(!authManager.isSharedLink || isOwner || !!getSharedLink()?.allowDownload);
  // Only a server known to have versions turns a failed load into a message; any other failure hides the section.
  const showLoadError = $derived(
    failed && isImage && featureFlagsManager.valueOrUndefined?.assetVersions === true && !authManager.isSharedLink,
  );

  const load = async (assetId: string) => {
    controller?.abort();
    const own = new AbortController();
    controller = own;
    try {
      const result = await getAssetVersions({ id: assetId, ...authManager.params }, { signal: own.signal });
      if (!own.signal.aborted) {
        response = result;
        failed = false;
      }
    } catch {
      if (!own.signal.aborted) {
        response = undefined;
        failed = true;
      }
    }
  };

  // Derived, so a refreshed copy of the same asset (a favourite, an edit) does not fetch again.
  const photoId = $derived(asset.id);

  $effect(() => {
    const assetId = photoId;
    if (!isImage) {
      controller?.abort();
      return;
    }
    untrack(() => {
      failed = false;
      void load(assetId);
    });
  });

  onDestroy(() => controller?.abort());

  const handlePreview = (version: AssetVersionResponseDto) => {
    void modalManager.show(AssetVersionPreviewModal, {
      title: version.originalFileName,
      src: getAssetVersionThumbnailUrl(asset.id, version, AssetVersionImageSize.Preview),
      thumbhash: version.thumbhash,
    });
  };

  const handleDownload = (version: AssetVersionResponseDto) => {
    const filename = version.originalFileName;
    try {
      toastManager.primary($t('downloading_asset_filename', { values: { filename } }));
      downloadUrl(getAssetVersionDownloadUrl(asset.id, version.id), filename);
    } catch (error) {
      handleError(error, $t('errors.error_downloading', { values: { filename } }));
    }
  };
</script>

{#if versions.length > 0}
  <!-- laid out as a row of the Details list (same indent): its icon on the left, the versions beside it -->
  <section class="px-6 dark:text-immich-dark-fg" data-testid="detail-panel-versions">
    <div class="flex gap-4 py-4">
      <div><Icon icon={mdiLayersOutline} size="24" /></div>
      <div class="w-full min-w-0">
        <p class="mb-2 text-sm opacity-75">{$t('asset_versions')}</p>
        <ul class="flex flex-col gap-2">
          {#each versions as version (version.id)}
            <AssetVersionCard {asset} {version} {canDownload} onPreview={handlePreview} onDownload={handleDownload} />
          {/each}
        </ul>
      </div>
    </div>
  </section>
{:else if showLoadError}
  <section class="px-6 pt-6" data-testid="detail-panel-versions-error">
    <Text size="tiny" color="muted">{$t('asset_versions_load_failed')}</Text>
  </section>
{/if}
