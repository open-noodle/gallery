<script lang="ts">
  import { initInput } from '$lib/actions/focus';
  import { authManager } from '$lib/managers/auth-manager.svelte';
  import { handleError } from '$lib/utils/handle-error';
  import { getAllSpaces, SharedSpaceRole, UserAvatarColor, type SharedSpaceResponseDto } from '@immich/sdk';
  import { Icon, Modal, ModalBody } from '@immich/ui';
  import { mdiAccountGroup } from '@mdi/js';
  import { onMount } from 'svelte';
  import { t } from 'svelte-i18n';

  type Props = {
    onClose: (space?: SharedSpaceResponseDto) => void;
    /** The spaces to offer; without them, every space the user can write to, from the server. */
    spaces?: SharedSpaceResponseDto[];
    /** A count to show on each space's row, in place of the user's role. */
    counts?: Record<string, number>;
    title?: string;
  };

  const { onClose, spaces: givenSpaces, counts, title }: Props = $props();

  let spaces = $state<SharedSpaceResponseDto[]>(givenSpaces ?? []);
  let loading = $state(!givenSpaces);
  let search = $state('');
  let selectedRowIndex = $state(0);

  const currentUserId = $derived(authManager.authenticated ? (authManager.user?.id ?? null) : null);
  const writableSpaces = $derived(spaces.filter((space) => canWrite(space)));
  const filteredSpaces = $derived(
    writableSpaces.filter((space) => space.name.toLowerCase().includes(search.trim().toLowerCase())),
  );

  onMount(async () => {
    if (givenSpaces) {
      return;
    }
    try {
      spaces = await getAllSpaces();
    } catch (error) {
      handleError(error, $t('failed_to_load_spaces'));
      spaces = [];
    } finally {
      loading = false;
    }
  });

  $effect(() => {
    if (filteredSpaces.length === 0) {
      selectedRowIndex = 0;
      return;
    }
    if (selectedRowIndex >= filteredSpaces.length) {
      selectedRowIndex = filteredSpaces.length - 1;
    }
  });

  // The dark end of each space card's gradient (space-card.svelte), which reads on the modal's background.
  const colorClasses: Record<string, string> = {
    [UserAvatarColor.Primary]: 'text-immich-primary dark:text-immich-dark-primary',
    [UserAvatarColor.Pink]: 'text-pink-500',
    [UserAvatarColor.Red]: 'text-red-600',
    [UserAvatarColor.Yellow]: 'text-yellow-500',
    [UserAvatarColor.Blue]: 'text-blue-600',
    [UserAvatarColor.Green]: 'text-green-700',
    [UserAvatarColor.Purple]: 'text-purple-700',
    [UserAvatarColor.Orange]: 'text-orange-600',
    [UserAvatarColor.Gray]: 'text-gray-600',
    [UserAvatarColor.Amber]: 'text-amber-600',
  };

  const getCurrentUserRole = (space: SharedSpaceResponseDto) => {
    if (space.createdById === currentUserId) {
      return SharedSpaceRole.Owner;
    }
    return space.members?.find((member) => member.userId === currentUserId)?.role as SharedSpaceRole | undefined;
  };

  const canWrite = (space: SharedSpaceResponseDto) => {
    const role = getCurrentUserRole(space);
    return role === SharedSpaceRole.Owner || role === SharedSpaceRole.Editor;
  };

  const getRoleLabel = (space: SharedSpaceResponseDto) => {
    const role = getCurrentUserRole(space);
    return role === SharedSpaceRole.Editor ? $t('role_editor') : $t('owner');
  };

  const handleKeydown = (event: KeyboardEvent) => {
    switch (event.key) {
      case 'ArrowUp': {
        event.preventDefault();
        selectedRowIndex = selectedRowIndex > 0 ? selectedRowIndex - 1 : Math.max(filteredSpaces.length - 1, 0);
        break;
      }
      case 'ArrowDown': {
        event.preventDefault();
        selectedRowIndex = selectedRowIndex < filteredSpaces.length - 1 ? selectedRowIndex + 1 : 0;
        break;
      }
      case 'Enter': {
        event.preventDefault();
        const selected = filteredSpaces[selectedRowIndex];
        if (selected) {
          onClose(selected);
        }
        break;
      }
    }
  };
</script>

<Modal title={title ?? $t('add_to_space')} {onClose} size="small">
  <ModalBody>
    <div class="mb-2 flex max-h-100 flex-col">
      {#if loading}
        <div class="flex animate-pulse flex-col gap-3 px-6 py-4">
          <span class="h-5 w-40 rounded-sm bg-slate-200 dark:bg-slate-700"></span>
          <span class="h-5 w-56 rounded-sm bg-slate-200 dark:bg-slate-700"></span>
          <span class="h-5 w-48 rounded-sm bg-slate-200 dark:bg-slate-700"></span>
        </div>
      {:else}
        <input
          class="border-b-4 border-immich-bg px-6 py-2 text-2xl focus:border-immich-primary dark:border-immich-dark-gray dark:focus:border-immich-dark-primary"
          aria-label={$t('search')}
          placeholder={$t('search')}
          bind:value={search}
          onkeydown={handleKeydown}
          use:initInput
        />
        <div class="immich-scrollbar overflow-y-auto">
          {#if filteredSpaces.length === 0}
            <p class="p-6 text-sm text-gray-500 dark:text-gray-400">{$t('spaces_no_writable_spaces')}</p>
          {:else}
            {#each filteredSpaces as space, index (space.id)}
              <button
                type="button"
                class={[
                  'flex w-full items-center justify-between gap-4 px-6 py-3 text-left hover:bg-gray-100 dark:hover:bg-gray-800',
                  index === selectedRowIndex ? 'bg-gray-100 dark:bg-gray-800' : '',
                ].join(' ')}
                onclick={() => onClose(space)}
                onmouseenter={() => (selectedRowIndex = index)}
              >
                <span class="flex min-w-0 items-center gap-3">
                  {#if counts}
                    <span class="shrink-0" data-space-color>
                      <Icon
                        icon={mdiAccountGroup}
                        size="20"
                        class={colorClasses[space.color ?? UserAvatarColor.Primary] ??
                          colorClasses[UserAvatarColor.Primary]}
                      />
                    </span>
                  {/if}
                  <span class="truncate font-medium text-black dark:text-white">{space.name}</span>
                </span>
                <span class="shrink-0 text-xs text-gray-500 dark:text-gray-400">
                  {counts ? $t('items_count', { values: { count: counts[space.id] ?? 0 } }) : getRoleLabel(space)}
                </span>
              </button>
            {/each}
          {/if}
        </div>
      {/if}
    </div>
  </ModalBody>
</Modal>
