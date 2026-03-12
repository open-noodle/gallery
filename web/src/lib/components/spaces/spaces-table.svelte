<script lang="ts">
  import RoleBadge from '$lib/components/spaces/role-badge.svelte';
  import SpaceCollage from '$lib/components/spaces/space-collage.svelte';
  import { Route } from '$lib/route';
  import { formatTimeAgo } from '$lib/utils/timesince';
  import type { SharedSpaceResponseDto } from '@immich/sdk';
  import { t } from 'svelte-i18n';

  interface Props {
    spaces: SharedSpaceResponseDto[];
    currentUserId: string;
    pinnedIds?: string[];
    onTogglePin?: (id: string) => void;
  }

  let { spaces, currentUserId, pinnedIds = [], onTogglePin = () => {} }: Props = $props();

  const gradientClasses: Record<string, string> = {
    primary: 'from-immich-primary/60 to-immich-primary',
    pink: 'from-pink-300 to-pink-500',
    red: 'from-red-400 to-red-600',
    yellow: 'from-yellow-300 to-yellow-500',
    blue: 'from-blue-400 to-blue-600',
    green: 'from-green-400 to-green-700',
    purple: 'from-purple-400 to-purple-700',
    orange: 'from-orange-400 to-orange-600',
    gray: 'from-gray-400 to-gray-600',
    amber: 'from-amber-400 to-amber-600',
  };

  const colorBarClasses: Record<string, string> = {
    primary: 'bg-immich-primary',
    pink: 'bg-pink-400',
    red: 'bg-red-500',
    yellow: 'bg-yellow-500',
    blue: 'bg-blue-500',
    green: 'bg-green-600',
    purple: 'bg-purple-600',
    orange: 'bg-orange-600',
    gray: 'bg-gray-600',
    amber: 'bg-amber-600',
  };

  const newBadgeClasses: Record<string, string> = {
    primary: 'bg-immich-primary text-white',
    pink: 'bg-pink-400 text-white',
    red: 'bg-red-500 text-white',
    yellow: 'bg-yellow-500 text-white',
    blue: 'bg-blue-500 text-white',
    green: 'bg-green-600 text-white',
    purple: 'bg-purple-600 text-white',
    orange: 'bg-orange-600 text-white',
    gray: 'bg-gray-600 text-white',
    amber: 'bg-amber-600 text-white',
  };

  const getGradientClass = (color: string | null | undefined) =>
    gradientClasses[color ?? 'primary'] ?? gradientClasses['primary'];

  const getColorBarClass = (color: string | null | undefined) =>
    colorBarClasses[color ?? 'primary'] ?? colorBarClasses['primary'];

  const getNewBadgeClass = (color: string | null | undefined) =>
    newBadgeClasses[color ?? 'primary'] ?? newBadgeClasses['primary'];

  const getCollageAssets = (space: SharedSpaceResponseDto) =>
    (space.recentAssetIds ?? []).map((id, i) => ({
      id,
      thumbhash: space.recentAssetThumbhashes?.[i] ?? null,
    }));

  const getCurrentUserRole = (space: SharedSpaceResponseDto) => {
    const member = (space.members ?? []).find((m) => m.userId === currentUserId);
    return member?.role ?? null;
  };
</script>

<div class="overflow-x-auto">
  <table class="w-full text-sm">
    <thead>
      <tr class="border-b border-gray-200 text-left text-xs font-medium uppercase tracking-wider text-gray-500 dark:border-gray-700 dark:text-gray-400">
        <th class="w-1 pb-2 pr-3"></th>
        <th class="pb-2 pr-4">{$t('name')}</th>
        <th class="pb-2 pr-4">{$t('role')}</th>
        <th class="pb-2 pr-4">{$t('photos')}</th>
        <th class="pb-2 pr-4">{$t('members')}</th>
        <th class="pb-2 pr-4">{$t('new')}</th>
        <th class="pb-2">{$t('last_activity')}</th>
      </tr>
    </thead>
    <tbody>
      {#each spaces as space (space.id)}
        {@const collageAssets = getCollageAssets(space)}
        {@const gradientClass = getGradientClass(space.color)}
        {@const colorBarClass = getColorBarClass(space.color)}
        {@const newBadgeClass = getNewBadgeClass(space.color)}
        {@const currentRole = getCurrentUserRole(space)}
        {@const newCount = space.newAssetCount ?? 0}
        <tr
          class="border-b border-gray-100 hover:bg-gray-50 dark:border-gray-800 dark:hover:bg-gray-900"
          data-testid="space-row"
        >
          <!-- Color bar cell -->
          <td class="py-3 pr-3">
            <div
              class="h-8 w-[3px] rounded-full {colorBarClass}"
              data-testid="color-bar-{space.id}"
            ></div>
          </td>

          <!-- Name cell with collage thumbnail -->
          <td class="py-3 pr-4">
            <a
              href={Route.viewSpace({ id: space.id })}
              class="flex items-center gap-3 font-medium text-black hover:text-immich-primary dark:text-white dark:hover:text-immich-primary"
            >
              <div class="h-8 w-8 shrink-0">
                <SpaceCollage assets={collageAssets} {gradientClass} />
              </div>
              <span>{space.name}</span>
            </a>
          </td>

          <!-- Role cell -->
          <td class="py-3 pr-4">
            {#if currentRole}
              <RoleBadge role={currentRole} spaceColor={space.color} size="sm" />
            {/if}
          </td>

          <!-- Asset count cell -->
          <td class="py-3 pr-4 text-gray-600 dark:text-gray-400">
            {space.assetCount ?? 0}
          </td>

          <!-- Member count cell -->
          <td class="py-3 pr-4 text-gray-600 dark:text-gray-400">
            {space.memberCount ?? 0}
          </td>

          <!-- New assets cell -->
          <td class="py-3 pr-4" data-testid="new-cell-{space.id}">
            {#if newCount > 0}
              <span
                class="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium {newBadgeClass}"
                data-testid="new-badge-{space.id}"
              >
                {newCount > 99 ? '99+' : newCount}
              </span>
            {:else}
              <span class="text-gray-400">—</span>
            {/if}
          </td>

          <!-- Last activity cell -->
          <td class="py-3 text-gray-600 dark:text-gray-400">
            {#if space.lastActivityAt}
              {formatTimeAgo(space.lastActivityAt)}
            {:else}
              <span class="text-gray-400">—</span>
            {/if}
          </td>
        </tr>
      {/each}
    </tbody>
  </table>
</div>
