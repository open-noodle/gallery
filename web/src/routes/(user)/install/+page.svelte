<script lang="ts">
  import OnboardingMobileApp from '$lib/components/onboarding-page/onboarding-mobile-app.svelte';
  import { t } from 'svelte-i18n';
</script>

<svelte:head>
  <title>{$t('install_app_title')}</title>
</svelte:head>

<div class="mx-auto max-w-2xl p-6">
  <OnboardingMobileApp />
</div>
