<script lang="ts">
  import { page } from '$app/state';
  import { sidebarModeStore } from '$lib/stores/sidebar-mode.svelte';
  // @immich/ui re-exports its types (dist/index.d.ts: `export * from './types.js'`),
  // so IconLike / IconProps come from the package rather than being redeclared here.
  import { Icon, Link, type IconLike, type IconProps } from '@immich/ui';
  import { mdiChevronDown, mdiChevronRight } from '@mdi/js';
  import type { Snippet } from 'svelte';
  import { t } from 'svelte-i18n';

  interface Props {
    title: string;
    href: string;
    icon?: IconLike | IconProps;
    activeIcon?: IconLike | IconProps;
    isActive?: () => boolean;
    expanded?: boolean;
    items?: Snippet;
  }

  let { title, href, icon, activeIcon, isActive, expanded = $bindable(false), items }: Props = $props();

  // Rail collapses to icons only; hovering or focusing floats the labels back without
  // touching the grid column, so `collapsed` follows hoverExpanded too.
  const collapsed = $derived(sidebarModeStore.layout === 'rail' && !sidebarModeStore.railExpanded);

  const active = $derived(isActive ? isActive() : page.url.pathname.startsWith(href));

  const asIconProps = (value?: IconLike | IconProps) => {
    if (typeof value === 'string') {
      return { icon: value };
    }
    if (value && 'path' in value) {
      return { icon: value.path };
    }
    return value;
  };

  const iconProps = $derived(asIconProps(icon));
  const activeIconProps = $derived(asIconProps(activeIcon));

  // `bg-primary/10` cannot go through Svelte's `class:` directive - the slash is not a
  // valid identifier there - so the active tint is composed into the class string.
  const linkClass = $derived(
    [
      'hover:bg-subtle hover:text-primary flex place-items-center gap-4 rounded-e-full py-3 transition-[padding,margin,width] delay-100 duration-100',
      // Collapsed the row is a 3rem indicator inset 1rem, matching the navigation rail Google
      // Photos uses, rather than `w-full`. Full width made the highlight run flush to the rail's
      // start edge with the scrollbar gutter's width left over at the end - visibly lopsided,
      // because the panel's content box is not centred when the gutter is reserved at one end.
      // Sizing the indicator itself sidesteps the content box entirely.
      //
      // Expanded the pill is inset 0.75rem at both ends, the same inset Google Photos uses at the
      // same 16rem sidebar width. `w-full` ran it flush to the start edge, which is what made the
      // ends look mismatched. An explicit length rather than `w-auto`, because the width has to be
      // interpolable: the rail expands from a 3rem indicator, and `auto` would snap.
      collapsed ? 'ms-4 w-12' : 'mx-3 w-[calc(100%-1.5rem)]',
      // Centred with padding rather than `justify-center`, because `justify-content` cannot be
      // transitioned: switching it off on expand snapped the icon to the row's start and only
      // then did the padding animation carry it right, which read as the icon popping in from
      // the far left. Both states are one length, so the icon simply glides between them.
      // A fixed length, not `calc(50% - 11px)`: a percentage is re-resolved against the panel
      // every frame, and the panel's own width is animating at the same time, so the icon
      // overshot to ~56px before settling.
      // In rem, not px: the rail is `w-20` (5rem), so a px padding only centres at a 16px root
      // font size and drifts for anyone who changed it. (3rem indicator - 1.375rem icon) / 2
      // centres the icon in the indicator, and `ms-4` centres the indicator in the rail, so the
      // icon lands on the rail's midpoint at any root size. `gap-4` stays in both states - it
      // sits after the icon so it cannot move it, and holding it constant removes another jump.
      // Expanded this is 0.75rem short of the icon's distance from the sidebar's edge, because the
      // pill now starts 0.75rem in: the padding is measured from the pill, not the panel, so it has
      // to shed exactly what the margin added or the icon and label would both slide right.
      collapsed ? 'ps-[0.8125rem]' : 'ps-7',
      active ? 'bg-primary/10 text-primary' : '',
    ]
      .filter(Boolean)
      .join(' '),
  );
</script>

<div>
  <div class="relative flex items-center">
    <!-- Ported from upstream NavbarItem: the sub-tree collapse/expand control. Hidden
         in rail mode - the sub-tree itself is hidden there too (see below), and there is
         nothing to toggle when the label isn't visible. -->
    {#if items && !collapsed}
      <button
        type="button"
        aria-label={expanded ? $t('collapse') : $t('expand')}
        class="absolute inset-s-3 hidden h-full rounded-lg px-0.5 hover:bg-subtle hover:text-primary md:block"
        onclick={() => (expanded = !expanded)}
      >
        <!-- Inset and sized to match the space rows' own chevrons: with no start inset this sat
             ~11px from the sidebar's edge against their ~21px, and 1em read too faint beside a
             1.375em icon. The inset tracks the pill's own 0.75rem margin, so the caret starts
             where the pill does rather than overhanging its rounded start cap. -->
        <Icon
          icon={expanded ? mdiChevronDown : mdiChevronRight}
          size="1.25em"
          class="shrink-0 delay-100 duration-100"
          aria-hidden={true}
        />
      </button>
    {/if}

    <!-- Link, not a raw <a>: it carries @immich/ui's shared link treatment and SvelteKit
         integration, matching what upstream NavbarItem renders. -->
    <Link
      {href}
      underline={false}
      data-active={String(active)}
      data-collapsed={String(collapsed)}
      title={collapsed ? title : undefined}
      aria-current={active ? 'page' : undefined}
      class={linkClass}
    >
      {#if iconProps}
        <Icon
          size="1.375em"
          class="shrink-0"
          aria-hidden={true}
          {...active && activeIconProps ? activeIconProps : iconProps}
        />
      {/if}
      <!--
        The label stays mounted in rail mode - collapsing it with width/opacity rather than
        unmounting keeps the link's accessible name and makes rail <-> expanded a pure CSS
        transition instead of a component swap needing a cross-fade.
      -->
      <span
        class="truncate text-sm font-medium transition-all duration-200 motion-reduce:transition-none"
        class:w-0={collapsed}
        class:opacity-0={collapsed}
      >
        {title}
      </span>
    </Link>
  </div>

  <!-- Rendered in the rail too, not just when expanded: the sub-tree's rows are what keep the
       rail and the sidebar on the same vertical rhythm. Dropping them made every row below an
       expanded Spaces/Albums jump on hover. The rows collapse to their own thumbnails - see
       recent-spaces / RecentAlbums - which is how Google Photos' rail shows them. -->
  {#if items && expanded}
    <div>{@render items()}</div>
  {/if}
</div>
