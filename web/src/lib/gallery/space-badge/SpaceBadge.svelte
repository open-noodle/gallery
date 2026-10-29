<script lang="ts">
  import { page } from '$app/state';
  import { locale } from '$lib/stores/preferences.store';
  import { UserAvatarColor } from '@immich/sdk';
  import { Icon } from '@immich/ui';
  import { mdiAccountGroup } from '@mdi/js';
  import { spaceBadges } from './space-badges.svelte';

  interface Props {
    assetId: string;
    /** Off for thumbnails without selection, such as the viewer's stack strip. */
    enabled?: boolean;
    /** The selection check has the corner. */
    covered?: boolean;
  }

  let { assetId, enabled = true, covered = false }: Props = $props();

  // The light end of each space card's gradient (space-card.svelte), which reads on a photo with the shadow; a light
  // indigo for the default colour, whose light end is see-through.
  const colorClasses: Record<string, string> = {
    [UserAvatarColor.Primary]: 'text-indigo-400',
    [UserAvatarColor.Pink]: 'text-pink-300',
    [UserAvatarColor.Red]: 'text-red-400',
    [UserAvatarColor.Yellow]: 'text-yellow-300',
    [UserAvatarColor.Blue]: 'text-blue-400',
    [UserAvatarColor.Green]: 'text-green-400',
    [UserAvatarColor.Purple]: 'text-purple-400',
    [UserAvatarColor.Orange]: 'text-orange-400',
    [UserAvatarColor.Gray]: 'text-gray-400',
    [UserAvatarColor.Amber]: 'text-amber-400',
  };

  // A space's own pages, map and search would mark every thumbnail; the trash and the locked folder are out of the
  // spaces, and a shared link has none. Literal routes: the navigation helpers are mocked away in upstream specs.
  const routesWithout = [
    '/(user)/spaces/[spaceId]',
    '/(user)/trash',
    '/(user)/locked',
    '/(user)/share/[key]',
    '/(user)/s/[slug]',
  ];

  const active = $derived(
    enabled &&
      routesWithout.every((route) => !page.route?.id?.startsWith(route)) &&
      !page.url?.searchParams.has('spaceId'),
  );

  $effect(() => {
    if (active) {
      spaceBadges.request(assetId);
    }
  });

  const spaces = $derived(active ? spaceBadges.spacesOf(assetId) : undefined);
</script>

{#if spaces?.length && !covered}
  <!-- Drawn like the thumbnail's other marks, an icon on the photo, slightly see-through and with a thin shadow. -->
  <div
    class="pointer-events-none absolute inset-s-2 top-2 z-2 flex items-center gap-1 text-xs font-semibold opacity-90 filter-[drop-shadow(0_0_1px_rgb(0_0_0/0.8))_drop-shadow(0_1px_2px_rgb(0_0_0/0.5))]"
    aria-hidden="true"
    data-space-badge
  >
    {#if spaces.length === 1}
      <Icon
        icon={mdiAccountGroup}
        size="20"
        class={colorClasses[spaces[0].color ?? UserAvatarColor.Primary] ?? colorClasses[UserAvatarColor.Primary]}
      />
    {:else}
      <!-- Several spaces have several colours: white, as the other marks. -->
      <Icon icon={mdiAccountGroup} size="20" class="text-white" />
      <span class="text-white">{spaces.length.toLocaleString($locale)}</span>
    {/if}
  </div>
{/if}
