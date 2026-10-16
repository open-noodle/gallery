import {
  detachScopedPerson,
  getPersonFaces,
  getSpacePersonFaces,
  Type2 as ScopedPersonProfileType,
  SharedSpaceRole,
  updatePerson,
  updateRepresentativeFace,
  updateSpacePerson,
  updateSpacePersonRepresentativeFace,
  type PersonFacePageResponseDto,
  type PersonFaceResponseDto,
  type PersonResponseDto,
  type SharedSpaceResponseDto,
} from '@immich/sdk';
import { modalManager, toastManager, type ActionItem } from '@immich/ui';
import { mdiAccountBoxOutline, mdiAccountMultipleCheckOutline } from '@mdi/js';
import type { MessageFormatter } from 'svelte-i18n';
import { invalidateAll } from '$app/navigation';
import { eventManager } from '$lib/managers/event-manager.svelte';
import RepresentativeFacePickerModal from '$lib/modals/RepresentativeFacePickerModal.svelte';
import { getSpaceProfile } from '$lib/utils/global-person-route';
import { handleError } from '$lib/utils/handle-error';
import { getFormatter } from '$lib/utils/i18n';
import { getPersonFaceThumbnailUrl, getSpacePersonFaceThumbnailUrl } from '$lib/utils/people-utils';

// The role is the viewer's own row in the spaces list (`getAllSpaces` embeds `members`, see
// loadSpaces). The server enforces the role on every write, so this fails open: while the list is
// unknown (loading or failed), or when it lacks the space (joined since it was cached), the actions
// stay offered rather than hidden from an editor.
export const isSpaceEditor = (spaces: SharedSpaceResponseDto[] | undefined, spaceId: string, userId: string) => {
  const space = spaces?.find(({ id }) => id === spaceId);
  if (!space) {
    return true;
  }
  const role = space.members?.find((member) => member.userId === userId)?.role;
  return role === SharedSpaceRole.Owner || role === SharedSpaceRole.Editor;
};

export const updatePersonVisibility = async (
  person: PersonResponseDto,
  isHidden: boolean,
): Promise<PersonResponseDto> => {
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

// The person page's fork menu items. Getters, because the page's person changes after a face pick.
export const getPersonPageActions = (
  $t: MessageFormatter,
  {
    getPerson,
    canEditSpacePerson,
    onPersonUpdate,
    onThumbnailUpdate,
  }: {
    getPerson: () => PersonResponseDto;
    canEditSpacePerson: () => boolean;
    onPersonUpdate: (person: PersonResponseDto) => void;
    onThumbnailUpdate: () => void;
  },
) => {
  const SelectRepresentativeFace: ActionItem = {
    title: $t('select_representative_face'),
    icon: mdiAccountBoxOutline,
    $if: canEditSpacePerson,
    onAction: async () => {
      const updated = await modalManager.show(RepresentativeFacePickerModal, {
        title: $t('select_representative_face'),
        loadFaces: ({ page, size }: { page: number; size: number }) => getPersonFacesPage(getPerson(), { page, size }),
        updateFace: async (faceId: string) => {
          onPersonUpdate(await updatePersonRepresentativeFace(getPerson(), faceId));
        },
        getThumbnailUrl: (face: PersonFaceResponseDto) => getPersonFaceThumbnail(getPerson(), face.id),
        canUpdate: true,
      });

      if (updated) {
        onThumbnailUpdate();
      }
    },
  };

  const SeparateFromGroupedPerson: ActionItem = {
    title: $t('separate_from_grouped_person'),
    icon: mdiAccountMultipleCheckOutline,
    onAction: async () => {
      const isConfirm = await modalManager.showDialog({ prompt: $t('separate_from_grouped_person_prompt') });
      if (!isConfirm) {
        return;
      }

      try {
        await detachScopedPerson({
          detachScopedPersonDto: { profile: { type: ScopedPersonProfileType.Person, id: getPerson().id } },
        });
        await invalidateAll();
        toastManager.primary($t('separate_from_grouped_person'));
      } catch (error) {
        handleError(error, $t('errors.unable_to_save_name'));
      }
    },
  };

  return { SelectRepresentativeFace, SeparateFromGroupedPerson };
};
