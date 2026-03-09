<script lang="ts">
  import AssetCover from '$lib/components/sharedlinks-page/covers/asset-cover.svelte';
  import UserAvatar from '$lib/components/shared-components/user-avatar.svelte';
  import { Route } from '$lib/route';
  import { getAssetMediaUrl } from '$lib/utils';
  import type { SharedSpaceResponseDto, UserAvatarColor } from '@immich/sdk';
  import { Icon } from '@immich/ui';
  import { mdiImageMultipleOutline } from '@mdi/js';
  import { t } from 'svelte-i18n';

  interface Props {
    space: SharedSpaceResponseDto;
    preload?: boolean;
  }

  let { space, preload = false }: Props = $props();

  const MAX_AVATARS = 4;

  let thumbnailUrl = $derived(space.thumbnailAssetId ? getAssetMediaUrl({ id: space.thumbnailAssetId }) : null);
  let visibleMembers = $derived((space.members ?? []).slice(0, MAX_AVATARS));
  let overflowCount = $derived(Math.max(0, (space.members ?? []).length - MAX_AVATARS));
</script>

<a
  href={Route.viewSpace({ id: space.id })}
  class="group relative rounded-2xl border border-transparent p-5 hover:bg-gray-100 hover:border-gray-200 dark:hover:border-gray-800 dark:hover:bg-gray-900"
  data-testid="space-card"
>
  <div class="relative">
    {#if thumbnailUrl}
      <AssetCover alt={space.name} class="transition-all duration-300 hover:shadow-lg" src={thumbnailUrl} {preload} />
    {:else}
      <div
        class="flex size-full items-center justify-center rounded-xl bg-gray-100 aspect-square dark:bg-gray-800"
        data-testid="space-no-cover"
      >
        <Icon icon={mdiImageMultipleOutline} size="4em" class="text-gray-300 dark:text-gray-600" />
      </div>
    {/if}

    {#if visibleMembers.length > 0}
      <div class="absolute bottom-2 end-2 flex items-center">
        {#each visibleMembers as member (member.userId)}
          <div class="-ms-1.5 first:ms-0">
            <UserAvatar
              user={{
                id: member.userId,
                name: member.name,
                email: member.email,
                profileImagePath: member.profileImagePath ?? '',
                avatarColor: (member.avatarColor ?? 'primary') as UserAvatarColor,
                profileChangedAt: member.profileChangedAt ?? '',
              }}
              size="sm"
              noTitle
            />
          </div>
        {/each}
        {#if overflowCount > 0}
          <div
            class="-ms-1.5 flex h-7 w-7 items-center justify-center rounded-full bg-gray-500 text-xs font-medium text-white shadow-md"
          >
            +{overflowCount}
          </div>
        {/if}
      </div>
    {/if}
  </div>

  <div class="mt-4">
    <p
      class="w-full leading-6 text-lg line-clamp-2 font-semibold text-black dark:text-white group-hover:text-primary"
      data-testid="space-name"
      title={space.name}
    >
      {space.name}
    </p>

    <span class="flex gap-2 text-sm dark:text-immich-dark-fg" data-testid="space-details">
      {#if space.assetCount != null}
        <p>{space.assetCount} {$t('photos')}</p>
      {/if}
      {#if space.assetCount != null && space.memberCount != null}
        <p>&middot;</p>
      {/if}
      {#if space.memberCount != null}
        <p>{space.memberCount} {$t('members')}</p>
      {/if}
    </span>
  </div>
</a>
