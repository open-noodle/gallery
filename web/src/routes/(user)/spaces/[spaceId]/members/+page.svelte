<script lang="ts">
  import { invalidateAll } from '$app/navigation';
  import UserAvatar from '$lib/components/shared-components/UserAvatar.svelte';
  import RoleBadge from '$lib/components/spaces/role-badge.svelte';
  import SpaceAddMemberModal from '$lib/modals/SpaceAddMemberModal.svelte';
  import { authManager } from '$lib/managers/auth-manager.svelte';
  import { getAssetMediaUrl } from '$lib/utils';
  import { handleError } from '$lib/utils/handle-error';
  import { formatTimeAgo } from '$lib/utils/timesince';
  import {
    removeMember,
    SharedSpaceRole,
    updateMember,
    UserAvatarColor,
    type SharedSpaceMemberResponseDto,
  } from '@immich/sdk';
  import { Button, Field, modalManager, Select, type SelectOption } from '@immich/ui';
  import { mdiAccountPlusOutline } from '@mdi/js';
  import { t } from 'svelte-i18n';
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();
  const space = $derived(data.space);
  const members = $derived(data.members);
  const currentMember = $derived(members.find((m) => m.userId === authManager.user.id));
  const isOwner = $derived(currentMember?.role === SharedSpaceRole.Owner);

  const toAvatarUser = (m: SharedSpaceMemberResponseDto) => ({
    id: m.userId,
    name: m.name,
    email: m.email,
    profileImagePath: m.profileImagePath ?? '',
    avatarColor: (m.avatarColor as UserAvatarColor) ?? UserAvatarColor.Primary,
    profileChangedAt: m.profileChangedAt ?? '',
  });

  async function handleAddMember() {
    const result = await modalManager.show(SpaceAddMemberModal, {
      spaceId: space.id,
      existingMemberIds: members.map((m) => m.userId),
    });
    if (result) {
      await invalidateAll();
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
        await invalidateAll();
      } catch (error) {
        handleError(error, $t('errors.error_removing_member'));
      }
      return;
    }
    try {
      await updateMember({ id: space.id, userId: member.userId, sharedSpaceMemberUpdateDto: { role: newRole } });
      await invalidateAll();
    } catch (error) {
      handleError(error, $t('errors.error_updating_member_role'));
    }
  }
</script>

<div class="mx-auto w-full max-w-3xl p-4">
  <div class="mb-3 flex items-center justify-between">
    <h2 class="text-base font-semibold">{$t('members')} ({members.length})</h2>
    {#if isOwner || authManager.isDemo}
      <Button size="small" leadingIcon={mdiAccountPlusOutline} onclick={handleAddMember} data-testid="members-invite">
        {$t('spaces_add_member')}
      </Button>
    {/if}
  </div>

  <div data-testid="member-list" class="rounded-xl border border-gray-200 dark:border-gray-800">
    {#each members as member (member.userId)}
      <div class="border-b border-gray-100 px-4 py-3 last:border-b-0 dark:border-gray-800/50">
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
                onChange={(value) => void handleRoleChange(member, value)}
              />
            </Field>
          {:else}
            <RoleBadge role={member.role} spaceColor={space.color} size="sm" />
          {/if}
        </div>
        {#if (member.contributionCount ?? 0) > 0}
          <div class="mt-2 flex items-center gap-2.5">
            {#if member.recentAssetId}
              <img
                alt=""
                src={getAssetMediaUrl({ id: member.recentAssetId })}
                class="size-12 rounded-lg object-cover"
                loading="lazy"
                draggable="false"
              />
            {/if}
            <div class="text-xs text-gray-500">
              <span>{member.contributionCount} {$t('photos')}</span>
              {#if member.lastActiveAt}
                <span class="mx-0.5">·</span><span>{formatTimeAgo(member.lastActiveAt)}</span>
              {/if}
            </div>
          </div>
        {/if}
      </div>
    {/each}
  </div>
</div>
