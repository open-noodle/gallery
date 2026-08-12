<script lang="ts">
  import UserAvatar from '$lib/components/shared-components/UserAvatar.svelte';
  import SpaceCollage from '$lib/components/spaces/space-collage.svelte';
  import { Route } from '$lib/route';
  import { UserAvatarColor, type SharedSpaceResponseDto } from '@immich/sdk';
  import { mdiDotsVertical, mdiPin, mdiPinOff } from '@mdi/js';
  import { Icon } from '@immich/ui';
  import { t } from 'svelte-i18n';

  interface Props {
    space: SharedSpaceResponseDto;
    preload?: boolean;
    isPinned?: boolean;
    onTogglePin?: (id: string) => void;
  }

  let { space, preload = false, isPinned = false, onTogglePin = () => {} }: Props = $props();

  let showMenu = $state(false);
  let showDropdown = $state(false);

  const MAX_AVATARS = 4;

  const gradientClasses: Record<string, string> = {
    [UserAvatarColor.Primary]: 'from-immich-primary/60 to-immich-primary',
    [UserAvatarColor.Pink]: 'from-pink-300 to-pink-500',
    [UserAvatarColor.Red]: 'from-red-400 to-red-600',
    [UserAvatarColor.Yellow]: 'from-yellow-300 to-yellow-500',
    [UserAvatarColor.Blue]: 'from-blue-400 to-blue-600',
    [UserAvatarColor.Green]: 'from-green-400 to-green-700',
    [UserAvatarColor.Purple]: 'from-purple-400 to-purple-700',
    [UserAvatarColor.Orange]: 'from-orange-400 to-orange-600',
    [UserAvatarColor.Gray]: 'from-gray-400 to-gray-600',
    [UserAvatarColor.Amber]: 'from-amber-400 to-amber-600',
  };

  let gradientClass = $derived(gradientClasses[space.color ?? 'primary'] ?? gradientClasses[UserAvatarColor.Primary]);

  let collageAssets = $derived(
    (space.recentAssetIds ?? []).map((id, i) => ({
      id,
      thumbhash: space.recentAssetThumbhashes?.[i] ?? null,
    })),
  );
  let visibleMembers = $derived((space.members ?? []).slice(0, MAX_AVATARS));
  let overflowCount = $derived(Math.max(0, (space.members ?? []).length - MAX_AVATARS));

  let hasActivity = $derived((space.newAssetCount ?? 0) > 0);
  let activityText = $derived.by(() => {
    const count = space.newAssetCount ?? 0;
    const displayCount = count > 99 ? '99+' : String(count);
    if (space.lastContributor) {
      return $t('spaces_card_contributor_new', {
        values: { name: space.lastContributor.name, count: displayCount },
      });
    }
    return $t('spaces_card_new_photos', { values: { count: displayCount } });
  });
</script>

<a
  href={Route.viewSpace({ id: space.id })}
  class="group relative rounded-2xl border border-transparent p-5 hover:border-gray-200 hover:bg-gray-100 dark:hover:border-gray-800 dark:hover:bg-gray-900"
  data-testid="space-card"
  onmouseenter={() => (showMenu = true)}
  onmouseleave={() => {
    showMenu = false;
    showDropdown = false;
  }}
>
  <div class="relative">
    <SpaceCollage assets={collageAssets} {gradientClass} {preload} />

    {#if isPinned}
      <div
        class="absolute inset-s-2 top-2 z-10 rounded-full bg-white/70 p-1 dark:bg-gray-800/70"
        data-testid="pin-overlay"
      >
        <Icon icon={mdiPin} size="14" class="text-gray-600 dark:text-gray-400" />
      </div>
    {/if}

    {#if showMenu}
      <button
        type="button"
        class="absolute inset-e-2 top-2 z-20 rounded-full bg-white/80 p-1 shadow-sm hover:bg-white dark:bg-gray-800/80 dark:hover:bg-gray-800"
        onclick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          showDropdown = !showDropdown;
        }}
        data-testid="space-menu-button"
      >
        <Icon icon={mdiDotsVertical} size="18" />
      </button>
    {/if}

    {#if showDropdown}
      <div
        class="absolute inset-e-2 top-10 z-30 min-w-[140px] rounded-lg border bg-white shadow-lg dark:border-gray-700 dark:bg-gray-900"
      >
        <button
          type="button"
          class="flex w-full items-center gap-2 px-3 py-2 text-sm hover:bg-gray-100 dark:hover:bg-gray-800"
          onclick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onTogglePin(space.id);
            showDropdown = false;
          }}
        >
          <Icon icon={isPinned ? mdiPinOff : mdiPin} size="16" />
          {isPinned ? $t('spaces_unpin') : $t('spaces_pin_to_top')}
        </button>
      </div>
    {/if}

    {#if hasActivity}
      <div data-testid="activity-dot" class="absolute -top-1 -right-1 z-10 size-2 rounded-full bg-immich-primary">
        <div class="absolute inset-0 animate-ping rounded-full bg-immich-primary opacity-40"></div>
      </div>
    {/if}

    {#if visibleMembers.length > 0}
      <div class="absolute inset-e-2 bottom-2 flex items-center">
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
            class="-ms-1.5 flex size-7 items-center justify-center rounded-full bg-gray-500 text-xs font-medium text-white shadow-md"
          >
            +{overflowCount}
          </div>
        {/if}
      </div>
    {/if}
  </div>

  <div class="mt-4">
    <p
      class="line-clamp-2 w-full text-lg/6 font-semibold text-black group-hover:text-primary dark:text-white"
      data-testid="space-name"
      title={space.name}
    >
      {space.name}
    </p>

    {#if hasActivity}
      <p data-testid="activity-line" class="truncate text-xs font-medium text-immich-primary">
        {activityText}
      </p>
    {/if}

    <span class="flex gap-2 text-sm dark:text-immich-dark-fg" data-testid="space-details">
      {#if space.assetCount !== undefined}
        <p>{space.assetCount} {$t('photos')}</p>
      {/if}
      {#if space.assetCount !== undefined && space.memberCount !== undefined}
        <p>&middot;</p>
      {/if}
      {#if space.memberCount !== undefined}
        <p>{space.memberCount} {$t('members')}</p>
      {/if}
    </span>
  </div>
</a>
