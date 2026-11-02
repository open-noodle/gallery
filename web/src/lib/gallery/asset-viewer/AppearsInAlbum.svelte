<script lang="ts">
  import { page } from '$app/state';
  import AlbumListItemDetails from '$lib/components/asset-viewer/AlbumListItemDetails.svelte';
  import { authManager } from '$lib/managers/auth-manager.svelte';
  import { Route } from '$lib/route';
  import { getAssetMediaUrl } from '$lib/utils';
  import { applyContextualFilter, resolveFilterTarget } from '$lib/utils/filter-target';
  import { AssetMediaSize, type AlbumResponseDto } from '@immich/sdk';
  import { IconButton } from '@immich/ui';
  import { mdiFilterOutline } from '@mdi/js';
  import { t } from 'svelte-i18n';

  type Props = { album: AlbumResponseDto };

  const { album }: Props = $props();

  const filterTarget = $derived(resolveFilterTarget(page.url));
  /**
   * E9 — an album surface offers NO `albumId` filter affordance at all, for any album.
   *
   * buildAlbumTimelineOptions never forwards `albumId` (the route already scopes the query), while
   * getActiveFilterCount counts it and a chip renders. So on /albums/A, filtering by album B would
   * show a "1 filter" badge and a removable B chip over a grid that is still the whole of A — a
   * filter the UI claims is active but the server never sees.
   *
   * A space-scoped map cannot represent an album filter either — space ∩ album is unsatisfiable and
   * the server 400s it (hydrateMapFilters drops albumId there).
   */
  const albumFilterUnsupported = $derived(
    filterTarget?.kind === 'album' || (filterTarget?.kind === 'map' && !!filterTarget.spaceId),
  );
</script>

<!--
  R6 — the whole card is an <a> to the album, so the filter cannot live on the value (a
  button nested inside an anchor is invalid HTML). The ⚗️ sits BESIDE the card.
-->
<div class="flex items-center gap-1">
  <a href={Route.viewAlbum(album)} class="min-w-0 flex-1">
    <div class="flex items-center gap-4 pt-2 hover:cursor-pointer">
      <div>
        <img
          alt={album.albumName}
          class="size-12.5 rounded-sm object-cover"
          src={album.albumThumbnailAssetId &&
            getAssetMediaUrl({ id: album.albumThumbnailAssetId, size: AssetMediaSize.Preview })}
          draggable="false"
        />
      </div>

      <div class="my-auto">
        <p class="dark:text-immich-dark-primary">{album.albumName}</p>
        <div class="flex flex-col gap-0 text-sm">
          <div>
            <AlbumListItemDetails {album} />
          </div>
        </div>
      </div>
    </div>
  </a>
  {#if !authManager.isSharedLink && !albumFilterUnsupported}
    <IconButton
      icon={mdiFilterOutline}
      aria-label="{$t('filter_by_album')}: {album.albumName}"
      size="small"
      shape="round"
      color="secondary"
      variant="ghost"
      onclick={() => applyContextualFilter({ albumId: album.id })}
    />
  {/if}
</div>
