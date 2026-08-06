<script lang="ts">
  import { createAgentProviderCredential, deleteAgentProviderCredential, validateAgentSession } from '@immich/sdk';
  import { Button, Icon } from '@immich/ui';
  import { mdiCheck, mdiEye, mdiEyeOff, mdiServer } from '@mdi/js';
  import { t } from 'svelte-i18n';
  import {
    ONBOARDING_PROVIDER_ORDER,
    ONBOARDING_PROVIDERS,
    buildCredentialCreateDto,
    buildValidateDto,
    isCloudProvider,
    isConnectComplete,
    type OnboardingConnectState,
    type OnboardingProviderId,
  } from './agent-onboarding-model';

  interface Props {
    onConnected: (credentialId: string, model: string, provider: OnboardingProviderId) => void;
  }
  let { onConnected }: Props = $props();

  let provider = $state<OnboardingProviderId>('local');
  let label = $state('');
  let secret = $state('');
  let baseUrl = $state(ONBOARDING_PROVIDERS.local.baseUrlPrefill);
  let model = $state('');
  let revealKey = $state(false);
  let status = $state<'idle' | 'testing' | 'connected' | 'error'>('idle');
  let errorMessage = $state<string | null>(null);
  let createdCredentialId = $state<string | null>(null);

  const meta = $derived(ONBOARDING_PROVIDERS[provider]);
  const connectState = $derived<OnboardingConnectState>({ provider, label, secret, baseUrl, model });
  const canTest = $derived(isConnectComplete(connectState) && status !== 'testing');

  const markDirty = () => {
    if (status === 'connected' || status === 'error') {
      status = 'idle';
      onConnected('', '', provider);
    }
  };

  const selectProvider = (next: OnboardingProviderId) => {
    if (createdCredentialId) {
      void deleteAgentProviderCredential({ id: createdCredentialId }).catch(() => {});
      createdCredentialId = null;
    }
    provider = next;
    baseUrl = ONBOARDING_PROVIDERS[next].baseUrlPrefill;
    secret = '';
    status = 'idle';
    errorMessage = null;
    onConnected('', '', next);
  };

  const test = async () => {
    if (!canTest) {
      return;
    }
    status = 'testing';
    errorMessage = null;
    try {
      if (createdCredentialId) {
        await deleteAgentProviderCredential({ id: createdCredentialId });
        createdCredentialId = null;
      }
      const created = await createAgentProviderCredential({
        agentProviderCredentialCreateDto: buildCredentialCreateDto(connectState),
      });
      createdCredentialId = created.id;
      await validateAgentSession({ agentSessionCreateDto: buildValidateDto(created.id, model) });
      status = 'connected';
      onConnected(created.id, model.trim(), provider);
    } catch {
      status = 'error';
      errorMessage = $t('assistant_onboarding_test_error');
    }
  };

  const baseUrlFieldId = 'onboarding-base-url';
  const apiKeyFieldId = 'onboarding-api-key';
  const modelFieldId = 'onboarding-model';
</script>

<div class="flex flex-col gap-4">
  <!-- Provider selection -->
  <div role="group" aria-label="Provider">
    <!-- Featured local card (full-width, hero layout) -->
    <button
      class="relative mb-3 flex w-full cursor-pointer flex-row items-center gap-4 rounded-2xl border-[1.5px] p-[17px_18px] text-left transition-all
        {provider === 'local'
        ? 'border-primary bg-primary/5 shadow-[0_0_0_3px_rgba(66,80,175,0.28)]'
        : 'border-gray-300 bg-white shadow-[0_1px_2px_rgba(20,22,40,0.04),0_18px_50px_-20px_rgba(20,22,60,0.22)] hover:-translate-y-0.5 dark:border-gray-700 dark:bg-immich-dark-gray'}"
      aria-pressed={provider === 'local' ? 'true' : 'false'}
      aria-label={$t('assistant_onboarding_provider_local')}
      onclick={() => selectProvider('local')}
      type="button"
    >
      <!-- tick indicator -->
      <span
        class="absolute right-3.5 top-3.5 flex h-[18px] w-[18px] items-center justify-center rounded-full bg-primary text-white transition-all
          {provider === 'local' ? 'scale-100 opacity-100' : 'scale-50 opacity-0'}"
      >
        <svg
          class="h-[11px] w-[11px]"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="3"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <path d="M5 12l4 4L19 7" />
        </svg>
      </span>
      <!-- logo box -->
      <span
        class="flex h-[46px] w-[46px] flex-none items-center justify-center rounded-xl
          {provider === 'local' ? 'bg-white dark:bg-gray-800' : 'bg-gray-100 dark:bg-gray-700'}"
      >
        <Icon icon={mdiServer} size="24" class="text-gray-700 dark:text-gray-200" />
      </span>
      <!-- text -->
      <span class="flex min-w-0 flex-1 flex-col gap-1">
        <span class="flex flex-wrap items-center gap-2">
          <span class="text-[14.5px] font-bold tracking-[-0.01em] text-gray-900 dark:text-white"
            >{$t('assistant_onboarding_provider_local')}</span
          >
          <span
            class="rounded-full bg-green-50 px-2 py-0.5 text-[10.5px] font-bold uppercase tracking-[0.04em] text-green-600 dark:bg-green-950 dark:text-green-400"
          >
            {$t('assistant_onboarding_provider_most_private')}
          </span>
        </span>
        <span class="max-w-[48ch] text-xs leading-snug text-gray-500 dark:text-neutral-400"
          >{$t('assistant_onboarding_provider_local_meta')}</span
        >
      </span>
    </button>

    <!-- "or use a cloud provider" divider -->
    <div
      class="mb-2.5 mt-0.5 flex items-center gap-3 text-[11.5px] font-semibold uppercase tracking-[0.03em] text-gray-400 dark:text-gray-500"
    >
      <span class="h-px flex-1 bg-gray-200 dark:bg-gray-700"></span>
      <span>{$t('assistant_onboarding_cloud_divider')}</span>
      <span class="h-px flex-1 bg-gray-200 dark:bg-gray-700"></span>
    </div>

    <!-- Cloud provider row: OpenAI + Anthropic + Other -->
    <div class="grid grid-cols-3 gap-2.5">
      {#each ONBOARDING_PROVIDER_ORDER.filter((id) => id !== 'local') as id (id)}
        <button
          class="relative flex cursor-pointer flex-col gap-2 rounded-2xl border-[1.5px] p-[15px_14px] text-left transition-all
            {provider === id
            ? 'border-primary bg-primary/5 shadow-[0_0_0_3px_rgba(66,80,175,0.28)]'
            : 'border-gray-300 bg-white hover:-translate-y-0.5 dark:border-gray-700 dark:bg-immich-dark-gray'}"
          aria-pressed={provider === id ? 'true' : 'false'}
          aria-label={$t(`assistant_onboarding_provider_${id}`)}
          onclick={() => selectProvider(id as OnboardingProviderId)}
          type="button"
        >
          <!-- tick -->
          <span
            class="absolute right-2.5 top-2.5 flex h-[18px] w-[18px] items-center justify-center rounded-full bg-primary text-white transition-all
              {provider === id ? 'scale-100 opacity-100' : 'scale-50 opacity-0'}"
          >
            <svg
              class="h-[11px] w-[11px]"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="3"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <path d="M5 12l4 4L19 7" />
            </svg>
          </span>
          <!-- logo box -->
          <span
            class="flex h-[34px] w-[34px] items-center justify-center rounded-[9px]
              {provider === id ? 'bg-white dark:bg-gray-800' : 'bg-gray-100 dark:bg-gray-700'}"
          >
            {#if id === 'openai'}
              <!-- OpenAI logo -->
              <svg class="h-[19px] w-[19px] text-gray-800 dark:text-gray-100" viewBox="0 0 24 24" fill="currentColor">
                <path
                  d="M22.2819 9.8211a5.9847 5.9847 0 0 0-.5157-4.9108 6.0462 6.0462 0 0 0-6.5098-2.9A6.0651 6.0651 0 0 0 4.9807 4.1818a5.9847 5.9847 0 0 0-3.9977 2.9 6.0462 6.0462 0 0 0 .7427 7.0966 5.98 5.98 0 0 0 .511 4.9107 6.051 6.051 0 0 0 6.5146 2.9001A5.9847 5.9847 0 0 0 13.2599 24a6.0557 6.0557 0 0 0 5.7718-4.2058 5.9894 5.9894 0 0 0 3.9977-2.9001 6.0557 6.0557 0 0 0-.7475-7.0729zm-9.022 12.6081a4.4755 4.4755 0 0 1-2.8764-1.0408l.1419-.0804 4.7783-2.7582a.7948.7948 0 0 0 .3927-.6813v-6.7369l2.02 1.1686a.071.071 0 0 1 .038.052v5.5826a4.504 4.504 0 0 1-4.4945 4.4944zm-9.6607-4.1254a4.4708 4.4708 0 0 1-.5346-3.0137l.142.0852 4.783 2.7582a.7712.7712 0 0 0 .7806 0l5.8428-3.3685v2.3324a.0804.0804 0 0 1-.0332.0615L9.74 19.9502a4.4992 4.4992 0 0 1-6.1408-1.6464zM2.3408 7.8956a4.485 4.485 0 0 1 2.3655-1.9728V11.6a.7664.7664 0 0 0 .3879.6765l5.8144 3.3543-2.0201 1.1685a.0757.0757 0 0 1-.071 0l-4.8303-2.7865A4.504 4.504 0 0 1 2.3408 7.872zm16.5963 3.8558L13.1038 8.364 15.1192 7.2a.0757.0757 0 0 1 .071 0l4.8303 2.7913a4.4944 4.4944 0 0 1-.6765 8.1042v-5.6772a.79.79 0 0 0-.407-.667zm2.0107-3.0231l-.142-.0852-4.7735-2.7818a.7759.7759 0 0 0-.7854 0L9.409 9.2297V6.8974a.0662.0662 0 0 1 .0284-.0615l4.8303-2.7866a4.4992 4.4992 0 0 1 6.6802 4.66zM8.3065 12.863l-2.02-1.1638a.0804.0804 0 0 1-.038-.0567V6.0742a4.4992 4.4992 0 0 1 7.3757-3.4537l-.142.0805L8.704 5.459a.7948.7948 0 0 0-.3927.6813zm1.0976-2.3654l2.602-1.4998 2.6069 1.4998v2.9994l-2.5974 1.4997-2.6067-1.4997Z"
                />
              </svg>
            {:else if id === 'anthropic'}
              <!-- Anthropic logo -->
              <svg class="h-[19px] w-[19px] text-gray-800 dark:text-gray-100" viewBox="0 0 24 24" fill="currentColor">
                <path
                  d="M14.6 4h-2.9l5.3 16h2.9L14.6 4Zm-7.4 0L1.9 20h3l1.05-3.2h5.55L12.5 20h3L10.2 4H7.2Zm-.45 9.7 1.9-5.8 1.9 5.8H6.75Z"
                />
              </svg>
            {:else}
              <!-- Generic endpoint icon -->
              <svg
                class="h-[19px] w-[19px] text-gray-500 dark:text-gray-400"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
              >
                <path
                  d="M21 12a9 9 0 0 1-9 9m9-9a9 9 0 0 0-9-9m9 9H3m9 9a9 9 0 0 1-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 0 1 9-9"
                />
              </svg>
            {/if}
          </span>
          <span class="text-[14.5px] font-bold tracking-[-0.01em] text-gray-900 dark:text-white"
            >{$t(`assistant_onboarding_provider_${id}`)}</span
          >
          {#if id === 'openai'}
            <span class="text-[12px] leading-snug text-gray-500 dark:text-neutral-400"
              >{$t('assistant_onboarding_provider_openai_meta')}</span
            >
          {:else if id === 'anthropic'}
            <span class="text-[12px] leading-snug text-gray-500 dark:text-neutral-400"
              >{$t('assistant_onboarding_provider_anthropic_meta')}</span
            >
          {:else}
            <span class="text-[12px] leading-snug text-gray-500 dark:text-neutral-400"
              >{$t('assistant_onboarding_provider_other_meta')}</span
            >
          {/if}
        </button>
      {/each}
    </div>
  </div>

  <!-- Dynamic fields -->
  <div class="mt-1 flex flex-col gap-3.5">
    <!-- Base URL (local + other only) -->
    {#if meta.requiresBaseUrl}
      <div class="flex flex-col gap-1.5">
        <label for={baseUrlFieldId} class="text-[13.5px] font-semibold text-gray-800 dark:text-gray-100">
          {$t('assistant_onboarding_base_url')}
        </label>
        <input
          id={baseUrlFieldId}
          class="w-full rounded-[11px] border-[1.5px] border-gray-200 bg-gray-50 px-3 py-3 font-mono text-[13.5px] text-gray-900 transition-all
            placeholder:text-gray-400 focus:border-primary focus:bg-white focus:outline-none focus:ring-[3px] focus:ring-primary/30
            dark:border-gray-600 dark:bg-gray-800 dark:text-white dark:placeholder:text-gray-500 dark:focus:bg-gray-900"
          bind:value={baseUrl}
          oninput={markDirty}
          placeholder="http://localhost:11434/v1"
          autocomplete="off"
        />
        <p class="text-xs leading-snug text-gray-400 dark:text-gray-500">{$t('assistant_onboarding_base_url_help')}</p>
      </div>
    {/if}

    <!-- API key -->
    <div class="flex flex-col gap-1.5">
      <div class="flex items-baseline justify-between gap-2">
        <label for={apiKeyFieldId} class="text-[13.5px] font-semibold text-gray-800 dark:text-gray-100">
          {#if isCloudProvider(provider)}
            {$t('assistant_onboarding_api_key')}
          {:else}
            {$t('assistant_onboarding_api_key_optional')}
          {/if}
        </label>
        {#if meta.keyHelpUrl}
          <a
            href={meta.keyHelpUrl}
            target="_blank"
            rel="noopener noreferrer"
            class="text-[12.5px] font-semibold text-primary hover:underline"
            >{$t('assistant_onboarding_api_key_help')}</a
          >
        {/if}
      </div>
      <div class="relative flex items-center">
        <input
          id={apiKeyFieldId}
          class="w-full rounded-[11px] border-[1.5px] border-gray-200 bg-gray-50 px-3 py-3 pr-10 font-mono text-[13.5px] text-gray-900 transition-all
            placeholder:text-gray-400 focus:border-primary focus:bg-white focus:outline-none focus:ring-[3px] focus:ring-primary/30
            dark:border-gray-600 dark:bg-gray-800 dark:text-white dark:placeholder:text-gray-500 dark:focus:bg-gray-900"
          type={revealKey ? 'text' : 'password'}
          bind:value={secret}
          oninput={markDirty}
          placeholder={isCloudProvider(provider) ? (provider === 'anthropic' ? 'sk-ant-…' : 'sk-…') : ''}
          autocomplete="off"
        />
        <button
          type="button"
          class="absolute right-2 flex items-center justify-center rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-700 dark:hover:bg-gray-700 dark:hover:text-gray-200"
          onclick={() => (revealKey = !revealKey)}
          aria-label={revealKey ? $t('assistant_onboarding_hide_key') : $t('assistant_onboarding_reveal_key')}
        >
          <Icon icon={revealKey ? mdiEyeOff : mdiEye} size="17" />
        </button>
      </div>
      <p class="text-xs leading-snug text-gray-400 dark:text-gray-500">
        {isCloudProvider(provider)
          ? $t('assistant_onboarding_api_key_stored_cloud')
          : $t('assistant_onboarding_api_key_stored_local')}
      </p>
    </div>

    <!-- Model -->
    <div class="flex flex-col gap-1.5">
      <label for={modelFieldId} class="text-[13.5px] font-semibold text-gray-800 dark:text-gray-100">
        {$t('assistant_onboarding_model')}
      </label>
      <input
        id={modelFieldId}
        class="w-full rounded-[11px] border-[1.5px] border-gray-200 bg-gray-50 px-3 py-3 font-mono text-[13.5px] text-gray-900 transition-all
          placeholder:text-gray-400 focus:border-primary focus:bg-white focus:outline-none focus:ring-[3px] focus:ring-primary/30
          dark:border-gray-600 dark:bg-gray-800 dark:text-white dark:placeholder:text-gray-500 dark:focus:bg-gray-900"
        bind:value={model}
        oninput={markDirty}
        placeholder={provider === 'openai' ? 'gpt-4o' : provider === 'anthropic' ? 'claude-sonnet-4-5' : 'llama3.1'}
        autocomplete="off"
      />
    </div>

    <!-- Test connection row -->
    <div class="mt-1.5 flex items-center gap-2.5">
      <Button shape="round" disabled={!canTest} onclick={test}>
        {$t('assistant_onboarding_test')}
      </Button>

      {#if status === 'testing'}
        <span class="flex items-center gap-2 text-[13px] font-semibold text-gray-500 dark:text-neutral-400">
          <span
            class="h-[15px] w-[15px] animate-spin rounded-full border-2 border-gray-300 border-t-primary dark:border-gray-600 dark:border-t-primary"
          ></span>
          {$t('assistant_onboarding_testing')}
        </span>
      {:else if status === 'connected'}
        <span
          class="inline-flex items-center gap-1.5 rounded-full bg-green-50 px-2.5 py-1.5 text-[12.5px] font-semibold text-green-600 dark:bg-green-950 dark:text-green-400"
        >
          <Icon icon={mdiCheck} size="14" />
          {$t('assistant_onboarding_connected')}
        </span>
      {:else if status === 'error' && errorMessage}
        <p role="alert" class="text-[13px] font-medium text-red-600 dark:text-red-400">{errorMessage}</p>
      {/if}
    </div>
  </div>
</div>
