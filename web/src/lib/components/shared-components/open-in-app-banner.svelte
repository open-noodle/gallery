<script lang="ts">
  import { browser } from '$app/environment';
  import { afterNavigate } from '$app/navigation';
  import { page } from '$app/state';
  import { ANDROID_INSTALL_URL, IOS_APP_STORE_URL } from '$lib/constants';
  import { user } from '$lib/stores/user.store';
  import { isEligible, type Eligibility, type Platform } from '$lib/utils/open-in-app';
  import { Button, IconButton } from '@immich/ui';
  import { mdiClose } from '@mdi/js';
  import { t } from 'svelte-i18n';

  const DISMISSAL_KEY = 'gallery.openInApp.dismissedUntil';
  const DISMISSAL_DAYS = 30;

  let coldEntry = $state(true);
  let visible = $state(false);

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

  $effect(() => {
    if (eligibility.eligible) {
      visible = true;
    }
  });

  afterNavigate(({ type }) => {
    if (type === 'enter') {
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
    aria-label="Mobile app suggestion"
    class="fixed inset-x-0 top-0 z-40 border-b border-light-100 bg-light shadow-sm motion-safe:animate-slide-down dark:border-dark-100 dark:bg-dark"
  >
    <div class="flex items-center gap-3 px-3 py-2">
      <img
        src="/apple-icon-180.png"
        alt=""
        class="h-12 w-12 flex-shrink-0 rounded-xl shadow-sm ring-1 ring-light/10 dark:ring-dark/10"
      />
      <div class="min-w-0 flex-1">
        <p class="truncate text-base font-semibold leading-tight">
          {$t('open_in_app_banner_title')}
        </p>
        <p class="truncate text-xs text-subtle sm:hidden">
          {$t('open_in_app_banner_subtitle')}
        </p>
      </div>
      <Button href={eligibility.deepLink} size="small" class="flex-shrink-0">
        {$t('open_in_app_banner_open')}
      </Button>
      <IconButton
        aria-label={$t('open_in_app_banner_dismiss')}
        icon={mdiClose}
        variant="ghost"
        size="small"
        onclick={dismiss}
      />
    </div>
    <div class="flex justify-end px-3 pb-2 sm:hidden">
      <a href={getAppHref(eligibility.platform)} class="text-xs text-subtle underline underline-offset-2">
        {$t('open_in_app_banner_get_app')}
      </a>
    </div>
  </div>
  <div aria-hidden="true" class="h-[88px] sm:h-[56px]"></div>
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
