<script lang="ts">
  import AuthPageLayout from '#lib/components/layouts/AuthPageLayout.svelte';
  import { authManager } from '#lib/managers/auth-manager.svelte.ts';
  import { eventManager } from '#lib/managers/event-manager.svelte.ts';
  import { MutationCancelledError, createPreloadedQuery } from '#lib/queries/client.ts';
  import { getPublicConfigQuery } from '#lib/queries/config-public.query.ts';
  import { loginWithPasskeyMutation } from '#lib/queries/passkey.query.ts';
  import { getServerConfigQuery } from '#lib/queries/server-info.query.ts';
  import { Route } from '#lib/route.ts';
  import { oauth } from '#lib/utils.ts';
  import { getServerErrorMessage, handleError } from '#lib/utils/handle-error.ts';
  import { demoLogin, login, type LoginResponseDto } from '@immich/sdk';
  import { Alert, Button, Field, Input, PasswordInput, Stack } from '@immich/ui';
  import { mdiShieldKeyOutline } from '@mdi/js';
  import { browserSupportsWebAuthn } from '@simplewebauthn/browser';
  import { createMutation } from '@tanstack/svelte-query';
  import { onMount } from 'svelte';
  import { t } from 'svelte-i18n';
  import { goto } from '$app/navigation';
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
  const queries = {
    publicConfig: createPreloadedQuery(getPublicConfigQuery),
    serverConfig: createPreloadedQuery(getServerConfigQuery),
  };

  const publicConfig = $derived(queries.publicConfig.data);
  const serverConfig = $derived(queries.serverConfig.data);

  const passkeySupported = browserSupportsWebAuthn();
  const passkeyEnabled = $derived(publicConfig.passkey.enabled && passkeySupported);

  let demoLoading = $state(false);
  let demoAutoLoginFailed = $state(false);
  const showStandardLogin = $derived(!serverConfig.demoMode);
  const showPasswordLogin = $derived(showStandardLogin && !oauthLoading && publicConfig.passwordLogin.enabled);
  const showOAuthLogin = $derived(showStandardLogin && publicConfig.oauth.enabled);
  const showDemoLogin = $derived(serverConfig.demoMode && (!serverConfig.demoAutoLogin || demoAutoLoginFailed));
  const showLoginDisabled = $derived(
    showStandardLogin && !publicConfig.passwordLogin.enabled && !passkeyEnabled && !publicConfig.oauth.enabled,
  );

  const passkeyLogin = createMutation(() => ({ ...loginWithPasskeyMutation(), onSuccess: (user) => onLogin(user) }));
  const passkeyLoading = $derived(passkeyLogin.isPending || passkeyLogin.isSuccess);
  const passkeyError = $derived(
    passkeyLogin.error && !(passkeyLogin.error instanceof MutationCancelledError)
      ? getServerErrorMessage(passkeyLogin.error) || $t('errors.something_went_wrong')
      : '',
  );

  const onSuccess = async (user: LoginResponseDto) => {
    await goto(data.continueUrl, { refreshAll: true });
    eventManager.emit('AuthLogin', user);
  };

  const onFirstLogin = () => goto(Route.changePassword());
  const onOnboarding = () => goto(Route.onboarding());

  const onLogin = async (user: LoginResponseDto) => {
    if (user.isAdmin && !serverConfig.isOnboarded) {
      await onOnboarding();
      return;
    }

    // change the user password before we onboard them
    if (!user.isAdmin && user.shouldChangePassword && publicConfig.passwordLogin.enabled) {
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
  };

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

    if (!publicConfig.oauth.enabled) {
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
        (publicConfig.oauth.autoLaunch && !oauth.isAutoLaunchDisabled(location)) ||
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
      await onLogin(user);
    } catch (error) {
      errorMessage = getServerErrorMessage(error) || $t('errors.incorrect_email_or_password');
      loading = false;
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

{#snippet divider()}
  <div class="my-4 inline-flex w-full items-center justify-center">
    <hr class="my-4 h-px w-3/4 border-0 bg-gray-200 dark:bg-gray-600" />
    <span
      class="absolute inset-s-1/2 -translate-x-1/2 bg-gray-50 px-3 font-medium text-gray-900 uppercase dark:bg-neutral-900 dark:text-white"
    >
      {$t('or')}
    </span>
  </div>
{/snippet}

<AuthPageLayout title={data.meta.title}>
  <Stack gap={4}>
    {#if publicConfig.server.loginPageMessage}
      <Alert color="primary" class="mb-6">
        <!-- eslint-disable-next-line svelte/no-at-html-tags -->
        {@html publicConfig.server.loginPageMessage}
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

    {#if showStandardLogin && !oauthLoading && passkeyEnabled}
      {#if publicConfig.passwordLogin.enabled}
        {@render divider()}
      {/if}
      {#if passkeyError}
        <Alert color="danger" title={passkeyError} closable />
      {/if}
      <Button
        shape="round"
        leadingIcon={mdiShieldKeyOutline}
        loading={passkeyLoading}
        disabled={loading || passkeyLoading}
        size="large"
        fullWidth
        color={publicConfig.passwordLogin.enabled ? 'secondary' : 'primary'}
        onclick={() => passkeyLogin.mutate()}
      >
        {$t('login_with_passkey')}
      </Button>
    {/if}

    {#if showOAuthLogin}
      {#if publicConfig.passwordLogin.enabled || passkeyEnabled}
        {@render divider()}
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
        color={publicConfig.passwordLogin.enabled ? 'secondary' : 'primary'}
        onclick={handleOAuthLogin}
      >
        {publicConfig.oauth.buttonText}
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
