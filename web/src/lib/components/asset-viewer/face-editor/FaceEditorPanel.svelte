<script lang="ts">
  import FaceEditor from './FaceEditor.svelte';
  import SpaceFaceEditor from './SpaceFaceEditor.svelte';

  /**
   * Slice 8 gap closure — the single place that decides which face-drawing UI opens for a given
   * asset: the OWNER's `FaceEditor` (owner-only `createFace`) or the space-flavoured
   * `SpaceFaceEditor` (shared-space `createSpaceAssetFace`, spec §6.5). `PhotoViewer.svelte` and
   * `VideoNativeViewer.svelte` both render this instead of duplicating the swap, so the two call
   * sites (image vs video asset) cannot drift apart on the same rule DetailPanel.svelte's
   * side-panel swap and `DetailPanelPeople.svelte`'s affordance gate already use
   * (`canEditSpacePeople`, from `resolveCanEditSpacePeople` in `asset-editability.ts`).
   *
   * `spaceId` is re-checked here (not just `canEditSpacePeople`) because
   * `SpaceFaceEditor`'s `spaceId` prop is a required `string`; the `{#if}` narrows it for TS even
   * though `canEditSpacePeople` true already implies a space id upstream — never render both, and
   * never render `SpaceFaceEditor` without one.
   */
  type Props = {
    htmlElement: HTMLImageElement | HTMLVideoElement;
    containerWidth: number;
    containerHeight: number;
    assetId: string;
    spaceId?: string;
    canEditSpacePeople?: boolean;
    onClose: () => void;
  };

  let {
    htmlElement,
    containerWidth,
    containerHeight,
    assetId,
    spaceId,
    canEditSpacePeople = false,
    onClose,
  }: Props = $props();
</script>

{#if canEditSpacePeople && spaceId}
  <SpaceFaceEditor {htmlElement} {containerWidth} {containerHeight} {assetId} {spaceId} {onClose} />
{:else}
  <FaceEditor {htmlElement} {containerWidth} {containerHeight} {assetId} />
{/if}
