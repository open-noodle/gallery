import {
  getMembers,
  getPersonFaces,
  getSpacePersonFaces,
  SharedSpaceRole,
  Type,
  updatePerson,
  updateRepresentativeFace,
  updateSpacePerson,
  updateSpacePersonRepresentativeFace,
  type PersonFacePageResponseDto,
  type PersonResponseDto,
} from '@immich/sdk';
import { modalManager, toastManager, type ActionItem } from '@immich/ui';
import {
  mdiCalendarEditOutline,
  mdiEyeOffOutline,
  mdiEyeOutline,
  mdiHeartMinusOutline,
  mdiHeartOutline,
} from '@mdi/js';
import type { MessageFormatter } from 'svelte-i18n';
import { eventManager } from '$lib/managers/event-manager.svelte';
import PersonEditBirthDateModal from '$lib/modals/PersonEditBirthDateModal.svelte';
import { handleError } from '$lib/utils/handle-error';
import { getFormatter } from '$lib/utils/i18n';
import { getPersonFaceThumbnailUrl, getSpacePersonFaceThumbnailUrl } from '$lib/utils/people-utils';

// Members of a shared space see space-scoped people whose IDs do not exist in the person table;
// writes for those must go to the shared space endpoint instead of person.update.
const getSpaceProfile = (person: PersonResponseDto) => {
  const profile = person.primaryProfile;
  return profile?.type === Type.SpacePerson && profile.spaceId
    ? { id: profile.id, spaceId: profile.spaceId }
    : undefined;
};

// Resolved per space and cached for the session; the server enforces the role on every
// write, so membership lookup failures fail open instead of hiding working actions.
const spaceEditableCache = new Map<string, Promise<boolean>>();

const resolveSpaceEditable = async (spaceId: string, userId: string): Promise<boolean> => {
  try {
    const members = await getMembers({ id: spaceId });
    const role = members.find((member) => member.userId === userId)?.role;
    return role === SharedSpaceRole.Owner || role === SharedSpaceRole.Editor;
  } catch {
    return true;
  }
};

export const isSpaceEditor = (spaceId: string, userId: string): Promise<boolean> => {
  const key = `${spaceId}:${userId}`;
  let cached = spaceEditableCache.get(key);
  if (!cached) {
    cached = resolveSpaceEditable(spaceId, userId);
    spaceEditableCache.set(key, cached);
  }
  return cached;
};

export const getPersonActions = (
  $t: MessageFormatter,
  person: PersonResponseDto,
  { canEditSpacePerson = true }: { canEditSpacePerson?: boolean } = {},
) => {
  const canWrite = () => !getSpaceProfile(person) || canEditSpacePerson;

  const SetDateOfBirth: ActionItem = {
    title: $t('set_date_of_birth'),
    icon: mdiCalendarEditOutline,
    $if: canWrite,
    onAction: () => modalManager.show(PersonEditBirthDateModal, { person }),
  };

  // Shared space people have no favorite state, so don't offer it for them.
  const Favorite: ActionItem = {
    title: $t('to_favorite'),
    icon: mdiHeartOutline,
    $if: () => !getSpaceProfile(person) && !person.isFavorite,
    onAction: () => handleFavoritePerson(person),
  };

  const Unfavorite: ActionItem = {
    title: $t('unfavorite'),
    icon: mdiHeartMinusOutline,
    $if: () => !getSpaceProfile(person) && !!person.isFavorite,
    onAction: () => handleUnfavoritePerson(person),
  };

  const HidePerson: ActionItem = {
    title: $t('hide_person'),
    icon: mdiEyeOffOutline,
    $if: () => !person.isHidden && canWrite(),
    onAction: () => handleHidePerson(person),
  };

  const ShowPerson: ActionItem = {
    title: $t('unhide_person'),
    icon: mdiEyeOutline,
    $if: () => !!person.isHidden && canWrite(),
    onAction: () => handleShowPerson(person),
  };

  return { SetDateOfBirth, Favorite, Unfavorite, HidePerson, ShowPerson };
};

const handleFavoritePerson = async (person: { id: string }) => {
  const $t = await getFormatter();

  try {
    const response = await updatePerson({ id: person.id, personUpdateDto: { isFavorite: true } });
    eventManager.emit('PersonUpdate', response);
    toastManager.primary($t('added_to_favorites'));
  } catch (error) {
    handleError(error, $t('errors.unable_to_add_remove_favorites', { values: { favorite: false } }));
  }
};

const handleUnfavoritePerson = async (person: { id: string }) => {
  const $t = await getFormatter();

  try {
    const response = await updatePerson({ id: person.id, personUpdateDto: { isFavorite: false } });
    eventManager.emit('PersonUpdate', response);
    toastManager.primary($t('removed_from_favorites'));
  } catch (error) {
    handleError(error, $t('errors.unable_to_add_remove_favorites', { values: { favorite: false } }));
  }
};

const updatePersonVisibility = async (person: PersonResponseDto, isHidden: boolean): Promise<PersonResponseDto> => {
  const profile = getSpaceProfile(person);
  if (profile) {
    const updated = await updateSpacePerson({
      id: profile.spaceId,
      personId: profile.id,
      sharedSpacePersonUpdateDto: { isHidden },
    });
    return { ...person, isHidden: updated.isHidden };
  }
  return updatePerson({ id: person.id, personUpdateDto: { isHidden } });
};

const handleHidePerson = async (person: PersonResponseDto) => {
  const $t = await getFormatter();

  try {
    const response = await updatePersonVisibility(person, true);
    toastManager.primary($t('changed_visibility_successfully'));
    eventManager.emit('PersonUpdate', response);
  } catch (error) {
    handleError(error, $t('errors.unable_to_hide_person'));
  }
};

const handleShowPerson = async (person: PersonResponseDto) => {
  const $t = await getFormatter();

  try {
    const response = await updatePersonVisibility(person, false);
    toastManager.primary($t('changed_visibility_successfully'));
    eventManager.emit('PersonUpdate', response);
  } catch (error) {
    handleError(error, $t('errors.something_went_wrong'));
  }
};

export const getPersonFacesPage = (
  person: PersonResponseDto,
  { page, size }: { page: number; size: number },
): Promise<PersonFacePageResponseDto> => {
  const profile = getSpaceProfile(person);
  return profile
    ? getSpacePersonFaces({ id: profile.spaceId, personId: profile.id, page, size })
    : getPersonFaces({ id: person.id, page, size });
};

export const updatePersonRepresentativeFace = async (
  person: PersonResponseDto,
  assetFaceId: string,
): Promise<PersonResponseDto> => {
  const profile = getSpaceProfile(person);
  if (profile) {
    const updated = await updateSpacePersonRepresentativeFace({
      id: profile.spaceId,
      personId: profile.id,
      spaceRepresentativeFaceUpdateDto: { assetFaceId },
    });
    return { ...person, updatedAt: updated.updatedAt };
  }
  return updateRepresentativeFace({ id: person.id, representativeFaceUpdateDto: { assetFaceId } });
};

export const getPersonFaceThumbnail = (person: PersonResponseDto, faceId: string): string => {
  const profile = getSpaceProfile(person);
  return profile
    ? getSpacePersonFaceThumbnailUrl(profile.spaceId, profile.id, faceId, person.updatedAt)
    : getPersonFaceThumbnailUrl(person.id, faceId, person.updatedAt);
};

export const updatePersonName = async (person: PersonResponseDto, name: string): Promise<PersonResponseDto> => {
  const profile = getSpaceProfile(person);
  if (profile) {
    const updated = await updateSpacePerson({
      id: profile.spaceId,
      personId: profile.id,
      sharedSpacePersonUpdateDto: { name },
    });
    return {
      ...person,
      name: updated.name,
      birthDate: updated.birthDate ?? person.birthDate,
      isHidden: updated.isHidden,
      updatedAt: updated.updatedAt,
      type: updated.type ?? person.type,
      numberOfAssets: updated.assetCount,
    };
  }
  return updatePerson({ id: person.id, personUpdateDto: { name } });
};

export const handleUpdatePersonBirthDate = async (person: PersonResponseDto, birthDate: string | null) => {
  const $t = await getFormatter();

  try {
    const profile = getSpaceProfile(person);
    let response: PersonResponseDto;
    if (profile) {
      const updated = await updateSpacePerson({
        id: profile.spaceId,
        personId: profile.id,
        sharedSpacePersonUpdateDto: { birthDate },
      });
      response = { ...person, birthDate: updated.birthDate ?? null };
    } else {
      response = await updatePerson({ id: person.id, personUpdateDto: { birthDate } });
    }
    toastManager.primary($t('date_of_birth_saved'));
    eventManager.emit('PersonUpdate', response);
    return true;
  } catch (error) {
    handleError(error, $t('errors.unable_to_save_date_of_birth'));
  }
};
