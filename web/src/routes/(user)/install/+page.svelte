<script lang="ts">
  import { t } from 'svelte-i18n';
  import OnboardingMobileApp from '../../auth/onboarding/OnboardingMobileApp.svelte';
</script>

<svelte:head>
  <title>{$t('install_app_title')}</title>
</svelte:head>

<div class="mx-auto max-w-2xl p-6">
  <OnboardingMobileApp />
</div>
