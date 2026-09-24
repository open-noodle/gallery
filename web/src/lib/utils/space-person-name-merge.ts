import { getSpacePeople, mergeSpacePeople, type SharedSpacePersonResponseDto } from '@immich/sdk';
import { modalManager, toastManager } from '@immich/ui';
import { t } from 'svelte-i18n';
import { get } from 'svelte/store';
import { createCrossOwnerMergeHandlers, runMergeWithCrossOwnerConfirmation } from '$lib/utils/cross-owner-merge';
import { normalizeSearchString } from '$lib/utils/string-utils';

/**
 * The space person already carrying `name` (case- and accent-insensitive), other than `excludeId`.
 * Naming a second person with an existing name is almost always a duplicate of the same identity (#1100).
 */
export const findSpacePersonNamed = async (
  spaceId: string,
  name: string,
  excludeId: string,
): Promise<SharedSpacePersonResponseDto | undefined> => {
  const normalizedName = normalizeSearchString(name);
  const people = await getSpacePeople({ id: spaceId, name, named: true, limit: 20 });
  return people.find(
    (person) => person.id !== excludeId && !!person.name && normalizeSearchString(person.name) === normalizedName,
  );
};

/**
 * Asks before merging `sourceId` into `targetId` within a space, then runs the space merge with the
 * cross-owner confirmation. Returns whether the merge committed; request errors propagate.
 */
export const confirmAndMergeSpacePerson = async ({
  spaceId,
  sourceId,
  targetId,
}: {
  spaceId: string;
  sourceId: string;
  targetId: string;
}): Promise<boolean> => {
  const $t = get(t);
  const isConfirm = await modalManager.showDialog({ prompt: $t('merge_people_prompt') });
  if (!isConfirm) {
    return false;
  }

  const committed = await runMergeWithCrossOwnerConfirmation(
    (confirmCrossOwner) =>
      mergeSpacePeople({
        id: spaceId,
        personId: targetId,
        sharedSpacePersonMergeDto: confirmCrossOwner
          ? { ids: [sourceId], confirmCrossOwner: true }
          : { ids: [sourceId] },
      }),
    createCrossOwnerMergeHandlers(),
  );
  if (committed) {
    toastManager.success($t('spaces_people_merged'));
  }
  return committed;
};
