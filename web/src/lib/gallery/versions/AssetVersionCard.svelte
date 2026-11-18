<script lang="ts">
  import Thumbhash from '#lib/components/Thumbhash.svelte';
  import {
    DETAIL_PANEL,
    getAssetVersionThumbnailUrl,
    versionFormat,
    versionKindKey,
    versionPopupBox,
    versionTime,
    versionZoneLabel,
  } from '#lib/gallery/versions/asset-versions.ts';
  import { locale } from '#lib/stores/preferences.store.ts';
  import { getByteUnitString } from '#lib/utils/byte-units.ts';
  import {
    AssetVersionImageSize,
    AssetVersionKind,
    type AssetResponseDto,
    type AssetVersionResponseDto,
  } from '@immich/sdk';
  import { Icon, IconButton } from '@immich/ui';
  import { mdiDownload, mdiImageOffOutline } from '@mdi/js';
  import { t } from 'svelte-i18n';

  // One file of the photo's shot: what it is (and whether the photo's picture comes from it), when it was taken or,
  // for an edit, made, its name, its picture and its format and size, with a download. The card of the shown file
  // is outlined and carries a "Shown" tag.

  type Props = {
    /** The photo the version belongs to: every address goes through it, and its clock is the versions' clock. */
    asset: Pick<AssetResponseDto, 'id' | 'fileCreatedAt' | 'localDateTime' | 'exifInfo'>;
    version: AssetVersionResponseDto;
    canDownload: boolean;
    onPreview: (version: AssetVersionResponseDto) => void;
    onDownload: (version: AssetVersionResponseDto) => void;
  };

  let { asset, version, canDownload, onPreview, onDownload }: Props = $props();

  // A missing thumbnail (404, not generated yet) falls back to the thumbhash, else an icon. The list is keyed by
  // version id, so a card never changes version and this state never needs a reset.
  let thumbnailFailed = $state(false);
  let thumbnailLoaded = $state(false);

  const thumbnailUrl = $derived(getAssetVersionThumbnailUrl(asset.id, version));

  // With the mouse on the thumbnail, the larger picture shows beside the info panel, so the versions can be compared
  // by moving down the list. It is the picture a click opens. A touch has no hover: there the click is the way.
  let thumbnail = $state<HTMLImageElement>();
  let popup = $state<ReturnType<typeof versionPopupBox>>();
  let previewFailed = $state(false);

  const previewUrl = $derived(getAssetVersionThumbnailUrl(asset.id, version, AssetVersionImageSize.Preview));

  const showPopup = (event: PointerEvent) => {
    // the loaded thumbnail gives the picture's shape: before it has loaded, or when it is missing, nothing shows
    if (event.pointerType !== 'mouse' || previewFailed || !thumbnail?.naturalWidth) {
      return;
    }
    const button = event.currentTarget as HTMLElement;
    const { top, height, left, right } = button.getBoundingClientRect();
    popup = versionPopupBox(
      { top, height },
      button.closest(DETAIL_PANEL)?.getBoundingClientRect() ?? { left, right },
      { width: thumbnail.naturalWidth, height: thumbnail.naturalHeight },
      { width: window.innerWidth, height: window.innerHeight },
    );
  };

  const hidePopup = () => {
    popup = undefined;
  };

  // The thumbnail keeps the picture's shape. Until it has loaded, the server's size for the file gives the shape.
  const shape = $derived(version.width && version.height ? `${version.width} / ${version.height}` : '3 / 2');

  const formatAndSize = $derived(
    [
      versionFormat(version),
      version.fileSizeInByte ? getByteUnitString(version.fileSizeInByte, $locale) : undefined,
    ].filter(Boolean),
  );
  const dimensions = $derived(version.width && version.height ? `${version.width} × ${version.height}` : undefined);
  // an edit: when it was made; any other file: when it was taken, on the camera's clock as in the info panel. With
  // the time zone, in its short form: the long one does not fit on the line
  const time = $derived.by(() => {
    const at = versionTime(version, asset);
    if (!at) {
      return;
    }
    const zone = versionZoneLabel(at, !!asset.exifInfo?.timeZone);
    const text = at.toLocaleString({ dateStyle: 'medium', timeStyle: 'short' }, { locale: $locale });
    return zone ? `${text} ${zone}` : text;
  });
</script>

<li
  class={[
    'rounded-xl border px-2.5 py-2',
    version.shown
      ? 'border-immich-primary bg-immich-primary/5 dark:border-immich-dark-primary dark:bg-immich-dark-primary/10'
      : 'border-transparent bg-gray-100 dark:bg-immich-dark-gray',
  ]}
  data-testid="asset-version-card"
  data-version-id={version.id}
>
  <!-- what the file is and when it was taken, on one line. The label is the kind alone, so that the time and its
       zone fit beside it on every card: "Shown" has its own tag beside the thumbnail -->
  <div class="mb-1 flex items-center gap-1.5">
    <span
      class={[
        'shrink-0 rounded-full border px-2 text-xs leading-[18px] font-medium whitespace-nowrap',
        version.kind === AssetVersionKind.Edit
          ? 'border-transparent bg-immich-primary/10 text-immich-primary dark:bg-immich-dark-primary/15 dark:text-immich-dark-primary'
          : 'border-gray-300 bg-white dark:border-gray-600 dark:bg-transparent',
      ]}
      data-testid="asset-version-kind"
    >
      {$t(versionKindKey(version.kind))}
    </span>
    {#if time}
      <span class="min-w-0 truncate text-xs opacity-75" title={time} data-testid="asset-version-date">
        {time}
      </span>
    {/if}
  </div>

  <!-- the name has the card's whole width; the type, size and dimensions use the room beside the thumbnail -->
  <p class="truncate text-xs" title={version.originalFileName}>{version.originalFileName}</p>
  <div class="mt-1 flex items-center gap-2">
    <button
      type="button"
      class="relative block h-16 max-w-28 shrink-0 overflow-hidden rounded-lg bg-gray-200 focus-visible:outline-2 focus-visible:outline-primary dark:bg-gray-700"
      style:aspect-ratio={shape}
      aria-label="{$t('preview')}: {version.originalFileName}"
      onpointerenter={showPopup}
      onpointerleave={hidePopup}
      onclick={() => {
        hidePopup();
        onPreview(version);
      }}
    >
      {#if version.thumbhash && (!thumbnailLoaded || thumbnailFailed)}
        <Thumbhash base64ThumbHash={version.thumbhash} class="absolute inset-0 size-full object-cover" />
      {/if}
      {#if thumbnailFailed}
        {#if !version.thumbhash}
          <span class="flex size-full items-center justify-center text-gray-400">
            <Icon icon={mdiImageOffOutline} size="24" />
          </span>
        {/if}
      {:else}
        <img
          bind:this={thumbnail}
          src={thumbnailUrl}
          alt={version.originalFileName}
          loading="lazy"
          draggable="false"
          class="absolute inset-0 size-full object-cover"
          onload={() => (thumbnailLoaded = true)}
          onerror={() => (thumbnailFailed = true)}
        />
      {/if}
    </button>
    <div class="min-w-0 flex-1 text-xs" data-testid="asset-version-details">
      {#if formatAndSize.length > 0}
        <p class="opacity-75">{formatAndSize.join(' · ')}</p>
      {/if}
      {#if dimensions}
        <p class="opacity-75">{dimensions}</p>
      {/if}
      {#if version.shown}
        <!-- the file the photo's picture comes from -->
        <p class="mt-0.5">
          <span
            class="inline-block rounded-full bg-immich-primary px-2 leading-[18px] font-medium whitespace-nowrap text-white dark:bg-immich-dark-primary dark:text-black"
            data-testid="asset-version-shown"
          >
            {$t('asset_versions_shown')}
          </span>
        </p>
      {/if}
    </div>

    {#if version.isOffline}
      <!-- the server cannot send a file that is offline -->
      <span
        class="shrink-0 self-end rounded-full bg-gray-200 px-2 text-xs leading-[18px] dark:bg-gray-700"
        data-testid="asset-version-offline"
      >
        {$t('asset_versions_offline')}
      </span>
    {:else if canDownload}
      <IconButton
        icon={mdiDownload}
        aria-label="{$t('download')}: {version.originalFileName}"
        title={$t('download')}
        size="small"
        shape="round"
        color="secondary"
        variant="ghost"
        class="-me-1 -mb-1 self-end"
        onclick={() => onDownload(version)}
      />
    {/if}
  </div>

  {#if popup}
    <!-- the card names the file: the picture itself needs no text, and never takes the mouse from the thumbnail.
         The white edge sets it off from the photo it lies over. -->
    <img
      src={previewUrl}
      alt=""
      draggable="false"
      class="pointer-events-none fixed z-1000 rounded-xl border-2 border-white bg-gray-100 object-contain shadow-2xl dark:bg-immich-dark-gray"
      style:top="{popup.top}px"
      style:left="{popup.left}px"
      style:width="{popup.width}px"
      style:height="{popup.height}px"
      data-testid="asset-version-popup"
      onerror={() => {
        // a picture that cannot be loaded is not tried again on every pass of the mouse
        previewFailed = true;
        hidePopup();
      }}
    />
  {/if}
</li>
