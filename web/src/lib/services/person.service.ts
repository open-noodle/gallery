import {
  getPerson,
  PersonUpdateStrategy,
  updatePerson,
  type AssetResponseDto,
  type PersonResponseDto,
  type PersonUpdateDto,
} from '@immich/sdk';
import { modalManager, toastManager, type ActionItem } from '@immich/ui';
import {
  mdiCalendarEditOutline,
  mdiEyeOffOutline,
  mdiEyeOutline,
  mdiFaceManProfile,
  mdiHeartMinusOutline,
  mdiHeartOutline,
} from '@mdi/js';
import type { MessageFormatter } from 'svelte-i18n';
import { updatePersonVisibility } from '$lib/gallery/people/person.service';
import { authManager } from '$lib/managers/auth-manager.svelte';
import { eventManager } from '$lib/managers/event-manager.svelte';
import PersonEditBirthDateModal from '$lib/modals/PersonEditBirthDateModal.svelte';
import { getSpaceProfile } from '$lib/utils/global-person-route';
import { handleError } from '$lib/utils/handle-error';
import { getFormatter } from '$lib/utils/i18n';

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

export const getPersonAssetActions = ($t: MessageFormatter, person: PersonResponseDto, asset: AssetResponseDto) => {
  const SetFeaturedPhoto: ActionItem = {
    title: $t('set_as_featured_photo'),
    icon: mdiFaceManProfile,
    onAction: () => handleSetFeaturedPhoto(person, asset.id),
  };

  return { SetFeaturedPhoto };
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

export const handleUpdatePerson = async ({ id, ...personUpdateDto }: { id: string } & PersonUpdateDto) => {
  const $t = await getFormatter();

  try {
    const response = await updatePerson({ id, personUpdateDto });
    const isOtherUser = !!personUpdateDto.userId && personUpdateDto.userId !== authManager.user.id;
    eventManager.emit('PersonUpdate', isOtherUser ? await getPerson({ id }) : response);
    return response;
  } catch (error) {
    handleError(error, $t('errors.something_went_wrong'));
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

export const withUpdateStrategy = (dto: PersonUpdateDto): PersonUpdateDto =>
  authManager.preferences.people?.updateStrategy === PersonUpdateStrategy.Self
    ? { ...dto, userId: authManager.user.id }
    : dto;

export const handleUpdatePersonName = async (
  { id, name }: { id: string; name: string },
  options?: { notify: boolean },
) => {
  const response = await handleUpdatePerson({ id, ...withUpdateStrategy({ name }) });
  if (response && options?.notify) {
    const $t = await getFormatter();
    toastManager.primary($t('change_name_successfully'));
  }

  return response;
};

const handleSetFeaturedPhoto = async (person: PersonResponseDto, featureFaceAssetId: string) => {
  const $t = await getFormatter();

  try {
    const response = await updatePerson({ id: person.id, personUpdateDto: { featureFaceAssetId } });
    toastManager.primary($t('feature_photo_updated'));
    eventManager.emit('PersonUpdate', response);
  } catch (error) {
    handleError(error, $t('errors.unable_to_set_feature_photo'));
  }
};
