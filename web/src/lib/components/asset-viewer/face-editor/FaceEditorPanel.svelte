<script lang="ts">
  import { getViewerSpace } from '$lib/gallery/viewer-space';
  import { authManager } from '$lib/managers/auth-manager.svelte';
  import {
    canEditSpacePeople as resolveCanEditSpacePeople,
    resolveEffectiveSpaceId,
  } from '$lib/utils/asset-editability';
  import type { AssetResponseDto } from '@immich/sdk';
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
   * The viewer's space comes from the `getViewerSpace` context; `asset` is the viewed asset, which
   * for a live photo is the still (`assetId` is then its video).
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
    asset: AssetResponseDto;
    onClose: () => void;
  };

  let { htmlElement, containerWidth, containerHeight, assetId, asset, onClose }: Props = $props();

  const viewerSpace = $derived.by(getViewerSpace());
  const spaceId = $derived(resolveEffectiveSpaceId(asset, viewerSpace.spaceId));
  const canEditSpacePeople = $derived(
    resolveCanEditSpacePeople(asset, {
      userId: authManager.authenticated ? authManager.user.id : undefined,
      spaceId: viewerSpace.spaceId,
    }),
  );
</script>

{#if canEditSpacePeople && spaceId}
  <SpaceFaceEditor {htmlElement} {containerWidth} {containerHeight} {assetId} {spaceId} {onClose} />
{:else}
  <FaceEditor {htmlElement} {containerWidth} {containerHeight} {assetId} />
{/if}
