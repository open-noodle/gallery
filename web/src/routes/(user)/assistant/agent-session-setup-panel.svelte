<script lang="ts">
  import { handleError } from '$lib/utils/handle-error';
  import { Button, Field, Icon, Input, Text, toastManager } from '@immich/ui';
  import { mdiInformationOutline } from '@mdi/js';
  import {
    AgentApprovalMode,
    AgentPermissionPreset,
    createAgentSession,
    validateAgentSession,
    type AgentProviderCredentialResponseDto,
    type AgentRunnerStatusDto,
    type AgentSessionResponseDto,
  } from '@immich/sdk';
  import { t } from 'svelte-i18n';
  import {
    DEFAULT_AGENT_APPROVAL_MODE,
    DEFAULT_AGENT_PERMISSION_PRESET,
    approvalModeOptions,
    getDefaultModel,
    getInitialCredentialId,
    permissionPresetOptions,
  } from './agent-session-ui';

  interface Props {
    runnerStatus: AgentRunnerStatusDto;
    credentials: AgentProviderCredentialResponseDto[];
    onSessionCreated: (session: AgentSessionResponseDto) => void;
    onAddCredentials?: () => void;
  }

  let { runnerStatus, credentials, onSessionCreated, onAddCredentials }: Props = $props();

  let selectedCredentialId = $state('');
  let model = $state('');
  let permissionPreset = $state(DEFAULT_AGENT_PERMISSION_PRESET);
  let approvalMode = $state(DEFAULT_AGENT_APPROVAL_MODE);
  let isCreating = $state(false);
  let isValidating = $state(false);
  let errorMessage = $state<string | null>(null);
  let activeHelp = $state<'permission' | 'approval' | null>(null);

  const selectedCredential = $derived(credentials.find((credential) => credential.id === selectedCredentialId));
  const selectedPermissionPresetOption = $derived(
    permissionPresetOptions.find((option) => option.value === permissionPreset) ?? permissionPresetOptions[0],
  );
  const selectedApprovalModeOption = $derived(
    approvalModeOptions.find((option) => option.value === approvalMode) ?? approvalModeOptions[0],
  );
  const isRunnerAvailable = $derived(runnerStatus.configured && runnerStatus.healthy);
  const canCreateSession = $derived(
    isRunnerAvailable && credentials.length > 0 && model.trim().length > 0 && !isCreating && !isValidating,
  );
  const disabledReason = $derived.by(() => {
    if (!runnerStatus.configured) {
      return 'assistant_runner_not_configured';
    }

    if (!runnerStatus.healthy) {
      return 'assistant_runner_unavailable';
    }

    if (credentials.length === 0) {
      return 'assistant_no_credentials_setup';
    }

    return null;
  });

  $effect(() => {
    if (credentials.some((credential) => credential.id === selectedCredentialId)) {
      return;
    }

    selectedCredentialId = getInitialCredentialId(credentials);
    model = getDefaultModel(credentials[0]);
  });

  const handleCredentialChange = (event: Event) => {
    const nextCredentialId = (event.currentTarget as HTMLSelectElement).value;
    const nextCredential = credentials.find((credential) => credential.id === nextCredentialId);
    selectedCredentialId = nextCredentialId;
    model = getDefaultModel(nextCredential);
  };

  const handlePermissionPresetChange = (event: Event) => {
    permissionPreset = (event.currentTarget as HTMLSelectElement).value as AgentPermissionPreset;
  };

  const handleApprovalModeChange = (event: Event) => {
    approvalMode = (event.currentTarget as HTMLSelectElement).value as AgentApprovalMode;
  };

  const toggleHelp = (help: 'permission' | 'approval') => {
    activeHelp = activeHelp === help ? null : help;
  };

  const handleSubmit = async () => {
    if (!canCreateSession || !selectedCredential) {
      return;
    }

    isValidating = true;
    errorMessage = null;

    try {
      const agentSessionCreateDto = {
        providerCredentialId: selectedCredential.id,
        model: model.trim(),
        permissionPreset,
        approvalMode,
      };

      await validateAgentSession({ agentSessionCreateDto });
      isValidating = false;
      isCreating = true;
      const session = await createAgentSession({
        agentSessionCreateDto,
      });

      toastManager.success($t('assistant_session_created'));
      onSessionCreated(session);
    } catch (error) {
      errorMessage = isValidating ? $t('assistant_session_validate_error') : $t('assistant_session_create_error');
      handleError(error, errorMessage);
    } finally {
      isValidating = false;
      isCreating = false;
    }
  };
</script>

<section
  class="mx-auto flex w-full max-w-3xl flex-col gap-5 px-4 pb-8 text-black dark:text-white md:px-8"
  aria-labelledby="assistant-session-setup-title"
>
  <div class="rounded-lg border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-immich-dark-gray">
    <div class="flex items-start justify-between gap-3">
      <h2 id="assistant-session-setup-title" class="text-lg font-semibold">{$t('assistant_session_setup')}</h2>
      {#if credentials.length > 0}
        <Button type="button" size="small" color="secondary" onclick={onAddCredentials}>
          {$t('assistant_manage_api_keys')}
        </Button>
      {/if}
    </div>

    {#if disabledReason}
      <Text size="small" color="muted" class="mt-2">{$t(disabledReason)}</Text>
    {/if}

    {#if credentials.length === 0}
      <div
        class="mt-5 rounded-lg border border-dashed border-gray-300 bg-gray-50 p-4 dark:border-gray-700 dark:bg-neutral-900"
      >
        <h3 class="text-base font-medium">{$t('assistant_credentials_empty_title')}</h3>
        <Text size="small" color="muted" class="mt-1">{$t('assistant_credentials_empty_description')}</Text>
        <div class="mt-4">
          <Button type="button" onclick={onAddCredentials}>{$t('assistant_add_api_key')}</Button>
        </div>
      </div>
    {/if}

    {#if errorMessage}
      <div class="mt-3 text-sm text-red-600 dark:text-red-400" role="alert">{errorMessage}</div>
    {/if}

    <form
      class="mt-5 grid gap-4"
      onsubmit={(event) => {
        event.preventDefault();
        void handleSubmit();
      }}
    >
      <Field label={$t('assistant_provider_credential')} disabled={credentials.length === 0}>
        <select
          id="assistant-provider-credential"
          aria-label={$t('assistant_provider_credential')}
          class="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-700 dark:bg-immich-dark-gray"
          value={selectedCredentialId}
          onchange={handleCredentialChange}
          disabled={credentials.length === 0 || isCreating || isValidating}
        >
          {#each credentials as credential (credential.id)}
            <option value={credential.id}>{credential.label}</option>
          {/each}
        </select>
      </Field>

      <Field label={$t('assistant_model')} required disabled={credentials.length === 0}>
        <Input
          id="assistant-model"
          aria-label={$t('assistant_model')}
          bind:value={model}
          list={selectedCredential?.models.length ? 'assistant-model-options' : undefined}
          disabled={credentials.length === 0 || isCreating || isValidating}
          autocomplete="off"
        />
        {#if selectedCredential?.models.length}
          <datalist id="assistant-model-options">
            {#each selectedCredential.models as option (option)}
              <option value={option}></option>
            {/each}
          </datalist>
        {/if}
      </Field>

      <div class="grid gap-2">
        <div class="flex items-center gap-1.5">
          <label class="text-sm font-medium" for="assistant-permission-preset"
            >{$t('assistant_permission_preset')}</label
          >
          <button
            type="button"
            class="inline-flex h-5 w-5 items-center justify-center rounded-full text-gray-500 hover:bg-gray-100 hover:text-black dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-white"
            aria-label={$t('assistant_permission_preset_help')}
            aria-expanded={activeHelp === 'permission'}
            onclick={() => toggleHelp('permission')}
          >
            <Icon icon={mdiInformationOutline} size="16" />
          </button>
        </div>
        {#if activeHelp === 'permission'}
          <div
            class="rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm text-blue-950 dark:border-blue-900 dark:bg-blue-950 dark:text-blue-100"
          >
            <div class="font-medium">{$t(selectedPermissionPresetOption.labelKey)}</div>
            <div class="mt-1">{$t(selectedPermissionPresetOption.descriptionKey)}</div>
          </div>
        {/if}
        <select
          id="assistant-permission-preset"
          aria-label={$t('assistant_permission_preset')}
          class="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-700 dark:bg-immich-dark-gray"
          value={permissionPreset}
          onchange={handlePermissionPresetChange}
          disabled={isCreating || isValidating}
        >
          {#each permissionPresetOptions as option (option.value)}
            <option value={option.value}>{$t(option.labelKey)}</option>
          {/each}
        </select>
      </div>

      <div class="grid gap-2">
        <div class="flex items-center gap-1.5">
          <label class="text-sm font-medium" for="assistant-approval-mode">{$t('assistant_approval_mode')}</label>
          <button
            type="button"
            class="inline-flex h-5 w-5 items-center justify-center rounded-full text-gray-500 hover:bg-gray-100 hover:text-black dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-white"
            aria-label={$t('assistant_approval_mode_help')}
            aria-expanded={activeHelp === 'approval'}
            onclick={() => toggleHelp('approval')}
          >
            <Icon icon={mdiInformationOutline} size="16" />
          </button>
        </div>
        {#if activeHelp === 'approval'}
          <div
            class="rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm text-blue-950 dark:border-blue-900 dark:bg-blue-950 dark:text-blue-100"
          >
            <div class="font-medium">{$t(selectedApprovalModeOption.labelKey)}</div>
            <div class="mt-1">{$t(selectedApprovalModeOption.descriptionKey)}</div>
          </div>
        {/if}
        <select
          id="assistant-approval-mode"
          aria-label={$t('assistant_approval_mode')}
          class="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-700 dark:bg-immich-dark-gray"
          value={approvalMode}
          onchange={handleApprovalModeChange}
          disabled={isCreating || isValidating}
        >
          {#each approvalModeOptions as option (option.value)}
            <option value={option.value}>{$t(option.labelKey)}</option>
          {/each}
        </select>
      </div>

      <div>
        <Button type="submit" disabled={!canCreateSession} loading={isCreating || isValidating}>
          {isValidating ? $t('assistant_validating_session') : $t('assistant_start_session')}
        </Button>
      </div>
    </form>
  </div>
</section>
