<script lang="ts">
  import { goto } from '$app/navigation';
  import AuthPageLayout from '$lib/components/layouts/AuthPageLayout.svelte';
  import { authManager } from '$lib/managers/auth-manager.svelte';
  import { eventManager } from '$lib/managers/event-manager.svelte';
  import { featureFlagsManager } from '$lib/managers/feature-flags-manager.svelte';
  import { serverConfigManager } from '$lib/managers/server-config-manager.svelte';
  import { Route } from '$lib/route';
  import { oauth } from '$lib/utils';
  import { getServerErrorMessage, handleError } from '$lib/utils/handle-error';
  import { demoLogin, login, type LoginResponseDto } from '@immich/sdk';
  import { Alert, Button, Field, Input, PasswordInput, Stack } from '@immich/ui';
  import { onMount } from 'svelte';
  import { t } from 'svelte-i18n';
  import type { PageData } from './$types';

  interface Props {
    data: PageData;
  }

  let { data }: Props = $props();

  let errorMessage: string = $state('');
  let email = $state('');
  let password = $state('');
  let oauthError = $state('');
  let loading = $state(false);
  let oauthLoading = $state(true);
  let demoLoading = $state(false);
  let demoAutoLoginFailed = $state(false);
  const serverConfig = $derived(serverConfigManager.value);
  const showStandardLogin = $derived(!serverConfig.demoMode);
  const showPasswordLogin = $derived(showStandardLogin && !oauthLoading && featureFlagsManager.value.passwordLogin);
  const showOAuthLogin = $derived(showStandardLogin && featureFlagsManager.value.oauth);
  const showDemoLogin = $derived(serverConfig.demoMode && (!serverConfig.demoAutoLogin || demoAutoLoginFailed));
  const showLoginDisabled = $derived(
    showStandardLogin && !featureFlagsManager.value.passwordLogin && !featureFlagsManager.value.oauth,
  );

  const onSuccess = async (user: LoginResponseDto) => {
    await goto(data.continueUrl, { invalidateAll: true });
    eventManager.emit('AuthLogin', user);
  };

  const onFirstLogin = () => goto(Route.changePassword());
  const onOnboarding = () => goto(Route.onboarding());

  const handleDemoLogin = async () => {
    try {
      demoLoading = true;
      demoAutoLoginFailed = false;
      errorMessage = '';
      const user = await demoLogin();
      authManager.isDemo = true;
      await onSuccess(user);
    } catch (error) {
      errorMessage = getServerErrorMessage(error) || 'Unable to start demo';
      demoAutoLoginFailed = true;
      demoLoading = false;
    }
  };

  onMount(async () => {
    if (serverConfig.demoMode && serverConfig.demoAutoLogin) {
      await handleDemoLogin();
      return;
    }

    if (serverConfig.demoMode) {
      oauthLoading = false;
      return;
    }

    if (!featureFlagsManager.value.oauth) {
      oauthLoading = false;
      return;
    }

    if (oauth.isCallback(location)) {
      try {
        const user = await oauth.login(location);

        if (!user.isOnboarded) {
          await onOnboarding();
          return;
        }

        await onSuccess(user);
        return;
      } catch (error) {
        console.error('Error [login-form] [oauth.callback]', error);
        oauthError = getServerErrorMessage(error) || $t('errors.unable_to_complete_oauth_login');
        oauthLoading = false;
        return;
      }
    }

    try {
      if (
        (featureFlagsManager.value.oauthAutoLaunch && !oauth.isAutoLaunchDisabled(location)) ||
        oauth.isAutoLaunchEnabled(location)
      ) {
        await goto(Route.login({ autoLaunch: 0 }), { replaceState: true });
        await oauth.authorize(location);
        return;
      }
    } catch (error) {
      handleError(error, $t('errors.unable_to_connect'));
    }

    oauthLoading = false;
  });

  const handleLogin = async () => {
    try {
      errorMessage = '';
      loading = true;
      const user = await login({ loginCredentialDto: { email, password } });

      if (user.isAdmin && !serverConfig.isOnboarded) {
        await onOnboarding();
        return;
      }

      // change the user password before we onboard them
      if (!user.isAdmin && user.shouldChangePassword) {
        await onFirstLogin();
        return;
      }

      // We want to onboard after the first login since their password will change
      // and handleLogin will be called again (relogin). We then do onboarding on that next call.
      if (!user.isOnboarded) {
        await onOnboarding();
        return;
      }

      await onSuccess(user);
      return;
    } catch (error) {
      errorMessage = getServerErrorMessage(error) || $t('errors.incorrect_email_or_password');
      loading = false;
      return;
    }
  };

  const handleOAuthLogin = async () => {
    oauthLoading = true;
    oauthError = '';
    const success = await oauth.authorize(location);
    if (!success) {
      oauthLoading = false;
      oauthError = $t('errors.unable_to_login_with_oauth');
    }
  };

  const onsubmit = async (event: Event) => {
    event.preventDefault();
    await handleLogin();
  };
</script>

<AuthPageLayout title={data.meta.title}>
  <Stack gap={4}>
    {#if serverConfig.loginPageMessage}
      <Alert color="primary" class="mb-6">
        <!-- eslint-disable-next-line svelte/no-at-html-tags -->
        {@html serverConfig.loginPageMessage}
      </Alert>
    {/if}

    {#if errorMessage}
      <Alert color="danger" title={errorMessage} closable />
    {/if}

    {#if showPasswordLogin}
      <form {onsubmit} class="flex flex-col gap-4">
        <Field label={$t('email')} required="indicator">
          <Input id="email" name="email" type="email" autocomplete="email" bind:value={email} />
        </Field>

        <Field label={$t('password')} required="indicator">
          <PasswordInput id="password" bind:value={password} autocomplete="current-password" />
        </Field>

        <Button type="submit" size="large" shape="round" fullWidth {loading} class="mt-6">{$t('to_login')}</Button>
      </form>
    {/if}

    {#if showOAuthLogin}
      {#if featureFlagsManager.value.passwordLogin}
        <div class="my-4 inline-flex w-full items-center justify-center">
          <hr class="my-4 h-px w-3/4 border-0 bg-gray-200 dark:bg-gray-600" />
          <span
            class="absolute inset-s-1/2 -translate-x-1/2 bg-gray-50 px-3 font-medium text-gray-900 uppercase dark:bg-neutral-900 dark:text-white"
          >
            {$t('or')}
          </span>
        </div>
      {/if}
      {#if oauthError}
        <Alert color="danger" title={oauthError} closable />
      {/if}
      <Button
        shape="round"
        loading={loading || oauthLoading}
        disabled={loading || oauthLoading}
        size="large"
        fullWidth
        color={featureFlagsManager.value.passwordLogin ? 'secondary' : 'primary'}
        onclick={handleOAuthLogin}
      >
        {serverConfig.oauthButtonText}
      </Button>
    {/if}

    {#if showDemoLogin}
      <Button
        shape="round"
        size="large"
        fullWidth
        color="secondary"
        loading={demoLoading}
        disabled={demoLoading}
        onclick={handleDemoLogin}
      >
        Try Demo
      </Button>
    {/if}

    {#if showLoginDisabled}
      <Alert color="warning" title={$t('login_has_been_disabled')} />
    {/if}
  </Stack>
</AuthPageLayout>
