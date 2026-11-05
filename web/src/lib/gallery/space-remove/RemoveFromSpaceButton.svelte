<script lang="ts">
  import { authManager } from '#lib/managers/auth-manager.svelte.ts';
  import { assetMultiSelectManager } from '#lib/managers/asset-multi-select-manager.svelte.ts';
  import SpacePickerModal from '#lib/modals/SpacePickerModal.svelte';
  import { getAllSpacesQuery } from '#lib/gallery/spaces/space.query.ts';
  import { queryClient } from '#lib/queries/client.ts';
  import type { AssetSpacesItemDto } from '@immich/sdk';
  import { IconButton, modalManager } from '@immich/ui';
  import { mdiImageRemoveOutline } from '@mdi/js';
  import { createQuery } from '@tanstack/svelte-query';
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

  // The spaces list names the spaces; only a selection with a photo in one needs it.
  const spacesQuery = createQuery(
    () => ({ ...getAllSpacesQuery(), enabled: answers.some(({ spaceIds }) => spaceIds.length > 0) }),
    () => queryClient,
  );

  const userId = $derived(authManager.authenticated ? authManager.user.id : undefined);
  const spaces = $derived(userId ? removableSpaces(answers, spacesQuery.data ?? [], userId) : []);

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
    const removedAssetIds = await removeFromSpace(target.space.id, target.assetIds, target.space.name);
    // The user's own photos stay on their timeline. Another member's photo leaves it once it is in none of the
    // user's spaces: taken off in place, as a reload would scroll the timeline back to the top. The server is asked
    // again, since a photo it removed can still be in that space through a linked album or library, or in another
    // space. A stack sibling the server expanded is not on the grid.
    const candidates = removedAssetIds.filter((id) => owners.has(id) && owners.get(id) !== userId);
    if (candidates.length === 0 || !onLeaveTimeline) {
      return;
    }
    let stillInSpaces: AssetSpacesItemDto[];
    try {
      stillInSpaces = await fetchSelectionSpaces(candidates);
    } catch {
      // Left on the grid; the next load drops them.
      return;
    }
    const stillShown = new Set(
      stillInSpaces.filter(({ spaceIds }) => spaceIds.length > 0).map(({ assetId }) => assetId),
    );
    const gone = candidates.filter((id) => !stillShown.has(id));
    if (gone.length > 0) {
      onLeaveTimeline(gone);
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
