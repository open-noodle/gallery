import { addMember, type SharedSpaceMemberResponseDto, type UserResponseDto } from '@immich/sdk';
import { modalManager } from '@immich/ui';
import AddUsersModal from '$lib/modals/AddUsersModal.svelte';
import { handleError } from '$lib/utils/handle-error';
import { getFormatter } from '$lib/utils/i18n';

/**
 * Upstream's `AddUsersModal` (user groups, search), adding each picked user to the space. A user the
 * server refuses is reported and skipped; the others are still added. Resolves to the members added,
 * empty when the modal was cancelled.
 */
export const showAddSpaceMembersModal = async (spaceId: string, existingMemberIds: string[]) => {
  const $t = await getFormatter();
  const added: SharedSpaceMemberResponseDto[] = [];

  const onAddUsers = async (users: UserResponseDto[]) => {
    for (const user of users) {
      try {
        added.push(await addMember({ id: spaceId, sharedSpaceMemberCreateDto: { userId: user.id } }));
      } catch (error) {
        handleError(error, $t('spaces_error_adding_member', { values: { name: user.name } }));
      }
    }
    return true;
  };

  await modalManager.show(AddUsersModal, {
    excludedUserIds: existingMemberIds,
    emptyMessage: $t('spaces_no_users_to_add'),
    onAddUsers,
  });

  return added;
};
