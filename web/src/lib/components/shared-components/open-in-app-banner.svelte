<script lang="ts">
  import { browser } from '$app/environment';
  import { afterNavigate } from '$app/navigation';
  import { page } from '$app/state';
  import { ANDROID_INSTALL_URL, IOS_APP_STORE_URL } from '$lib/constants';
  import { user } from '$lib/stores/user.store';
  import { isAssetViewerRoute } from '$lib/utils/navigation';
  import { isEligible, type Eligibility, type Platform } from '$lib/utils/open-in-app';
  import { Button, IconButton } from '@immich/ui';
  import { mdiClose } from '@mdi/js';
  import { t } from 'svelte-i18n';

  const DISMISSAL_KEY = 'gallery.openInApp.dismissedUntil';
  const DISMISSAL_DAYS = 30;
  const BANNER_HEIGHT_PX = 64;

  let coldEntry = $state(true);
  let visible = $state(false);
  let lastUserId = $state<string | null>(null);

  // Re-arm cold-entry when auth resolves (null → user) so the banner survives
  // any pre-auth redirects that fired afterNavigate before the user store hydrated.
  $effect(() => {
    const currentUserId = $user?.id ?? null;
    if (currentUserId && !lastUserId) {
      coldEntry = true;
    }
    lastUserId = currentUserId;
  });

  const eligibility: Eligibility = $derived.by(() => {
    if (!browser) {
      return { eligible: false };
    }
    return isEligible({
      userAgent: navigator.userAgent,
      maxTouchPoints: navigator.maxTouchPoints,
      pathname: page.url.pathname,
      isAuthenticated: !!$user,
      coldEntry,
      dismissedUntil: localStorage.getItem(DISMISSAL_KEY),
      now: new Date(),
    });
  });

  // The asset viewer paints its own pitch-black surface regardless of theme —
  // match that with a dark translucent banner so we read as part of the viewer
  // chrome instead of a foreign light strip.
  const darkContext = $derived(isAssetViewerRoute(page));

  $effect(() => {
    if (eligibility.eligible) {
      visible = true;
    }
  });

  afterNavigate(({ type, from, to }) => {
    if (type === 'enter') {
      return;
    }
    // Asset-viewer-to-asset-viewer swipes (e.g. /photos/A → /photos/B) are not
    // user-initiated leave-the-content navigations — keep the banner.
    if (isAssetViewerRoute(from) && isAssetViewerRoute(to)) {
      return;
    }
    coldEntry = false;
    visible = false;
  });

  const dismiss = () => {
    const until = new Date(Date.now() + DISMISSAL_DAYS * 24 * 60 * 60 * 1000);
    localStorage.setItem(DISMISSAL_KEY, until.toISOString());
    visible = false;
  };

  const getAppHref = (platform: Platform) => (platform === 'ios' ? IOS_APP_STORE_URL : ANDROID_INSTALL_URL);
</script>

{#if visible && eligibility.eligible}
  <div
    role="region"
    aria-label={$t('open_in_app_banner_aria_label')}
    data-testid="open-in-app-banner"
    class="fixed inset-x-0 top-0 z-40 motion-safe:animate-slide-down"
  >
    <div
      class="flex items-center gap-3 border-b px-3 py-2 shadow-sm backdrop-blur-xl {darkContext
        ? 'border-white/10 bg-black/60 text-white'
        : 'border-black/5 bg-light/95 dark:border-white/5 dark:bg-dark/95'}"
      style="height: {BANNER_HEIGHT_PX}px"
    >
      <img
        src="/apple-icon-180.png"
        alt=""
        class="h-10 w-10 flex-shrink-0 rounded-[9px] shadow-sm ring-1 {darkContext
          ? 'ring-white/15'
          : 'ring-black/5 dark:ring-white/10'}"
      />
      <div class="min-w-0 flex-1 leading-tight">
        <p class="truncate text-sm font-semibold">
          {$t('open_in_app_banner_title')}
        </p>
        <a
          href={getAppHref(eligibility.platform)}
          class="mt-0.5 inline-block truncate text-[11px] underline decoration-current/40 underline-offset-2 {darkContext
            ? 'text-white/70 hover:text-white'
            : 'text-subtle hover:text-current'}"
        >
          {$t('open_in_app_banner_get_app')}
        </a>
      </div>
      <Button href={eligibility.deepLink} size="small" shape="round" class="flex-shrink-0">
        {$t('open_in_app_banner_open')}
      </Button>
      <IconButton
        aria-label={$t('open_in_app_banner_dismiss')}
        icon={mdiClose}
        variant="ghost"
        shape="round"
        size="small"
        color="secondary"
        onclick={dismiss}
        class="-mr-1 flex-shrink-0 {darkContext ? 'text-white/70 hover:text-white' : ''}"
      />
    </div>
  </div>
  <div aria-hidden="true" style="height: {BANNER_HEIGHT_PX}px"></div>
{/if}

<style>
  @keyframes slide-down {
    from {
      transform: translateY(-100%);
    }
    to {
      transform: translateY(0);
    }
  }
  :global(.motion-safe\:animate-slide-down) {
    animation: slide-down 0.28s cubic-bezier(0.32, 0.72, 0, 1);
  }
</style>
