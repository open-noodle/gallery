<script lang="ts">
  import { authManager } from '$lib/managers/auth-manager.svelte';
  import { assetMultiSelectManager } from '$lib/managers/asset-multi-select-manager.svelte';
  import SpacePickerModal from '$lib/modals/SpacePickerModal.svelte';
  import { loadSpaces, userInteraction } from '$lib/stores/user.svelte';
  import type { AssetSpacesItemDto } from '@immich/sdk';
  import { IconButton, modalManager } from '@immich/ui';
  import { mdiImageRemoveOutline } from '@mdi/js';
  import { t } from 'svelte-i18n';
  import { fetchSelectionSpaces, removableSpaces, removeFromSpace, type RemovableSpace } from './space-removal';

  interface Props {
    /** Called with the removed photos that have left the user's timeline: other members' photos it showed only
     * through that space. */
    onLeaveTimeline?: (assetIds: string[]) => void;
  }

  let { onLeaveTimeline }: Props = $props();

  // Wait for the selection to settle (a drag, a day's checkbox) before asking the server.
  const SETTLE_MS = 250;

  const selectedIds = $derived(assetMultiSelectManager.assets.map((asset) => asset.id));
  let answers = $state<AssetSpacesItemDto[]>([]);

  $effect(() => {
    const assetIds = selectedIds;
    answers = [];
    if (assetIds.length === 0) {
      return;
    }
    const controller = new AbortController();
    const ask = async () => {
      try {
        const result = await fetchSelectionSpaces(assetIds, controller.signal);
        // An answer for a selection that has changed since is dropped.
        if (controller.signal.aborted) {
          return;
        }
        answers = result;
        if (result.some(({ spaceIds }) => spaceIds.length > 0)) {
          loadSpaces();
        }
      } catch {
        // No action offered; the next selection asks again.
      }
    };
    const timer = setTimeout(() => void ask(), SETTLE_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  });

  const userId = $derived(authManager.authenticated ? authManager.user.id : undefined);
  const spaces = $derived(userId ? removableSpaces(answers, userInteraction.recentSpaces ?? [], userId) : []);

  const pick = async (): Promise<RemovableSpace | undefined> => {
    const chosen = await modalManager.show(SpacePickerModal, {
      spaces: spaces.map(({ space }) => space),
      counts: Object.fromEntries(spaces.map(({ space, assetIds }) => [space.id, assetIds.length])),
      title: $t('remove_from_space'),
    });
    return spaces.find(({ space }) => space.id === chosen?.id);
  };

  const remove = async () => {
    const target = spaces.length === 1 ? spaces[0] : await pick();
    if (!target) {
      return;
    }
    // Read before the await: a full removal clears the selection and the answers with it.
    const owners = new Map(assetMultiSelectManager.assets.map((asset) => [asset.id, asset.ownerId]));
    const spacesOf = new Map(answers.map(({ assetId, spaceIds }) => [assetId, spaceIds]));
    const removedAssetIds = await removeFromSpace(target.space.id, target.assetIds);
    // The user's own photos stay on their timeline, and so does one still in another of their spaces. Another
    // member's photo that showed only through this space leaves it: taken off in place, as a reload would scroll
    // the timeline back to the top. A stack sibling the server expanded is not on the grid.
    const gone = removedAssetIds.filter(
      (id) =>
        owners.has(id) &&
        owners.get(id) !== userId &&
        (spacesOf.get(id) ?? []).every((spaceId) => spaceId === target.space.id),
    );
    if (gone.length > 0) {
      onLeaveTimeline?.(gone);
    }
  };
</script>

{#if spaces.length > 0}
  <IconButton
    shape="round"
    color="secondary"
    variant="ghost"
    aria-label={spaces.length === 1
      ? $t('remove_from_named_space', { values: { space: spaces[0].space.name } })
      : $t('remove_from_a_space')}
    icon={mdiImageRemoveOutline}
    onclick={remove}
  />
{/if}
