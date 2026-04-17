<script lang="ts">
  import { goto } from '$app/navigation';
  import UserAvatar from '$lib/components/shared-components/user-avatar.svelte';
  import SpaceCollage from '$lib/components/spaces/space-collage.svelte';
  import { Route } from '$lib/route';
  import { UserAvatarColor, type SharedSpaceResponseDto } from '@immich/sdk';
  import { Button, Icon } from '@immich/ui';
  import { mdiAccountMultipleOutline } from '@mdi/js';
  import { t } from 'svelte-i18n';

  interface Props {
    item: SharedSpaceResponseDto;
  }
  let { item }: Props = $props();

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

  const gradientClass = $derived(
    gradientClasses[item.color ?? UserAvatarColor.Primary] ?? gradientClasses[UserAvatarColor.Primary],
  );

  const collageAssets = $derived(
    (item.recentAssetIds ?? []).map((id, i) => ({
      id,
      thumbhash: item.recentAssetThumbhashes?.[i] ?? null,
    })),
  );

  const visibleMembers = $derived((item.members ?? []).slice(0, MAX_AVATARS));
  const overflowCount = $derived(Math.max(0, (item.members ?? []).length - MAX_AVATARS));

  const assetCount = $derived(item.assetCount ?? 0);
  const photoLabel = $derived($t('cmdk_preview_photo_count', { values: { count: assetCount } }));
  const memberCount = $derived(item.memberCount ?? 0);
  const memberLabel = $derived($t('cmdk_preview_member_count', { values: { count: memberCount } }));
  const metadataLine = $derived(`${photoLabel} · ${memberLabel}`);
</script>

<div data-cmdk-preview-space class="flex flex-col gap-3 p-5">
  <div class="w-full">
    {#if collageAssets.length > 0}
      <SpaceCollage assets={collageAssets} {gradientClass} />
    {:else}
      <div
        data-testid="space-preview-gradient"
        class="flex aspect-square w-full items-center justify-center rounded-xl bg-gradient-to-br {gradientClass}"
        aria-hidden="true"
      >
        <Icon icon={mdiAccountMultipleOutline} size="4em" class="text-white/40" />
      </div>
    {/if}
  </div>

  <div class="min-w-0">
    <div class="truncate text-sm font-medium">{item.name}</div>
    <div class="truncate text-xs font-normal text-gray-500 dark:text-gray-400">{metadataLine}</div>
  </div>

  {#if visibleMembers.length > 0}
    <div class="flex items-center">
      {#each visibleMembers as member (member.userId)}
        <div class="-ms-1.5 first:ms-0" data-testid="member-avatar">
          <UserAvatar
            user={{
              id: member.userId,
              name: member.name,
              email: member.email ?? '',
              profileImagePath: member.profileImagePath ?? '',
              avatarColor: (member.avatarColor ?? UserAvatarColor.Primary) as UserAvatarColor,
              profileChangedAt: member.profileChangedAt ?? '',
            }}
            size="sm"
            noTitle
          />
        </div>
      {/each}
      {#if overflowCount > 0}
        <div
          data-testid="member-overflow"
          class="-ms-1.5 flex h-7 w-7 items-center justify-center rounded-full bg-gray-500 text-xs font-medium text-white shadow-md"
        >
          +{overflowCount}
        </div>
      {/if}
    </div>
  {/if}

  <div class="flex gap-2">
    <Button variant="ghost" size="small" onclick={() => goto(Route.viewSpace({ id: item.id }))}
      >{$t('cmdk_open')}</Button
    >
  </div>
</div>
