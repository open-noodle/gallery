import {
  AssetEditAction,
  AssetTypeEnum,
  AssetVisibility,
  editAsset,
  getAssetEdits,
  getAssetInfo,
  removeAssetEdits,
  updateAssetFavorites,
  type AssetEditActionItemDto,
  type AssetResponseDto,
} from '@immich/sdk';
import { modalManager, toastManager, type ActionItem } from '@immich/ui';
import { mdiRotateLeft, mdiRotateRight } from '@mdi/js';
import type { MessageFormatter } from 'svelte-i18n';
import { ProjectionType } from '$lib/constants';
import { assetMultiSelectManager } from '$lib/managers/asset-multi-select-manager.svelte';
import { assetViewerManager } from '$lib/managers/asset-viewer-manager.svelte';
import { authManager } from '$lib/managers/auth-manager.svelte';
import { eventManager } from '$lib/managers/event-manager.svelte';
import AssetAddToCollectionModal from '$lib/modals/AssetAddToCollectionModal.svelte';
import AssetTagModal from '$lib/modals/AssetTagModal.svelte';
import SharedLinkCreateModal from '$lib/modals/SharedLinkCreateModal.svelte';
import { waitForWebsocketEvent } from '$lib/stores/websocket';
import { getSharedLink } from '$lib/utils';
import { canEditAsset } from '$lib/utils/asset-editability';
import { getEditableAssetsWithWarning } from '$lib/utils/asset-utils';
import { handleError } from '$lib/utils/handle-error';
import { getFormatter } from '$lib/utils/i18n';

/**
 * Gallery's overlay on upstream's asset action helpers (`$lib/services/asset.service`). Upstream's
 * `getAssetBulkActions` and `getAssetActions` keep their own items and positional `album?`, take the
 * fork's options as one trailing optional argument, and hand their result to the functions below,
 * which replace the items Gallery changes (same key, same position) and add the quick-rotate items.
 */
export type GalleryAssetBulkActionOptions = {
  /**
   * #734: which of the current selection the caller may edit (resolved by `SelectionToolbar`
   * via `POST /assets/editable`). When set, Tag sends only these and reports the skipped count;
   * omitted on every other surface, which keeps upstream's all-owned behaviour.
   */
  editableSelectedAssetIds?: string[];
};

export type GalleryAssetActionOptions = {
  /**
   * The shared space this asset is being viewed through, when the viewer sits on a space
   * surface. Drives the add-to-album gating below; absent everywhere else.
   */
  space?: { id: string; canWrite: boolean };
};

export const getGalleryAssetBulkActions = <
  T extends { AddToAlbum: ActionItem; CreateSharedLink: ActionItem; Tag: ActionItem },
>(
  $t: MessageFormatter,
  { editableSelectedAssetIds }: GalleryAssetBulkActionOptions = {},
  upstream: T,
) => {
  const assetIds = assetMultiSelectManager.assets.map((asset) => asset.id);

  const AddToAlbum: ActionItem = {
    ...upstream.AddToAlbum,
    title: $t('add_to_album_or_space'),
    onAction: () => modalManager.show(AssetAddToCollectionModal, { assetIds }),
  };

  // Gallery (#853): `Permission.AssetShare` is owner ∪ partner only and rejects the ENTIRE request if it
  // names one asset the caller does not own, so share the owned subset and surface what was left out.
  // `ownedAssets` falls back to the full selection when unauthenticated, so gate on that too. Space
  // surfaces keep the fork's CreateSharedLinkAction, which shares the whole selection against the space.
  const CreateSharedLink: ActionItem = {
    ...upstream.CreateSharedLink,
    onAction: async () => {
      const ownedAssetIds = authManager.authenticated ? assetMultiSelectManager.ownedAssets.map(({ id }) => id) : [];
      if (ownedAssetIds.length === 0) {
        toastManager.warning($t('shared_link_nothing_owned_to_share'));
        return;
      }
      await modalManager.show(SharedLinkCreateModal, {
        assetIds: ownedAssetIds,
        excludedCount: assetIds.length - ownedAssetIds.length,
      });
    },
  };

  const Tag: ActionItem = {
    ...upstream.Tag,
    $if: () =>
      authManager.preferences.tags.enabled &&
      (assetMultiSelectManager.isAllUserOwned || (editableSelectedAssetIds?.length ?? 0) > 0),
    onAction: async () => {
      // #734: a space Owner/Editor may tag a member's assets. Send only the editable subset and
      // report what was skipped; a selection that resolves to nothing editable never opens the
      // modal, which would otherwise "succeed" with an empty id list.
      const ids =
        editableSelectedAssetIds === undefined
          ? assetIds
          : getEditableAssetsWithWarning(assetMultiSelectManager.assets, editableSelectedAssetIds);
      if (ids.length === 0) {
        return;
      }
      if (await modalManager.show(AssetTagModal, { assetIds: ids })) {
        assetMultiSelectManager.clear();
      }
    },
  };

  return { ...upstream, AddToAlbum, CreateSharedLink, Tag };
};

type UpstreamAssetActions = Record<
  | 'Share'
  | 'Favorite'
  | 'Unfavorite'
  | 'Rate'
  | 'AddToAlbum'
  | 'Edit'
  | 'RefreshFacesJob'
  | 'RefreshMetadataJob'
  | 'RegenerateThumbnailJob'
  | 'TranscodeVideoJob',
  ActionItem
>;

export const getGalleryAssetActions = <T extends UpstreamAssetActions>(
  $t: MessageFormatter,
  asset: AssetResponseDto,
  { space }: GalleryAssetActionOptions = {},
  upstream: T,
) => {
  const sharedLink = getSharedLink();
  const authUser = authManager.authenticated ? authManager.user : undefined;
  const isOwner = !!(authUser && authUser.id === asset.ownerId);

  // Server-side `Permission.AssetShare` is owner ∪ partner only, so album or space membership grants
  // no share access. Gating on `authUser` alone offered a shared-album/space viewer a button that
  // `POST /shared-links` then rejected with "Not found or no asset.share access" (#871).
  //
  // `|| !asset.ownerId`: a `showMetadata: false` shared link returns SanitizedAssetResponseDto, which
  // omits `ownerId` altogether, so ownership is unknowable client-side there — treat unknown as
  // shareable rather than hiding the button from the owner of the asset they linked.
  const canShare = !!authUser && (isOwner || !asset.ownerId);

  // #889: an asset the caller does not own reaches an album only through the #764 contribution
  // path, which the server accepts solely for albums linked to a space where the caller is
  // Owner/Editor, so the action is dropped for a space Viewer, who has no contribution path at all.
  // Mirrors the multi-select rule in `getSelectionCapabilities`. The picker itself is the timeline's
  // (#1119): it asks the server which albums accept the asset. Off a space surface `space` is
  // undefined and nothing changes: partner-shared assets do land in the caller's own album
  // (Permission.AssetShare), and the viewer cannot evaluate that from the DTO.
  const canAddToAlbum = isOwner || space === undefined || space.canWrite;

  const Share: ActionItem = {
    ...upstream.Share,
    $if: () => canShare && !asset.isTrashed && asset.visibility !== AssetVisibility.Locked,
  };

  const Favorite: ActionItem = {
    ...upstream.Favorite,
    // #763: favoriting is per-user — any authenticated reader may favorite. Shared-link
    // sessions are explicitly excluded: auth.user there is the LINK OWNER, and an anonymous
    // visitor must never write favorites in the owner's name (spec §5.1).
    $if: () => !!authUser && !sharedLink && !asset.isFavorite,
    onAction: () => handleFavorite(asset),
  };

  const Unfavorite: ActionItem = {
    ...upstream.Unfavorite,
    $if: () => !!authUser && !sharedLink && asset.isFavorite,
    onAction: () => handleUnfavorite(asset),
  };

  // Server-authoritative on a single-asset read (`asset.canEdit`); falls back to ownership when
  // the field was never resolved (e.g. bulk/list surfaces). See `canEditAsset` (#734).
  const isEditable = () => canEditAsset(asset, { userId: authUser?.id });

  const Rate: ActionItem = {
    ...upstream.Rate,
    // #734: ratings are a metadata edit, open to a space Owner/Editor of a member's asset.
    $if: () => isEditable() && authManager.preferences.ratings.enabled,
  };

  const AddToAlbum: ActionItem = {
    ...upstream.AddToAlbum,
    title: $t('add_to_album_or_space'),
    $if: () => canAddToAlbum && asset.visibility !== AssetVisibility.Locked && !asset.isTrashed,
    onAction: () => modalManager.show(AssetAddToCollectionModal, { assetIds: [asset.id] }),
  };

  const canEditImage = () =>
    !sharedLink &&
    isEditable() &&
    asset.type === AssetTypeEnum.Image &&
    !asset.livePhotoVideoId &&
    asset.exifInfo?.projectionType !== ProjectionType.EQUIRECTANGULAR &&
    !asset.originalPath.toLowerCase().endsWith('.insp') &&
    !asset.originalPath.toLowerCase().endsWith('.gif') &&
    !asset.originalPath.toLowerCase().endsWith('.svg');

  const canEditVideo = () => {
    if (sharedLink || !isEditable() || asset.type !== AssetTypeEnum.Video || asset.livePhotoVideoId) {
      return false;
    }
    // Duration must be known and >= 2 seconds
    if (!asset.duration) {
      return false;
    }
    return asset.duration >= 2000;
  };

  const canEdit = () => canEditImage() || canEditVideo();

  const Edit: ActionItem = {
    ...upstream.Edit,
    $if: canEdit,
  };

  const RotateRight: ActionItem = {
    title: $t('rotate_right'),
    icon: mdiRotateRight,
    $if: canEditImage,
    onAction: () => handleQuickRotate(asset, 90),
  };

  const RotateLeft: ActionItem = {
    title: $t('rotate_left'),
    icon: mdiRotateLeft,
    $if: canEditImage,
    onAction: () => handleQuickRotate(asset, 270),
  };

  const Rotate180: ActionItem = {
    title: $t('rotate_180'),
    icon: mdiRotateRight,
    $if: canEditImage,
    onAction: () => handleQuickRotate(asset, 180),
  };

  // The rotate items sit before upstream's job items, where the palette has always listed them.
  const { RefreshFacesJob, RefreshMetadataJob, RegenerateThumbnailJob, TranscodeVideoJob, ...rest } = upstream;
  return {
    ...rest,
    Share,
    Favorite,
    Unfavorite,
    Rate,
    AddToAlbum,
    Edit,
    RotateRight,
    RotateLeft,
    Rotate180,
    RefreshFacesJob,
    RefreshMetadataJob,
    RegenerateThumbnailJob,
    TranscodeVideoJob,
  };
};

const handleFavorite = async (asset: AssetResponseDto) => {
  const $t = await getFormatter();

  try {
    await updateAssetFavorites({ assetFavoriteUpdateDto: { ids: [asset.id], isFavorite: true } });
    toastManager.primary($t('added_to_favorites'));
    eventManager.emit('AssetUpdate', { ...asset, isFavorite: true });
  } catch (error) {
    handleError(error, $t('errors.unable_to_add_remove_favorites', { values: { favorite: asset.isFavorite } }));
  }
};

const handleUnfavorite = async (asset: AssetResponseDto) => {
  const $t = await getFormatter();

  try {
    await updateAssetFavorites({ assetFavoriteUpdateDto: { ids: [asset.id], isFavorite: false } });
    toastManager.primary($t('removed_from_favorites'));
    eventManager.emit('AssetUpdate', { ...asset, isFavorite: false });
  } catch (error) {
    handleError(error, $t('errors.unable_to_add_remove_favorites', { values: { favorite: asset.isFavorite } }));
  }
};

export const normalizeAngle = (angle: number): number => ((angle % 360) + 360) % 360;

export const mergeRotation = (
  existingEdits: AssetEditActionItemDto[],
  additionalAngle: number,
): AssetEditActionItemDto[] => {
  const otherEdits = existingEdits.filter((e) => e.action !== AssetEditAction.Rotate);
  const existingRotate = existingEdits.find((e) => e.action === AssetEditAction.Rotate);
  const existingAngle = (existingRotate?.parameters as { angle?: number })?.angle ?? 0;
  const merged = normalizeAngle(existingAngle + additionalAngle);

  if (merged === 0) {
    return otherEdits;
  }

  return [...otherEdits, { action: AssetEditAction.Rotate, parameters: { angle: merged } }];
};

const handleQuickRotate = async (asset: AssetResponseDto, angle: number) => {
  const $t = await getFormatter();

  try {
    const existing = await getAssetEdits({ id: asset.id });
    const edits = mergeRotation(
      existing.edits.map(({ action, parameters }) => ({ action, parameters })),
      angle,
    );

    const editCompleted = waitForWebsocketEvent('AssetEditReadyV2', (event) => event.asset.id === asset.id, 10_000);

    await (edits.length === 0
      ? removeAssetEdits({ id: asset.id })
      : editAsset({ id: asset.id, assetEditsCreateDto: { edits } }));
    await editCompleted;

    const refreshedAsset = await getAssetInfo({ id: asset.id });
    assetViewerManager.setAsset(refreshedAsset);
    eventManager.emit('AssetUpdate', refreshedAsset);
    eventManager.emit('AssetEditsApplied', asset.id);
  } catch (error) {
    handleError(error, $t('rotate_error'));
  }
};
