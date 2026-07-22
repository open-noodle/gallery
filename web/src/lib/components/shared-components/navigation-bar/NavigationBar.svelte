<script lang="ts" module>
  export const menuButtonId = 'top-menu-button';
</script>

<script lang="ts">
  import { page } from '$app/state';
  import { clickOutside } from '$lib/actions/click-outside';
  import GlobalSearchInputTrigger from '$lib/components/global-search/global-search-input-trigger.svelte';
  import NotificationPanel from '$lib/components/shared-components/navigation-bar/NotificationPanel.svelte';
  import SkipLink from '$lib/elements/SkipLink.svelte';
  import { authManager } from '$lib/managers/auth-manager.svelte';
  import { globalSearchManager } from '$lib/managers/global-search-manager.svelte';
  import { Route } from '$lib/route';
  import { getGlobalActions } from '$lib/services/app.service';
  import { mediaQueryManager } from '$lib/stores/media-query-manager.svelte';
  import { notificationManager } from '$lib/stores/notification-manager.svelte';
  import { sidebarModeStore } from '$lib/stores/sidebar-mode.svelte';
  import { sidebarStore } from '$lib/stores/sidebar.svelte';
  import { ActionButton, Button, IconButton } from '@immich/ui';
  import Logo from '$lib/components/shared-components/Logo.svelte';
  import { mdiBellBadge, mdiBellOutline, mdiMagnify, mdiMenu, mdiTrayArrowUp } from '@mdi/js';
  import { onMount } from 'svelte';
  import { t } from 'svelte-i18n';
  import ThemeButton from '../ThemeButton.svelte';
  import UserAvatar from '../UserAvatar.svelte';
  import AccountInfoPanel from './AccountInfoPanel.svelte';

  type Props = {
    onUploadClick?: () => void;
    // TODO: remove once this is only used in <AppShellHeader>
    noBorder?: boolean;
    /**
     * Opt-in: size the hamburger/column/logo from `sidebarModeStore.layout` (adds the rail
     * state). Defaults to false so callers with no rail-width sidebar of their own - namely
     * AdminPageLayout, whose sidebar is bound only to `sidebarStore.isOpen` and pinned open
     * above 850px regardless of `railOverlayOpen` - keep today's viewport-only behaviour
     * (hamburger hidden, logo inline, wide column) untouched above 850px.
     */
    railAware?: boolean;
  };

  let { onUploadClick, noBorder = false, railAware = false }: Props = $props();

  let shouldShowAccountInfoPanel = $state(false);
  let shouldShowNotificationPanel = $state(false);
  let innerWidth: number = $state(0);
  const hasUnreadNotifications = $derived(notificationManager.notifications.length > 0);

  onMount(async () => {
    try {
      await notificationManager.refresh();
    } catch (error) {
      console.error('Failed to load notifications on mount', error);
    }
  });

  const { Cast } = $derived(getGlobalActions($t));

  // Without `railAware`, fall back to the pre-rail, viewport-only check: no rail state
  // exists, and "expanded" just means "at/above the 850px sidebar breakpoint" - identical to
  // today's CSS-only `sidebar:` breakpoint behaviour for callers that never opt in.
  const isRail = $derived(railAware && sidebarModeStore.layout === 'rail');
  const isExpandedLayout = $derived(
    railAware ? sidebarModeStore.layout === 'expanded' : mediaQueryManager.isFullSidebar,
  );

  // The first column holds the hamburger AND the logo, which is why its sub-850px value is
  // 8rem. Rail mode needs the hamburger visible, so it cannot shrink to the 4rem rail width.
  // Rail gets 9rem rather than the overlay's 8rem: there the hamburger claims the rail's own
  // 5rem (see `menuSlot`) so that 5rem + a 3rem logo already fills 8rem exactly, leaving the
  // logo touching the search field. The extra 1rem is that gap.
  //
  // Each pair below is driven from a single shared value on purpose, used for BOTH the real
  // prop/class and the test-facing attribute: a test asserting only the semantic label (e.g.
  // `data-column`) can't tell the two apart if they were computed by separate, duplicate
  // ternaries, so a mutation to only the "real" side would pass silently.
  const navColumn = $derived(isExpandedLayout ? 'wide' : isRail ? 'rail' : 'narrow');
  const navColumnClass = $derived(
    {
      wide: 'grid-cols-[--spacing(64)_auto]',
      rail: 'grid-cols-[--spacing(36)_auto]',
      narrow: 'grid-cols-[--spacing(32)_auto]',
    }[navColumn],
  );

  // In the rail layout the hamburger is given the rail's own width, so the logo beside it starts
  // exactly where the content panel starts - the alignment the request asked for - and the
  // hamburger itself lands on the same centre line as the rail icons directly below it. `w-20`
  // has to track UserPageLayout's rail grid column (`--spacing(20)`); they move together.
  // Anywhere else the hamburger keeps its 1rem inset and sits right beside the logo: the
  // sub-850px overlay has no content edge to line up with, and the expanded layout hides the
  // hamburger altogether. `contents` makes that wrapper vanish from layout so those two states
  // render exactly the markup they did before.
  const menuSlot = $derived(isRail ? 'rail' : 'inline');
  const menuSlotClass = $derived({ rail: 'flex w-20 shrink-0 justify-center', inline: 'contents' }[menuSlot]);
  const menuRowClass = $derived({ rail: '', inline: 'mx-4 gap-1' }[menuSlot]);

  const menuButtonHidden = $derived(isExpandedLayout);
  const logoVariant = $derived(isExpandedLayout ? 'inline' : 'icon');
</script>

<svelte:window bind:innerWidth />

<nav id="dashboard-navbar" class="h-(--navbar-height) w-dvw text-sm max-md:h-(--navbar-height-md)">
  <SkipLink text={$t('skip_to_content')} />
  <div
    data-testid="navbar-grid"
    data-column={navColumn}
    class="grid h-full items-center py-1 {navColumnClass} {noBorder ? '' : 'border-b'}"
  >
    <div class="flex flex-row items-center {menuRowClass}">
      <div data-testid="navbar-menu-slot" data-slot={menuSlot} class={menuSlotClass}>
        <IconButton
          id={menuButtonId}
          shape="round"
          color="secondary"
          variant="ghost"
          size="medium"
          aria-label={$t('main_menu')}
          icon={mdiMenu}
          onclick={() => {
            if (isRail) {
              sidebarModeStore.toggleRailOverlay();
              return;
            }
            sidebarStore.toggle();
          }}
          onmousedown={(event: MouseEvent) => {
            if (sidebarStore.isOpen) {
              // stops event from reaching the default handler when clicking outside of the sidebar
              event.stopPropagation();
            }
          }}
          class={menuButtonHidden ? 'hidden' : ''}
          data-hidden={menuButtonHidden ? '' : undefined}
        />
      </div>
      <a data-sveltekit-preload-data="hover" href={Route.photos()}>
        <span data-testid="navbar-logo" data-variant={logoVariant}>
          <!-- One step down the Logo scale (3rem -> 2.5rem). At `medium` the mark matched the
               search field's own 48px, which read as oversized for the corner it sits in now that
               the bar is thin. Upstream's `max-md:h-12` went with it rather than pinning small
               screens at the old size: it was a no-op while the base was 3rem, and reviving it
               would leave the mark biggest exactly where the bar is tightest. -->
          <Logo variant={logoVariant} size="small" />
        </span>
      </a>
    </div>
    <div class="flex justify-between gap-4 pe-6 lg:gap-8">
      <!--
        The full-width trigger is spent from `xl` up, and the magnifier below it. `xl` is 1279px,
        the same width `sidebar-media.svelte.ts` switches `auto` mode from the expanded sidebar to
        the rail, so the bar goes compact in step with the sidebar rather than holding a 40rem
        field until the 639px `sm` breakpoint - the point at which the chrome starts economising
        is the point at which the field should stop claiming the width. Nothing is lost by it:
        the trigger is a button that opens the search palette, not an input, so the magnifier
        reaches exactly the same place in one click.

        A breakpoint rather than `isExpandedLayout`, deliberately. This is a question about how
        much width there is, not about what the sidebar is doing, so someone who *pins* the rail
        on a wide screen keeps their field. It also keeps the bar identical between the user and
        admin shells at any given width, which a layout-derived condition would not: admin passes
        no `railAware` and would resolve it against 850px instead.
      -->
      <div data-testid="navbar-search-trigger" class="hidden w-full max-w-5xl flex-1 tall:ps-0 xl:block">
        <GlobalSearchInputTrigger />
      </div>

      <!-- `w-full` until the trigger reappears, or `justify-between` would leave this row parked
           against the logo with a stretch of empty bar after it. -->
      <section class="flex w-full place-items-center justify-end gap-1 md:gap-2 xl:w-auto">
        <IconButton
          color="secondary"
          shape="round"
          variant="ghost"
          size="medium"
          icon={mdiMagnify}
          onclick={() => globalSearchManager.open()}
          id="search-button"
          class="xl:hidden"
          aria-label={$t('go_to_search')}
        />

        {#if !page.url.pathname.includes('/admin') && onUploadClick && !authManager.isDemo}
          <Button
            leadingIcon={mdiTrayArrowUp}
            onclick={onUploadClick}
            class="hidden lg:flex"
            variant="ghost"
            size="medium"
            color="secondary"
            >{$t('upload')}
          </Button>
          <IconButton
            color="secondary"
            shape="round"
            variant="ghost"
            size="medium"
            onclick={onUploadClick}
            title={$t('upload')}
            aria-label={$t('upload')}
            icon={mdiTrayArrowUp}
            class="lg:hidden"
          />
        {/if}

        <ThemeButton />

        <div
          use:clickOutside={{
            onOutclick: () => (shouldShowNotificationPanel = false),
            onEscape: () => (shouldShowNotificationPanel = false),
          }}
        >
          <div class="relative">
            <IconButton
              shape="round"
              color={hasUnreadNotifications ? 'primary' : 'secondary'}
              variant="ghost"
              size="medium"
              icon={hasUnreadNotifications ? mdiBellBadge : mdiBellOutline}
              onclick={() => (shouldShowNotificationPanel = !shouldShowNotificationPanel)}
              aria-label={$t('notifications')}
            />

            {#if hasUnreadNotifications}
              <div
                class="pointer-events-none absolute top-0 right-1 flex size-5 items-center justify-center rounded-full border bg-primary text-[10px] font-bold text-light"
              >
                {notificationManager.notifications.length}
              </div>
            {/if}
          </div>

          {#if shouldShowNotificationPanel}
            <NotificationPanel />
          {/if}
        </div>

        <ActionButton action={Cast} />

        <div
          use:clickOutside={{
            onOutclick: () => (shouldShowAccountInfoPanel = false),
            onEscape: () => (shouldShowAccountInfoPanel = false),
          }}
        >
          <button
            type="button"
            class="flex ps-2"
            onclick={() => (shouldShowAccountInfoPanel = !shouldShowAccountInfoPanel)}
            title="{authManager.user.name} ({authManager.user.email})"
          >
            {#key authManager.user}
              <UserAvatar user={authManager.user} size="md" noTitle interactive />
            {/key}
          </button>

          {#if shouldShowAccountInfoPanel}
            <AccountInfoPanel onClose={() => (shouldShowAccountInfoPanel = false)} />
          {/if}
        </div>
      </section>
    </div>
  </div>
</nav>
