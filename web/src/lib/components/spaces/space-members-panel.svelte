<script lang="ts">
  import UserAvatar from '$lib/components/shared-components/user-avatar.svelte';
  import RoleBadge from '$lib/components/spaces/role-badge.svelte';
  import { getAssetMediaUrl } from '$lib/utils';
  import { handleError } from '$lib/utils/handle-error';
  import SpaceAddMemberModal from '$lib/modals/SpaceAddMemberModal.svelte';
  import {
    removeMember,
    SharedSpaceRole,
    updateMember,
    UserAvatarColor,
    type SharedSpaceMemberResponseDto,
    type SharedSpaceResponseDto,
  } from '@immich/sdk';
  import { Button, Field, Icon, IconButton, modalManager, Select, type SelectOption } from '@immich/ui';
  import { mdiAccountPlusOutline, mdiClose } from '@mdi/js';
  import { t } from 'svelte-i18n';
  import { fade } from 'svelte/transition';

  interface Props {
    space: SharedSpaceResponseDto;
    members: SharedSpaceMemberResponseDto[];
    currentUserId: string;
    isOwner: boolean;
    open: boolean;
    onClose: () => void;
    onMembersChanged: () => void;
  }

  let { space, members, currentUserId, isOwner, open, onClose, onMembersChanged }: Props = $props();

  const toAvatarUser = (member: SharedSpaceMemberResponseDto) => ({
    id: member.userId,
    name: member.name,
    email: member.email,
    profileImagePath: member.profileImagePath ?? '',
    avatarColor: (member.avatarColor as UserAvatarColor) ?? UserAvatarColor.Primary,
    profileChangedAt: member.profileChangedAt ?? '',
  });

  function handleKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      onClose();
    }
  }

  async function handleAddMember() {
    const result = await modalManager.show(SpaceAddMemberModal, {
      spaceId: space.id,
      existingMemberIds: members.map((m) => m.userId),
    });
    if (result) {
      onMembersChanged();
    }
  }

  async function handleRoleChange(member: SharedSpaceMemberResponseDto, newRole: SharedSpaceRole | 'remove') {
    if (newRole === 'remove') {
      const confirmed = await modalManager.showDialog({
        prompt: $t('spaces_remove_member_confirmation', { values: { name: member.name } }),
        title: $t('spaces_remove_member'),
      });
      if (!confirmed) {
        return;
      }
      try {
        await removeMember({ id: space.id, userId: member.userId });
        onMembersChanged();
      } catch (error) {
        handleError(error, $t('errors.error_removing_member'));
      }
      return;
    }

    try {
      await updateMember({
        id: space.id,
        userId: member.userId,
        sharedSpaceMemberUpdateDto: { role: newRole },
      });
      onMembersChanged();
    } catch (error) {
      handleError(error, $t('errors.error_updating_member_role'));
    }
  }

  function formatTimeAgo(isoString: string): string {
    const date = new Date(isoString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60_000);
    if (diffMins < 60) {
      return `${diffMins}m ago`;
    }
    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) {
      return `${diffHours}h ago`;
    }
    const diffDays = Math.floor(diffHours / 24);
    return `${diffDays}d ago`;
  }
</script>

<svelte:window onkeydown={handleKeydown} />

{#if open}
  <!-- Backdrop (mobile only) -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <div
    class="fixed inset-0 z-40 bg-black/30 lg:hidden"
    transition:fade={{ duration: 200 }}
    onclick={onClose}
    data-testid="panel-backdrop"
  ></div>
{/if}

<!-- Panel -->
<aside
  class="fixed right-0 top-0 z-50 flex h-full w-full flex-col border-l border-gray-200 bg-white shadow-xl
    transition-transform duration-300 ease-out dark:border-gray-800 dark:bg-immich-dark-bg sm:w-[380px]"
  class:translate-x-0={open}
  class:translate-x-full={!open}
  data-testid="members-panel"
>
  <!-- Header -->
  <div
    class="flex items-center justify-between border-b border-gray-200 px-5 py-4 dark:border-gray-800"
    data-testid="panel-header"
  >
    <h2 class="text-lg font-semibold">Members ({members.length})</h2>
    <IconButton
      variant="ghost"
      shape="round"
      color="secondary"
      icon={mdiClose}
      onclick={onClose}
      aria-label={$t('close')}
      data-testid="panel-close"
    />
  </div>

  <!-- Add member button (owner only) -->
  {#if isOwner}
    <div class="border-b border-gray-100 px-5 py-3 dark:border-gray-800/50" data-testid="add-member-button">
      <Button size="small" leadingIcon={mdiAccountPlusOutline} onclick={handleAddMember}>
        {$t('spaces_add_member')}
      </Button>
    </div>
  {/if}

  <!-- Member list -->
  <div class="flex-1 overflow-y-auto" data-testid="member-list">
    {#each members as member (member.userId)}
      <div class="border-b border-gray-100 px-5 py-3 dark:border-gray-800/50">
        <!-- Row 1: Avatar, name, email, role -->
        <div class="flex items-center gap-3">
          <UserAvatar user={toAvatarUser(member)} size="sm" />
          <div class="min-w-0 flex-1">
            <p class="truncate text-sm font-medium">{member.name}</p>
            <p class="truncate text-xs text-gray-500">{member.email}</p>
          </div>
          {#if isOwner && member.role !== 'owner'}
            <Field class="w-28 shrink-0">
              <Select
                value={member.role as string as SharedSpaceRole}
                options={[
                  { label: $t('role_editor'), value: SharedSpaceRole.Editor },
                  { label: $t('role_viewer'), value: SharedSpaceRole.Viewer },
                  { label: $t('remove'), value: 'remove' },
                ] as SelectOption<SharedSpaceRole | 'remove'>[]}
                onChange={(value) => handleRoleChange(member, value)}
              />
            </Field>
          {:else}
            <RoleBadge role={member.role} spaceColor={space.color} size="sm" />
          {/if}
        </div>

        <!-- Row 2: Contribution stats -->
        {#if (member.contributionCount ?? 0) > 0}
          <div class="mt-2 flex items-center gap-2.5">
            {#if member.recentAssetId}
              <img
                alt=""
                src={getAssetMediaUrl({ id: member.recentAssetId })}
                class="h-12 w-12 rounded-lg object-cover"
                loading="lazy"
                draggable="false"
              />
            {/if}
            <div class="text-xs text-gray-500">
              <span>{member.contributionCount} photos added</span>
              {#if member.lastActiveAt}
                <span class="mx-0.5">·</span>
                <span>Active {formatTimeAgo(member.lastActiveAt)}</span>
              {/if}
            </div>
          </div>
        {:else}
          <p class="mt-1 text-xs italic text-gray-400">No photos added yet</p>
        {/if}
      </div>
    {/each}
  </div>
</aside>
