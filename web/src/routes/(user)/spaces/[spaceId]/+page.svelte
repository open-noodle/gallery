<script lang="ts">
  import UserPageLayout from '$lib/components/layouts/user-page-layout.svelte';
  import UserAvatar from '$lib/components/shared-components/user-avatar.svelte';
  import SpaceAddMemberModal from '$lib/modals/SpaceAddMemberModal.svelte';
  import { Route } from '$lib/route';
  import {
    removeMember,
    removeSpace,
    UserAvatarColor,
    type SharedSpaceMemberResponseDto,
    type SharedSpaceResponseDto,
  } from '@immich/sdk';
  import { Button, IconButton, modalManager, Text } from '@immich/ui';
  import { mdiAccountPlus, mdiArrowLeft, mdiClose, mdiDelete } from '@mdi/js';
  import { goto } from '$app/navigation';
  import { t } from 'svelte-i18n';
  import type { PageData } from './$types';

  interface Props {
    data: PageData;
  }

  let { data }: Props = $props();
  let space: SharedSpaceResponseDto = $state(data.space);
  let members: SharedSpaceMemberResponseDto[] = $state(data.members);

  const handleDelete = async () => {
    const confirmed = await modalManager.showDialog({
      prompt: $t('spaces_delete_confirmation', { values: { name: space.name } }),
      title: $t('spaces_delete'),
    });

    if (!confirmed) {
      return;
    }

    await removeSpace({ id: space.id });
    await goto(Route.spaces());
  };

  const handleAddMember = async () => {
    const added = await modalManager.show(SpaceAddMemberModal, {
      spaceId: space.id,
      existingMemberIds: members.map((m) => m.userId),
    });

    if (added && added.length > 0) {
      members = [...members, ...added];
    }
  };

  const handleRemoveMember = async (member: SharedSpaceMemberResponseDto) => {
    const confirmed = await modalManager.showDialog({
      prompt: $t('spaces_remove_member_confirmation', { values: { name: member.name } }),
      title: $t('spaces_remove_member'),
    });

    if (!confirmed) {
      return;
    }

    await removeMember({ id: space.id, userId: member.userId });
    members = members.filter((m) => m.userId !== member.userId);
  };

  const toAvatarUser = (member: SharedSpaceMemberResponseDto) => ({
    id: member.userId,
    name: member.name,
    email: member.email,
    profileImagePath: member.profileImagePath ?? '',
    avatarColor: (member.avatarColor as UserAvatarColor) ?? UserAvatarColor.Primary,
    profileChangedAt: member.profileChangedAt ?? '',
  });
</script>

<UserPageLayout title={space.name}>
  {#snippet buttons()}
    <div class="flex gap-2">
      <Button shape="round" size="small" leadingIcon={mdiArrowLeft} href={Route.spaces()}>
        {$t('back')}
      </Button>
      <Button shape="round" size="small" leadingIcon={mdiAccountPlus} onclick={handleAddMember}>
        {$t('spaces_add_member')}
      </Button>
      <Button shape="round" size="small" color="danger" leadingIcon={mdiDelete} onclick={handleDelete}>
        {$t('spaces_delete')}
      </Button>
    </div>
  {/snippet}

  <div class="mt-4">
    {#if space.description}
      <p class="text-sm text-immich-fg/75 dark:text-immich-dark-fg/75 mb-4">{space.description}</p>
    {/if}

    <div class="flex gap-4 text-sm text-immich-fg/60 dark:text-immich-dark-fg/60 mb-6">
      <span>{space.assetCount ?? 0} {$t('photos')}</span>
      <span>{members.length} {$t('members')}</span>
    </div>

    <section>
      <div class="flex justify-between items-center mb-4">
        <h2 class="text-lg font-medium">{$t('members')}</h2>
      </div>

      {#each members as member (member.userId)}
        <div class="flex items-center gap-4 py-3 border-b border-gray-200 dark:border-gray-800">
          <UserAvatar user={toAvatarUser(member)} size="md" />
          <div class="flex-1">
            <Text fontWeight="medium">{member.name}</Text>
            <Text size="tiny" color="muted">{member.email}</Text>
          </div>
          <span class="text-sm text-immich-fg/60 dark:text-immich-dark-fg/60 capitalize">{member.role}</span>
          {#if member.role !== 'owner'}
            <IconButton
              shape="round"
              size="small"
              icon={mdiClose}
              aria-label={$t('spaces_remove_member')}
              onclick={() => handleRemoveMember(member)}
            />
          {/if}
        </div>
      {/each}
    </section>
  </div>
</UserPageLayout>
