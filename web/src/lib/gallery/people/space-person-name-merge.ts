import {
  getSpacePeople,
  mergeSpacePeople,
  searchPerson,
  type PersonResponseDto,
  type SharedSpacePersonResponseDto,
} from '@immich/sdk';
import { modalManager, toastManager } from '@immich/ui';
import { t } from 'svelte-i18n';
import { get } from 'svelte/store';
import { createCrossOwnerMergeHandlers, runMergeWithCrossOwnerConfirmation } from '$lib/utils/cross-owner-merge';
import { handleError } from '$lib/utils/handle-error';
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
 * - `merged`: the merge committed.
 * - `declined`: the user answered no to "are these the same person?". A rename may go ahead.
 * - `failed`: the user said yes but nothing merged: the server blocked it (cross-owner merges are
 *   off), the user backed out of the cross-owner confirmation, or a known terminal error. The user has
 *   seen why, so the caller must not rename: that would create the duplicate the merge was for (#1100).
 */
export type SpacePersonMergeOutcome = 'merged' | 'declined' | 'failed';

/**
 * Asks before merging `sourceId` into `targetId` within a space, then runs the space merge with the
 * cross-owner confirmation. Request errors other than the known merge refusals propagate.
 */
export const confirmAndMergeSpacePerson = async ({
  spaceId,
  sourceId,
  targetId,
}: {
  spaceId: string;
  sourceId: string;
  targetId: string;
}): Promise<SpacePersonMergeOutcome> => {
  const $t = get(t);
  const isConfirm = await modalManager.showDialog({ prompt: $t('merge_people_prompt') });
  if (!isConfirm) {
    return 'declined';
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
  if (!committed) {
    return 'failed';
  }
  toastManager.success($t('spaces_people_merged'));
  return 'merged';
};

/**
 * Name suggestions for the global People grid: the viewer's own people and the shared-space people
 * they can see. An editor naming a space person owns none of the existing ones (#1099).
 */
export const searchPeopleWithSharedSpaces = async (name: string): Promise<PersonResponseDto[]> => {
  try {
    return await searchPerson({ name, withSharedSpaces: true });
  } catch (error) {
    handleError(error, get(t)('errors.cant_search_people'));
    return [];
  }
};
