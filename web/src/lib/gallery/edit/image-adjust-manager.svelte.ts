import {
  editAsset,
  getAssetAdjust,
  removeAssetAdjust,
  removeAssetEdits,
  updateAssetAdjust,
  type AssetResponseDto,
} from '@immich/sdk';
import {
  imageAdjustFilter,
  isNeutralImageAdjust,
  isSameImageAdjust,
  NEUTRAL_IMAGE_ADJUST,
  type ImageAdjust,
} from '$lib/gallery/edit/image-adjust';
import type { EditActions, EditToolManager } from '$lib/managers/edit/edit-manager.svelte';
import { waitForWebsocketEvent } from '$lib/stores/websocket';

/**
 * The Adjust panel's state: exposure, contrast, saturation and invert, saved through `PUT /assets/{id}/adjust`
 * (stored beside asset_edit, not in it, so stock Immich clients never see an action they cannot decode).
 */
export class ImageAdjustManager {
  /** Which half of the transform panel shows: the Adjust sliders or Immich's crop grid. */
  mode = $state<'edit' | 'crop'>('edit');

  exposure = $state(0);
  contrast = $state(0);
  saturation = $state(0);
  invert = $state(false);

  /** The adjustment the server holds, so an unchanged panel saves nothing. */
  #saved = $state<ImageAdjust>({ ...NEUTRAL_IMAGE_ADJUST });

  current: ImageAdjust = $derived({
    exposure: this.exposure,
    contrast: this.contrast,
    saturation: this.saturation,
    invert: this.invert,
  });

  hasChanges = $derived(!isSameImageAdjust(this.current, this.#saved));
  canReset = $derived(!isNeutralImageAdjust(this.current));
  filter = $derived(imageAdjustFilter(this.current));

  async load(assetId: string) {
    this.#set(NEUTRAL_IMAGE_ADJUST);
    this.#saved = { ...NEUTRAL_IMAGE_ADJUST };
    try {
      const adjust = await getAssetAdjust({ id: assetId });
      this.#saved = { ...adjust };
      this.#set(adjust);
    } catch (error) {
      console.error('Failed to load the image adjustment', error);
    }
  }

  /** Writes the adjustment if it changed; resolves once the server has stored it (the edit job runs after). */
  async save(assetId: string): Promise<boolean> {
    if (!this.hasChanges) {
      return false;
    }

    const adjust = this.current;
    await (isNeutralImageAdjust(adjust)
      ? removeAssetAdjust({ id: assetId })
      : updateAssetAdjust({ id: assetId, assetImageAdjustDto: adjust }));
    this.#saved = { ...adjust };
    return true;
  }

  resetAllChanges() {
    this.#set(NEUTRAL_IMAGE_ADJUST);
  }

  reset() {
    this.mode = 'edit';
    this.#set(NEUTRAL_IMAGE_ADJUST);
    this.#saved = { ...NEUTRAL_IMAGE_ADJUST };
  }

  #set({ exposure, contrast, saturation, invert }: ImageAdjust) {
    this.exposure = exposure;
    this.contrast = contrast;
    this.saturation = saturation;
    this.invert = invert;
  }
}

export const imageAdjustManager = new ImageAdjustManager();

const EDIT_READY_TIMEOUT = 10_000;

const editReady = (assetId: string) =>
  waitForWebsocketEvent('AssetEditReadyV2', (event) => event.asset.id === assetId, EDIT_READY_TIMEOUT);

// Order-insensitive, and blind to the ids the server adds, so the edits the tool opened with compare equal to the
// same edits rebuilt from its state.
const editsKey = (edits: EditActions) =>
  JSON.stringify(
    edits.map(({ action, parameters }) => [action, Object.entries(parameters).sort(([a], [b]) => a.localeCompare(b))]),
  );

/**
 * The transform tool with the Adjust panel folded in, as EditManager sees it: changes, reset and save cover both.
 * Saving writes the adjustment first and, when crop/rotate/mirror changed too, waits for its edit job before saving
 * those, so the two jobs never render the same asset at once. EditManager waits for the first edit-ready event, so
 * this resolves only after the last job is done.
 */
export const withImageAdjust = (transform: EditToolManager, adjust = imageAdjustManager): EditToolManager => {
  // `hasChanges` alone misses "Reset changes", which reverts the tool without counting as a change.
  let opened = editsKey([]);
  const transformChanged = () => transform.hasChanges || editsKey(transform.edits) !== opened;

  return {
    async onActivate(asset: AssetResponseDto, edits: EditActions) {
      opened = editsKey(edits);
      await Promise.all([transform.onActivate(asset, edits), adjust.load(asset.id)]);
    },
    onDeactivate() {
      transform.onDeactivate();
      adjust.reset();
    },
    async resetAllChanges() {
      await transform.resetAllChanges();
      adjust.resetAllChanges();
    },
    get hasChanges() {
      return transform.hasChanges || adjust.hasChanges;
    },
    get canReset() {
      return transform.canReset || adjust.canReset;
    },
    get edits() {
      return transform.edits;
    },
    async save(assetId: string) {
      const saveAdjust = adjust.hasChanges;
      // Immich's own path whenever the adjustment alone did not change, as an unchanged Save did before.
      const saveTransform = !saveAdjust || transformChanged();

      if (saveAdjust) {
        const adjusted = saveTransform ? editReady(assetId) : undefined;
        // Handled below; without this a failed save would leave the timeout as an unhandled rejection.
        adjusted?.catch(() => {});
        await adjust.save(assetId);
        await adjusted;
      }

      if (saveTransform) {
        // EditManager's own listener has already seen the adjustment's event, so wait for this job here.
        const edited = saveAdjust ? editReady(assetId) : undefined;
        edited?.catch(() => {});
        const { edits } = transform;
        await (edits.length === 0
          ? removeAssetEdits({ id: assetId })
          : editAsset({ id: assetId, assetEditsCreateDto: { edits } }));
        await edited;
        opened = editsKey(edits);
      }
    },
  };
};
