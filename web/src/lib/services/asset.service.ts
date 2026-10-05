import {
  AssetEditAction,
  AssetJobName,
  AssetMediaSize,
  AssetTypeEnum,
  AssetVisibility,
  bulkTagAssets,
  editAsset,
  getAssetEdits,
  getAssetInfo,
  removeAssetFromAlbum,
  removeAssetEdits,
  runAssetJobs,
  updateAsset,
  type AlbumResponseDto,
  type AssetEditActionItemDto,
  type AssetJobsDto,
  type AssetResponseDto,
} from '@immich/sdk';
import { modalManager, toastManager, type ActionItem } from '@immich/ui';
import {
  mdiAccountCircleOutline,
  mdiAlertOutline,
  mdiCogRefreshOutline,
  mdiCompare,
  mdiContentCopy,
  mdiDatabaseRefreshOutline,
  mdiDownload,
  mdiDownloadBox,
  mdiFaceRecognition,
  mdiHeadSyncOutline,
  mdiHeart,
  mdiHeartOutline,
  mdiImageRefreshOutline,
  mdiImageRemoveOutline,
  mdiImageSearch,
  mdiInformationOutline,
  mdiMagnifyMinusOutline,
  mdiMagnifyPlusOutline,
  mdiMotionPauseOutline,
  mdiMotionPlayOutline,
  mdiPlus,
  mdiPresentationPlay,
  mdiRotateLeft,
  mdiRotateRight,
  mdiShareVariantOutline,
  mdiTagMultipleOutline,
  mdiTagPlusOutline,
  mdiTune,
} from '@mdi/js';
import type { MessageFormatter } from 'svelte-i18n';
import { goto } from '$app/navigation';
import { ProjectionType } from '$lib/constants';
import { assetMultiSelectManager } from '$lib/managers/asset-multi-select-manager.svelte';
import { assetViewerManager } from '$lib/managers/asset-viewer-manager.svelte';
import { authManager } from '$lib/managers/auth-manager.svelte';
import { eventManager } from '$lib/managers/event-manager.svelte';
import { featureFlagsManager } from '$lib/managers/feature-flags-manager.svelte';
import AssetAddToCollectionModal from '$lib/modals/AssetAddToCollectionModal.svelte';
import AssetTagModal from '$lib/modals/AssetTagModal.svelte';
import ProfileImageCropperModal from '$lib/modals/ProfileImageCropperModal.svelte';
import SharedLinkCreateModal from '$lib/modals/SharedLinkCreateModal.svelte';
import { Route } from '$lib/route';
import { SlideshowState, slideshowStore } from '$lib/stores/slideshow.store';
import { waitForWebsocketEvent } from '$lib/stores/websocket';
import { getAssetMediaUrl, getSharedLink, sleep } from '$lib/utils';
import { downloadUrl } from '$lib/utils';
import { canEditAsset } from '$lib/utils/asset-editability';
import { getEditableAssetsWithWarning } from '$lib/utils/asset-utils';
import { handleError } from '$lib/utils/handle-error';
import { getFormatter } from '$lib/utils/i18n';

export const getAssetBulkActions = (
  $t: MessageFormatter,
  {
    restrictToSpaceId,
    album,
    editableSelectedAssetIds,
  }: {
    /**
     * Set when the selection contains assets the user does not own: the add-to-collection
     * picker then offers only albums linked to this space, because those are the only targets
     * that can accept the non-owned assets (#764 contribution).
     */
    restrictToSpaceId?: string;
    /**
     * The album whose page is showing this selection. Upstream passed it positionally; it moved
     * into this bag so the fork's restrictToSpaceId and it can coexist. Gates RemoveFromAlbum.
     */
    album?: AlbumResponseDto;
    /**
     * #734: which of the current selection the caller may edit (resolved by `SelectionToolbar`
     * via `POST /assets/editable`). When set, Tag sends only these and reports the skipped count;
     * omitted on every other surface, which keeps upstream's all-owned behaviour.
     */
    editableSelectedAssetIds?: string[];
  } = {},
) => {
  const assetIds = assetMultiSelectManager.assets.map((asset) => asset.id);
  const ownedAssets = assetMultiSelectManager.ownedAssets;
  const isAlbumOwner = album?.albumUsers[0].user.id === authManager.user.id;

  const onAction = async (name: AssetJobName) => {
    await handleRunAssetJob({ name, assetIds: ownedAssets.map(({ id }) => id) });
    assetMultiSelectManager.clear();
  };

  const AddToAlbum: ActionItem = {
    title: $t('add_to_album_or_space'),
    icon: mdiPlus,
    shortcuts: [{ key: 'l' }],
    onAction: () => modalManager.show(AssetAddToCollectionModal, { assetIds, restrictToSpaceId }),
  };

  // Gallery (#853): `Permission.AssetShare` is owner ∪ partner only and rejects the ENTIRE request if it
  // names one asset the caller does not own, so share the owned subset and surface what was left out.
  // `ownedAssets` falls back to the full selection when unauthenticated, so gate on that too. Space
  // surfaces keep the fork's CreateSharedLinkAction, which shares the whole selection against the space.
  const CreateSharedLink: ActionItem = {
    title: $t('share'),
    icon: mdiShareVariantOutline,
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

  const RemoveFromAlbum: ActionItem = {
    title: $t('remove_from_album'),
    icon: mdiImageRemoveOutline,
    shortcuts: [{ key: 'l', shift: true }],
    $if: () => !!album && (isAlbumOwner || assetMultiSelectManager.isAllUserOwned),
    onAction: () => handleBulkRemoveAssetsFromAlbum(assetIds, album!),
  };

  const Tag: ActionItem = {
    title: $t('tag'),
    icon: mdiTagMultipleOutline,
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
    shortcuts: { key: 't' },
  };

  const RefreshFacesJob: ActionItem = {
    title: $t('refresh_faces'),
    icon: mdiHeadSyncOutline,
    onAction: () => onAction(AssetJobName.RefreshFaces),
  };

  const RefreshMetadataJob: ActionItem = {
    title: $t('refresh_metadata'),
    icon: mdiDatabaseRefreshOutline,
    onAction: () => onAction(AssetJobName.RefreshMetadata),
  };

  const RegenerateThumbnailJob: ActionItem = {
    title: $t('refresh_thumbnails'),
    icon: mdiImageRefreshOutline,
    onAction: () => onAction(AssetJobName.RegenerateThumbnail),
  };

  const TranscodeVideoJob: ActionItem = {
    title: $t('refresh_encoded_videos'),
    icon: mdiCogRefreshOutline,
    onAction: () => onAction(AssetJobName.TranscodeVideo),
    $if: () => ownedAssets.every((asset) => asset.isVideo),
  };

  return {
    AddToAlbum,
    CreateSharedLink,
    RemoveFromAlbum,
    Tag,
    RefreshFacesJob,
    RefreshMetadataJob,
    RegenerateThumbnailJob,
    TranscodeVideoJob,
  };
};

export const getAssetActions = (
  $t: MessageFormatter,
  asset: AssetResponseDto & { stackPrimaryAssetId?: string },
  {
    space,
    album,
  }: {
    /**
     * The shared space this asset is being viewed through, when the viewer sits on a space
     * surface. Drives the add-to-album gating below; absent everywhere else.
     */
    space?: { id: string; canWrite: boolean };
    /**
     * The album this asset is being viewed through. Upstream passed it positionally; it moved
     * into this bag so the fork's `space` and it can coexist. Gates RemoveFromAlbum.
     */
    album?: AlbumResponseDto;
  } = {},
) => {
  const sharedLink = getSharedLink();
  const authUser = authManager.authenticated ? authManager.user : undefined;
  const isOwner = !!(authUser && authUser.id === asset.ownerId);
  const isAlbumOwner = !!(authUser && authUser.id === album?.albumUsers[0].user.id);
  const smartSearchEnabled = featureFlagsManager.value.smartSearch;

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
  // Owner/Editor. Offering the ordinary picker there lists nothing but targets the server must
  // reject, so on a space surface the picker is narrowed to that space's albums — and dropped
  // entirely for a space Viewer, who has no contribution path at all. Mirrors the multi-select
  // rule in `getSelectionCapabilities`. Off a space surface `space` is undefined and nothing
  // changes: partner-shared assets do land in the caller's own album (Permission.AssetShare),
  // and the viewer cannot evaluate that from the DTO.
  const canAddToAlbum = isOwner || space === undefined || space.canWrite;
  const restrictToSpaceId = !isOwner && space?.canWrite ? space.id : undefined;

  const Share: ActionItem = {
    title: $t('share'),
    icon: mdiShareVariantOutline,
    $if: () => canShare && !asset.isTrashed && asset.visibility !== AssetVisibility.Locked,
    onAction: () => modalManager.show(SharedLinkCreateModal, { assetIds: [asset.id] }),
  };

  const Download: ActionItem = {
    title: $t('download'),
    icon: mdiDownload,
    shortcuts: { key: 'd', shift: true },
    $if: () => !!authUser,
    onAction: () => handleDownloadAsset(asset, { edited: true }),
  };

  const DownloadOriginal: ActionItem = {
    title: $t('download_original'),
    icon: mdiDownloadBox,
    $if: () => !!authUser && asset.isEdited,
    onAction: () => handleDownloadAsset(asset, { edited: false }),
  };

  const SharedLinkDownload: ActionItem = {
    ...Download,
    $if: () => isOwner || !!sharedLink?.allowDownload,
  };

  const PlayMotionPhoto: ActionItem = {
    title: $t('play_motion_photo'),
    icon: mdiMotionPlayOutline,
    $if: () => !!asset.livePhotoVideoId && !assetViewerManager.isPlayingMotionPhoto,
    onAction: () => {
      assetViewerManager.isPlayingMotionPhoto = true;
    },
  };

  const StopMotionPhoto: ActionItem = {
    title: $t('stop_motion_photo'),
    icon: mdiMotionPauseOutline,
    $if: () => !!asset.livePhotoVideoId && assetViewerManager.isPlayingMotionPhoto,
    onAction: () => {
      assetViewerManager.isPlayingMotionPhoto = false;
    },
  };

  const PlaySlideshow: ActionItem = {
    title: $t('slideshow'),
    icon: mdiPresentationPlay,
    $if: () => asset.visibility !== AssetVisibility.Locked,
    onAction: () => slideshowStore.slideshowState.set(SlideshowState.PlaySlideshow),
  };

  const Favorite: ActionItem = {
    title: $t('to_favorite'),
    icon: mdiHeartOutline,
    $if: () => isOwner && !asset.isFavorite,
    onAction: () => handleFavorite(asset),
    shortcuts: [{ key: 'f' }],
  };

  const Unfavorite: ActionItem = {
    title: $t('unfavorite'),
    icon: mdiHeart,
    $if: () => isOwner && asset.isFavorite,
    onAction: () => handleUnfavorite(asset),
    shortcuts: [{ key: 'f' }],
  };

  // Server-authoritative on a single-asset read (`asset.canEdit`); falls back to ownership when
  // the field was never resolved (e.g. bulk/list surfaces). See `canEditAsset` (#734).
  const isEditable = () => canEditAsset(asset, { userId: authUser?.id });

  const Rate: ActionItem = {
    title: $t('rate_asset'),
    description: $t('rate_asset_description'),
    // #734: ratings are a metadata edit, open to a space Owner/Editor of a member's asset.
    $if: () => isEditable() && authManager.preferences.ratings.enabled,
    onAction: ({ event }) => handleRate(asset, event instanceof KeyboardEvent ? Number(event.key) : NaN),
    shortcuts: [0, 1, 2, 3, 4, 5].map((key) => ({ key: String(key) })),
  };

  const AddToAlbum: ActionItem = {
    title: $t('add_to_album_or_space'),
    icon: mdiPlus,
    shortcuts: [{ key: 'l' }],
    $if: () => canAddToAlbum && asset.visibility !== AssetVisibility.Locked && !asset.isTrashed,
    onAction: () => modalManager.show(AssetAddToCollectionModal, { assetIds: [asset.id], restrictToSpaceId }),
  };

  const RemoveFromAlbum: ActionItem = {
    title: $t('remove_from_album'),
    icon: mdiImageRemoveOutline,
    shortcuts: [{ key: 'l', shift: true }],
    $if: () => !!album && (isOwner || isAlbumOwner),
    onAction: () => handleRemoveAssetsFromAlbum([asset.id], album!),
  };

  const Offline: ActionItem = {
    title: $t('asset_offline'),
    icon: mdiAlertOutline,
    color: 'danger',
    $if: () => !!asset.isOffline,
    onAction: () => assetViewerManager.toggleDetailPanel(),
  };

  const ZoomIn: ActionItem = {
    title: $t('zoom_image'),
    icon: mdiMagnifyPlusOutline,
    $if: () => assetViewerManager.canZoomIn(),
    onAction: () => assetViewerManager.emit('Zoom'),
  };

  const ZoomOut: ActionItem = {
    title: $t('zoom_image'),
    icon: mdiMagnifyMinusOutline,
    $if: () => assetViewerManager.canZoomOut(),
    onAction: () => assetViewerManager.emit('Zoom'),
  };

  const Copy: ActionItem = {
    title: $t('copy_image'),
    icon: mdiContentCopy,
    $if: () => assetViewerManager.canCopyImage(),
    onAction: () => assetViewerManager.emit('Copy'),
  };

  const Info: ActionItem = {
    title: $t('info'),
    icon: mdiInformationOutline,
    $if: () => asset.hasMetadata,
    onAction: () => assetViewerManager.toggleDetailPanel(),
    shortcuts: { key: 'i' },
  };

  const Tag: ActionItem = {
    title: $t('add_tag'),
    icon: mdiTagPlusOutline,
    $if: () => authManager.authenticated && authManager.preferences.tags.enabled,
    onAction: () => modalManager.show(AssetTagModal, { assetIds: [asset.id] }),
    shortcuts: { key: 't' },
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

  const TagPeople: ActionItem = {
    title: $t('tag_people'),
    icon: mdiFaceRecognition,
    $if: () => isOwner && asset.type === AssetTypeEnum.Image && !asset.isTrashed,
    onAction: () => assetViewerManager.toggleFaceEditMode(),
    shortcuts: { key: 'p' },
  };

  const Edit: ActionItem = {
    title: $t('editor'),
    icon: mdiTune,
    $if: canEdit,
    onAction: () => assetViewerManager.openEditor(),
    shortcuts: [{ key: 'e' }],
  };

  const SetProfilePicture: ActionItem = {
    title: $t('set_as_profile_picture'),
    icon: mdiAccountCircleOutline,
    $if: () => asset.type === AssetTypeEnum.Image && asset.visibility !== AssetVisibility.Locked,
    onAction: () => modalManager.show(ProfileImageCropperModal, { asset }),
  };

  const ViewInTimeline: ActionItem = {
    title: $t('view_in_timeline'),
    icon: mdiImageSearch,
    $if: () => isOwner && asset.visibility !== AssetVisibility.Locked && !asset.isArchived && !asset.isTrashed,
    onAction: () => goto(Route.photos({ at: asset.stackPrimaryAssetId ?? asset.id })),
  };

  const ViewSimilar: ActionItem = {
    title: $t('view_similar_photos'),
    icon: mdiCompare,
    $if: () =>
      asset.visibility !== AssetVisibility.Locked && !asset.isArchived && !asset.isTrashed && smartSearchEnabled,
    onAction: () => goto(Route.search({ queryAssetId: asset.stackPrimaryAssetId ?? asset.id })),
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

  const RefreshFacesJob: ActionItem = {
    title: $t('refresh_faces'),
    icon: mdiHeadSyncOutline,
    onAction: () => handleRunAssetJob({ name: AssetJobName.RefreshFaces, assetIds: [asset.id] }),
  };

  const RefreshMetadataJob: ActionItem = {
    title: $t('refresh_metadata'),
    icon: mdiDatabaseRefreshOutline,
    onAction: () => handleRunAssetJob({ name: AssetJobName.RefreshMetadata, assetIds: [asset.id] }),
  };

  const RegenerateThumbnailJob: ActionItem = {
    title: $t('refresh_thumbnails'),
    icon: mdiImageRefreshOutline,
    onAction: () => handleRunAssetJob({ name: AssetJobName.RegenerateThumbnail, assetIds: [asset.id] }),
  };

  const TranscodeVideoJob: ActionItem = {
    title: $t('refresh_encoded_videos'),
    icon: mdiCogRefreshOutline,
    onAction: () => handleRunAssetJob({ name: AssetJobName.TranscodeVideo, assetIds: [asset.id] }),
    $if: () => asset.type === AssetTypeEnum.Video,
  };

  return {
    Share,
    Download,
    DownloadOriginal,
    SharedLinkDownload,
    Offline,
    Info,
    Favorite,
    Unfavorite,
    Rate,
    PlayMotionPhoto,
    StopMotionPhoto,
    PlaySlideshow,
    AddToAlbum,
    RemoveFromAlbum,
    ZoomIn,
    ZoomOut,
    Copy,
    Tag,
    TagPeople,
    Edit,
    SetProfilePicture,
    ViewInTimeline,
    ViewSimilar,
    RotateRight,
    RotateLeft,
    Rotate180,
    RefreshFacesJob,
    RefreshMetadataJob,
    RegenerateThumbnailJob,
    TranscodeVideoJob,
  };
};

export const handleDownloadAsset = async (asset: AssetResponseDto, { edited }: { edited: boolean }) => {
  const $t = await getFormatter();

  const assets = [
    {
      filename: asset.originalFileName,
      id: asset.id,
      cacheKey: asset.thumbhash,
    },
  ];

  const isAndroidMotionVideo = (asset: AssetResponseDto) => {
    return asset.originalPath.includes('encoded-video');
  };

  if (asset.livePhotoVideoId) {
    const motionAsset = await getAssetInfo({ ...authManager.params, id: asset.livePhotoVideoId });
    if (
      !isAndroidMotionVideo(motionAsset) ||
      (authManager.authenticated && authManager.preferences.download.includeEmbeddedVideos)
    ) {
      const motionFilename = motionAsset.originalFileName;
      const lastDotIndex = motionFilename.lastIndexOf('.');
      const motionDownloadFilename =
        lastDotIndex > 0
          ? `${motionFilename.slice(0, lastDotIndex)}-motion${motionFilename.slice(lastDotIndex)}`
          : `${motionFilename}-motion`;
      assets.push({
        filename: motionDownloadFilename,
        id: asset.livePhotoVideoId,
        cacheKey: motionAsset.thumbhash,
      });
    }
  }

  for (const [i, { filename, id, cacheKey }] of assets.entries()) {
    if (i !== 0) {
      // play nice with Safari
      await sleep(500);
    }

    try {
      toastManager.primary($t('downloading_asset_filename', { values: { filename } }));
      downloadUrl(getAssetMediaUrl({ id, size: AssetMediaSize.Original, edited, cacheKey, download: true }), filename);
    } catch (error) {
      handleError(error, $t('errors.error_downloading', { values: { filename } }));
    }
  }
};

const handleFavorite = async (asset: AssetResponseDto) => {
  const $t = await getFormatter();

  try {
    const response = await updateAsset({ id: asset.id, updateAssetDto: { isFavorite: true } });
    toastManager.primary($t('added_to_favorites'));
    eventManager.emit('AssetUpdate', response);
  } catch (error) {
    handleError(error, $t('errors.unable_to_add_remove_favorites', { values: { favorite: asset.isFavorite } }));
  }
};

const handleUnfavorite = async (asset: AssetResponseDto) => {
  const $t = await getFormatter();

  try {
    const response = await updateAsset({ id: asset.id, updateAssetDto: { isFavorite: false } });
    toastManager.primary($t('removed_from_favorites'));
    eventManager.emit('AssetUpdate', response);
  } catch (error) {
    handleError(error, $t('errors.unable_to_add_remove_favorites', { values: { favorite: asset.isFavorite } }));
  }
};

const handleRate = async (asset: AssetResponseDto, rating: number) => {
  const $t = await getFormatter();

  if (Number.isNaN(rating)) {
    toastManager.info($t('rate_asset_description'));
    return;
  }

  const newRating = rating === 0 ? null : rating;
  if (asset.exifInfo && asset.exifInfo.rating === newRating) {
    return;
  }

  try {
    const response = await updateAsset({ id: asset.id, updateAssetDto: { rating: newRating } });
    eventManager.emit('AssetUpdate', response);
  } catch (error) {
    handleError(error, $t('errors.unable_to_set_rating'));
  }
};

export const handleTagAssets = async (assetIds: string[], tagIds: string[]) => {
  const $t = await getFormatter();

  try {
    const response = await bulkTagAssets({ tagBulkAssetsDto: { assetIds, tagIds } });
    toastManager.primary($t('tagged_assets', { values: { count: response.count } }));
    eventManager.emit('AssetsTag', assetIds);
    return true;
  } catch (error) {
    handleError(error, $t('errors.failed_to_tag_assets'));
    return false;
  }
};

const handleBulkRemoveAssetsFromAlbum = async (assetIds: string[], album: AlbumResponseDto) => {
  const $t = await getFormatter();

  const isConfirmed = await modalManager.showDialog({
    prompt: $t('remove_assets_album_confirmation', { values: { count: assetIds.length } }),
  });

  if (!isConfirmed) {
    return;
  }

  await handleRemoveAssetsFromAlbum(assetIds, album);
  assetMultiSelectManager.clear();
};

const handleRemoveAssetsFromAlbum = async (assetIds: string[], album: AlbumResponseDto) => {
  const $t = await getFormatter();

  try {
    const results = await removeAssetFromAlbum({
      id: album.id,
      bulkIdsDto: { ids: assetIds },
    });

    const count = results.filter(({ success }) => success).length;

    toastManager.primary($t('assets_removed_count', { values: { count } }));
    eventManager.emit('AlbumRemoveAssets', { assetIds, albumIds: [album.id] });
  } catch (error) {
    handleError(error, $t('errors.error_removing_assets_from_album'));
  }
};

const getAssetJobMessage = ($t: MessageFormatter, job: AssetJobName) => {
  const messages: Record<AssetJobName, string> = {
    [AssetJobName.RefreshFaces]: $t('refreshing_faces'),
    [AssetJobName.RefreshMetadata]: $t('refreshing_metadata'),
    [AssetJobName.RegenerateThumbnail]: $t('regenerating_thumbnails'),
    [AssetJobName.TranscodeVideo]: $t('refreshing_encoded_video'),
  };

  return messages[job];
};

const handleRunAssetJob = async (dto: AssetJobsDto) => {
  const $t = await getFormatter();

  try {
    await runAssetJobs({ assetJobsDto: dto });
    toastManager.primary(getAssetJobMessage($t, dto.name));
  } catch (error) {
    handleError(error, $t('errors.unable_to_submit_job'));
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
