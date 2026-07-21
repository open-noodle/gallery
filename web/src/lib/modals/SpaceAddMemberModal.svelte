<script lang="ts">
  import UserAvatar from '$lib/components/shared-components/UserAvatar.svelte';
  import {
    addMember,
    getAllGroups,
    searchUsers,
    type SharedSpaceMemberResponseDto,
    type UserGroupResponseDto,
    type UserResponseDto,
  } from '@immich/sdk';
  import { FormModal, ListButton, Stack, Text } from '@immich/ui';
  import { mdiAccountPlus } from '@mdi/js';
  import { onMount } from 'svelte';
  import { t } from 'svelte-i18n';
  import { SvelteMap, SvelteSet } from 'svelte/reactivity';
  import LoadingSpinner from '$lib/components/shared-components/LoadingSpinner.svelte';
  import { handleError } from '$lib/utils/handle-error';

  type Props = {
    spaceId: string;
    existingMemberIds: string[];
    onClose: (added?: SharedSpaceMemberResponseDto[]) => void;
  };

  const { spaceId, existingMemberIds, onClose }: Props = $props();

  let users: UserResponseDto[] = $state([]);
  let groups: UserGroupResponseDto[] = $state([]);
  const filteredUsers = $derived(users.filter(({ id }) => !existingMemberIds.includes(id)));
  const selectedUsers = new SvelteMap<string, UserResponseDto>();
  const activeGroupIds = new SvelteSet<string>();
  let loading = $state(true);

  const colorClasses: Record<string, string> = {
    primary: 'bg-immich-primary text-white',
    pink: 'bg-pink-500 text-white',
    red: 'bg-red-500 text-white',
    yellow: 'bg-yellow-500 text-white',
    blue: 'bg-blue-500 text-white',
    green: 'bg-green-500 text-white',
    purple: 'bg-purple-500 text-white',
    orange: 'bg-orange-500 text-white',
    gray: 'bg-gray-500 text-white',
    amber: 'bg-amber-500 text-white',
  };

  const filteredGroups = $derived(
    groups.filter((group) => group.members.some((m) => !existingMemberIds.includes(m.userId))),
  );

  const handleGroupToggle = (group: UserGroupResponseDto) => {
    if (activeGroupIds.has(group.id)) {
      activeGroupIds.delete(group.id);
      for (const member of group.members) {
        if (existingMemberIds.includes(member.userId)) {
          continue;
        }

        const coveredByOtherGroup = groups.some(
          (g) => g.id !== group.id && activeGroupIds.has(g.id) && g.members.some((m) => m.userId === member.userId),
        );
        if (!coveredByOtherGroup) {
          selectedUsers.delete(member.userId);
        }
      }
    } else {
      activeGroupIds.add(group.id);
      for (const member of group.members) {
        if (existingMemberIds.includes(member.userId)) {
          continue;
        }

        const user = users.find((u) => u.id === member.userId);
        if (user) {
          selectedUsers.set(user.id, user);
        }
      }
    }
  };

  const handleToggle = (user: UserResponseDto) => {
    if (selectedUsers.has(user.id)) {
      selectedUsers.delete(user.id);
    } else {
      selectedUsers.set(user.id, user);
    }
  };

  const onSubmit = async () => {
    const added: SharedSpaceMemberResponseDto[] = [];
    for (const user of selectedUsers.values()) {
      try {
        const member = await addMember({
          id: spaceId,
          sharedSpaceMemberCreateDto: { userId: user.id },
        });
        added.push(member);
      } catch (error) {
        handleError(error, $t('spaces_error_adding_member', { values: { name: user.name } }));
      }
    }
    onClose(added);
  };

  onMount(async () => {
    const [userList, groupList] = await Promise.all([searchUsers(), getAllGroups()]);
    users = userList;
    groups = groupList;
    loading = false;
  });
</script>

<FormModal
  icon={mdiAccountPlus}
  title={$t('spaces_add_member')}
  submitText={$t('add')}
  cancelText={$t('back')}
  {onSubmit}
  disabled={selectedUsers.size === 0}
  {onClose}
>
  {#if loading}
    <div class="flex w-full place-content-center place-items-center p-4">
      <LoadingSpinner />
    </div>
  {:else}
    {#if filteredGroups.length > 0}
      <div class="mb-3 flex flex-wrap gap-2">
        {#each filteredGroups as group (group.id)}
          {@const eligibleCount = group.members.filter((m) => !existingMemberIds.includes(m.userId)).length}
          <button
            type="button"
            class="rounded-full border px-3 py-1 text-xs font-medium transition-all {activeGroupIds.has(group.id)
              ? group.color
                ? (colorClasses[group.color] ?? 'bg-gray-700 text-white')
                : 'bg-gray-700 text-white dark:bg-gray-200 dark:text-gray-800'
              : 'border-gray-300 bg-transparent text-gray-600 hover:bg-gray-100 dark:border-gray-600 dark:text-gray-400 dark:hover:bg-gray-800'}"
            onclick={() => handleGroupToggle(group)}
          >
            {group.name}
            <span class="ml-1 opacity-75">{eligibleCount}</span>
          </button>
        {/each}
      </div>
    {/if}
    <Stack>
      {#each filteredUsers as user (user.id)}
        <ListButton selected={selectedUsers.has(user.id)} onclick={() => handleToggle(user)}>
          <UserAvatar {user} size="md" />
          <div class="grow text-start">
            <Text fontWeight="medium">{user.name}</Text>
            <Text size="tiny" color="muted">{user.email}</Text>
          </div>
        </ListButton>
      {:else}
        <Text class="py-6">{$t('spaces_no_users_to_add')}</Text>
      {/each}
    </Stack>
  {/if}
</FormModal>
