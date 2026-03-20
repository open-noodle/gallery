<script lang="ts">
  import UserAvatar from '$lib/components/shared-components/user-avatar.svelte';
  import LoadingSpinner from '$lib/components/shared-components/LoadingSpinner.svelte';
  import ColorPicker from '$lib/components/spaces/color-picker.svelte';
  import {
    searchUsers,
    UserAvatarColor,
    type UserGroupResponseDto,
    type UserResponseDto,
  } from '@immich/sdk';
  import { Field, FormModal, Input, ListButton, Stack, Text } from '@immich/ui';
  import { mdiAccountGroup } from '@mdi/js';
  import { onMount } from 'svelte';
  import { t } from 'svelte-i18n';
  import { SvelteMap } from 'svelte/reactivity';

  type Props = {
    group?: UserGroupResponseDto;
    currentUserId: string;
    onClose: (result?: { name: string; color: UserAvatarColor | null; userIds: string[] }) => void;
  };

  const { group, currentUserId, onClose }: Props = $props();

  let name = $state(group?.name ?? '');
  let color = $state<UserAvatarColor | null>((group?.color as UserAvatarColor) ?? null);
  let users: UserResponseDto[] = $state([]);
  let loading = $state(true);
  let search = $state('');

  const selectedUsers = new SvelteMap<string, UserResponseDto>();

  const filteredUsers = $derived(
    users
      .filter(({ id }) => id !== currentUserId)
      .filter(({ name, email }) => {
        if (!search) return true;
        const q = search.toLowerCase();
        return name.toLowerCase().includes(q) || email.toLowerCase().includes(q);
      }),
  );

  const handleToggle = (user: UserResponseDto) => {
    if (selectedUsers.has(user.id)) {
      selectedUsers.delete(user.id);
    } else {
      selectedUsers.set(user.id, user);
    }
  };

  const onSubmit = () => {
    onClose({ name, color, userIds: [...selectedUsers.keys()] });
  };

  onMount(async () => {
    users = await searchUsers();

    if (group?.members) {
      for (const member of group.members) {
        const user = users.find((u) => u.id === member.userId);
        if (user) {
          selectedUsers.set(user.id, user);
        }
      }
    }

    loading = false;
  });
</script>

<FormModal
  icon={mdiAccountGroup}
  title={group ? $t('edit_group') : $t('create_group')}
  submitText={group ? $t('save') : $t('create')}
  cancelText={$t('cancel')}
  {onSubmit}
  disabled={!name.trim()}
  {onClose}
>
  <div class="flex flex-col gap-4 m-4">
    <Field label={$t('name')} required>
      <Input bind:value={name} autofocus maxlength={100} />
    </Field>

    <Field label={$t('color')}>
      {#if color}
        <div class="flex items-center gap-2">
          <ColorPicker value={color} onchange={(c) => (color = c)} />
          <button
            type="button"
            class="text-xs text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
            onclick={() => (color = null)}
          >
            {$t('clear')}
          </button>
        </div>
      {:else}
        <div class="flex items-center gap-2">
          <button
            type="button"
            class="text-xs text-immich-primary hover:underline"
            onclick={() => (color = UserAvatarColor.Primary)}
          >
            {$t('add')}
          </button>
        </div>
      {/if}
    </Field>

    <div>
      <label class="text-sm font-medium text-immich-fg dark:text-immich-dark-fg">{$t('members')}</label>
      {#if selectedUsers.size > 0}
        <div class="mt-1 mb-2 flex flex-wrap gap-1">
          {#each [...selectedUsers.values()] as user (user.id)}
            <button
              type="button"
              class="flex items-center gap-1 rounded-full bg-gray-100 dark:bg-gray-700 px-2 py-0.5 text-xs"
              onclick={() => selectedUsers.delete(user.id)}
            >
              {user.name}
              <span class="text-gray-400">&times;</span>
            </button>
          {/each}
        </div>
      {/if}

      <input
        type="text"
        class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-800 dark:text-white"
        placeholder={$t('search')}
        bind:value={search}
      />
    </div>

    {#if loading}
      <div class="w-full flex place-items-center place-content-center p-4">
        <LoadingSpinner />
      </div>
    {:else}
      <div class="max-h-64 overflow-y-auto">
        <Stack>
          {#each filteredUsers as user (user.id)}
            <ListButton selected={selectedUsers.has(user.id)} onclick={() => handleToggle(user)}>
              <UserAvatar {user} size="md" />
              <div class="text-start grow">
                <Text fontWeight="medium">{user.name}</Text>
                <Text size="tiny" color="muted">{user.email}</Text>
              </div>
            </ListButton>
          {:else}
            <Text class="py-4">{$t('no_results')}</Text>
          {/each}
        </Stack>
      </div>
    {/if}
  </div>
</FormModal>
