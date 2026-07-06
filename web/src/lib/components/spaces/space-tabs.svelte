<script lang="ts">
  import { page } from '$app/state';
  import { QueryParameter } from '$lib/constants';
  import { t } from 'svelte-i18n';

  interface Props {
    spaceId: string;
    faceRecognitionEnabled?: boolean;
    photoCount?: number;
    albumCount?: number;
    memberCount?: number;
    isAdmin?: boolean;
    libraryCount?: number;
  }

  let {
    spaceId,
    faceRecognitionEnabled = false,
    photoCount = 0,
    albumCount = 0,
    memberCount = 0,
    isAdmin = false,
    libraryCount = 0,
  }: Props = $props();

  const base = $derived(`/spaces/${spaceId}`);
  const path = $derived(page.url.pathname);

  interface Tab {
    key: string;
    label: string;
    href: string;
    badge?: number;
    external?: boolean;
    active: boolean;
  }

  // Photos owns the index + the optional `/photos[/assetId]` segment.
  const photosActive = $derived(path === base || path.startsWith(`${base}/photos`));

  const tabs = $derived<Tab[]>(
    (
      [
        { key: 'photos', label: $t('photos'), href: base, badge: photoCount, active: photosActive },
        faceRecognitionEnabled
          ? {
              key: 'people',
              label: $t('people'),
              href: `${base}/people`,
              active: path.startsWith(`${base}/people`),
            }
          : undefined,
        {
          key: 'albums',
          label: $t('albums'),
          href: `${base}/albums`,
          badge: albumCount,
          active: path.startsWith(`${base}/albums`),
        },
        // External libraries are admin-only, so the tab is too.
        isAdmin
          ? {
              key: 'libraries',
              label: $t('spaces_libraries'),
              href: `${base}/libraries`,
              badge: libraryCount,
              active: path.startsWith(`${base}/libraries`),
            }
          : undefined,
        {
          key: 'map',
          label: $t('map'),
          href: `/map?${QueryParameter.SPACE_ID}=${spaceId}`,
          external: true,
          active: false,
        },
        {
          key: 'members',
          label: $t('members'),
          href: `${base}/members`,
          badge: memberCount,
          active: path.startsWith(`${base}/members`),
        },
        {
          key: 'activity',
          label: $t('spaces_activity'),
          href: `${base}/activity`,
          active: path.startsWith(`${base}/activity`),
        },
      ] as (Tab | undefined)[]
    ).filter((tab): tab is Tab => tab !== undefined),
  );
</script>

<nav
  class="flex gap-1 overflow-x-auto border-b border-gray-200 px-4 dark:border-gray-800"
  aria-label={$t('spaces')}
  data-testid="space-tabs"
>
  {#each tabs as tab (tab.key)}
    <a
      href={tab.href}
      data-testid="space-tab-{tab.key}"
      data-sveltekit-preload-data={tab.external ? 'off' : undefined}
      aria-current={tab.active ? 'page' : undefined}
      class="flex shrink-0 items-center gap-1.5 border-b-2 p-3 text-sm font-medium transition-colors
        {tab.active
        ? 'border-primary text-primary'
        : 'border-transparent text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-100'}"
    >
      {tab.label}
      {#if tab.badge && tab.badge > 0}
        <span class="rounded-full bg-gray-200 px-1.5 py-0.5 text-xs text-gray-600 dark:bg-gray-700 dark:text-gray-300">
          {tab.badge}
        </span>
      {/if}
    </a>
  {/each}
</nav>
