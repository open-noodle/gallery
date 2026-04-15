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
  <div role="region" aria-label="Mobile app suggestion" class="fixed inset-x-0 top-0 z-40 bg-light">
    <a href={eligibility.deepLink}>{$t('open_in_app_banner_open')}</a>
    <a href={getAppHref(eligibility.platform)}>{$t('open_in_app_banner_get_app')}</a>
    <IconButton aria-label={$t('open_in_app_banner_dismiss')} icon={mdiClose} onclick={dismiss} />
  </div>
{/if}
