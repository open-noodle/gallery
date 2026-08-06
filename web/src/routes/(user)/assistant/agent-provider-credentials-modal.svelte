<script lang="ts">
  import { handleError } from '$lib/utils/handle-error';
  import { Button, Field, Icon, Input, Text, toastManager } from '@immich/ui';
  import {
    createAgentProviderCredential,
    deleteAgentProviderCredential,
    getAgentProviderCredentials,
    ProviderType,
    updateAgentProviderCredential,
    type AgentProviderCredentialResponseDto,
  } from '@immich/sdk';
  import { mdiEyeOffOutline, mdiEyeOutline, mdiTrashCanOutline } from '@mdi/js';
  import { t } from 'svelte-i18n';

  interface Props {
    open: boolean;
    credentials: AgentProviderCredentialResponseDto[];
    onClose?: () => void;
    onCredentialsChanged: (credentials: AgentProviderCredentialResponseDto[]) => void;
    embedded?: boolean;
    initialAddFormOpen?: boolean;
  }

  let {
    open,
    credentials,
    onClose = () => {},
    onCredentialsChanged,
    embedded = false,
    initialAddFormOpen = false,
  }: Props = $props();

  type ProviderOption = ProviderType | 'ollama';
  const OLLAMA_SECRET_PLACEHOLDER = 'ollama';
  const OLLAMA_DEFAULT_BASE_URL = 'http://localhost:11434/v1';

  let providerOption = $state<ProviderOption>(ProviderType.Openai);
  let providerType = $state<ProviderType>(ProviderType.Openai);
  let label = $state('');
  let secret = $state('');
  let baseUrl = $state('');
  let modelsText = $state('');
  let defaultModel = $state('');
  let isSaving = $state(false);
  let updatingCredentialId = $state<string | null>(null);
  let deletingCredentialId = $state<string | null>(null);
  let confirmingDeleteCredentialId = $state<string | null>(null);
  let editingModelsCredentialId = $state<string | null>(null);
  let addFormOpen = $state(false);
  let wasOpen = false;
  let errorMessage = $state<string | null>(null);
  let revealedCredentialIds = $state<Record<string, boolean>>({});
  let visibleSecretByCredentialId = $state<Record<string, string>>({});
  let modelDraftByCredentialId = $state<Record<string, string>>({});
  let defaultModelDraftByCredentialId = $state<Record<string, string>>({});

  const isOpenAiCompatible = $derived(providerType === ProviderType.OpenaiCompatible);
  const isOllama = $derived(providerOption === 'ollama');
  const requiredSecret = $derived(isOllama ? OLLAMA_SECRET_PLACEHOLDER : secret.trim());
  const canSave = $derived(
    label.trim().length > 0 &&
      requiredSecret.length > 0 &&
      (!isOpenAiCompatible || baseUrl.trim().length > 0) &&
      !isSaving,
  );

  const uniqueModels = (models: string[]) => [...new Set(models)];

  const parseModels = () =>
    uniqueModels(
      modelsText
        .split(',')
        .map((model) => model.trim())
        .filter(Boolean),
    );

  const parseModelDraft = (credentialId: string) =>
    uniqueModels(
      (modelDraftByCredentialId[credentialId] ?? '')
        .split(',')
        .map((model) => model.trim())
        .filter(Boolean),
    );

  const resetForm = () => {
    providerOption = ProviderType.Openai;
    providerType = ProviderType.Openai;
    label = '';
    secret = '';
    baseUrl = '';
    modelsText = '';
    defaultModel = '';
    addFormOpen = false;
  };

  const toggleCredentialSecret = (credentialId: string) => {
    revealedCredentialIds = { ...revealedCredentialIds, [credentialId]: !revealedCredentialIds[credentialId] };
  };

  const handleProviderOptionChange = (event: Event) => {
    providerOption = (event.currentTarget as HTMLSelectElement).value as ProviderOption;

    if (providerOption === 'ollama') {
      providerType = ProviderType.OpenaiCompatible;
      label = label.trim() || 'Ollama';
      baseUrl = baseUrl.trim() || OLLAMA_DEFAULT_BASE_URL;
      return;
    }

    providerType = providerOption;
  };

  const handleSubmit = async () => {
    if (!canSave) {
      return;
    }

    isSaving = true;
    errorMessage = null;

    try {
      const createdCredential = await createAgentProviderCredential({
        agentProviderCredentialCreateDto: {
          providerType,
          label: label.trim(),
          secret: requiredSecret,
          baseUrl: baseUrl.trim() || undefined,
          models: parseModels(),
          defaultModel: defaultModel.trim() || undefined,
        },
      });
      const nextCredentials = await getAgentProviderCredentials();

      visibleSecretByCredentialId = isOllama
        ? visibleSecretByCredentialId
        : { ...visibleSecretByCredentialId, [createdCredential.id]: requiredSecret };
      onCredentialsChanged(nextCredentials);
      resetForm();
      toastManager.success($t('assistant_api_key_saved'));
    } catch (error) {
      errorMessage = $t('assistant_api_key_save_error');
      handleError(error, errorMessage);
    } finally {
      isSaving = false;
    }
  };

  const saveCredentialModels = async (credential: AgentProviderCredentialResponseDto) => {
    const models = parseModelDraft(credential.id);
    const selectedDefaultModel = (defaultModelDraftByCredentialId[credential.id] ?? '').trim();
    const nextDefaultModel =
      selectedDefaultModel && (models.length === 0 || models.includes(selectedDefaultModel))
        ? selectedDefaultModel
        : (models[0] ?? null);
    updatingCredentialId = credential.id;
    errorMessage = null;

    try {
      await updateAgentProviderCredential({
        id: credential.id,
        agentProviderCredentialUpdateDto: {
          models,
          defaultModel: nextDefaultModel,
        },
      });
      onCredentialsChanged(await getAgentProviderCredentials());
      editingModelsCredentialId = null;
      toastManager.success($t('assistant_api_key_models_saved'));
    } catch (error) {
      errorMessage = $t('assistant_api_key_models_save_error');
      handleError(error, errorMessage);
    } finally {
      updatingCredentialId = null;
    }
  };

  const deleteCredential = async (credential: AgentProviderCredentialResponseDto) => {
    deletingCredentialId = credential.id;
    errorMessage = null;

    try {
      await deleteAgentProviderCredential({ id: credential.id });
      const nextCredentials = await getAgentProviderCredentials();

      onCredentialsChanged(nextCredentials);
      confirmingDeleteCredentialId = null;
      editingModelsCredentialId = editingModelsCredentialId === credential.id ? null : editingModelsCredentialId;
      const nextVisibleSecrets = { ...visibleSecretByCredentialId };
      const nextRevealedIds = { ...revealedCredentialIds };
      const nextModelDrafts = { ...modelDraftByCredentialId };
      const nextDefaultModelDrafts = { ...defaultModelDraftByCredentialId };
      delete nextVisibleSecrets[credential.id];
      delete nextRevealedIds[credential.id];
      delete nextModelDrafts[credential.id];
      delete nextDefaultModelDrafts[credential.id];
      visibleSecretByCredentialId = nextVisibleSecrets;
      revealedCredentialIds = nextRevealedIds;
      modelDraftByCredentialId = nextModelDrafts;
      defaultModelDraftByCredentialId = nextDefaultModelDrafts;
      toastManager.success($t('assistant_api_key_deleted'));
    } catch (error) {
      errorMessage = $t('assistant_api_key_delete_error');
      handleError(error, errorMessage);
    } finally {
      deletingCredentialId = null;
    }
  };

  $effect(() => {
    if (open && !wasOpen && initialAddFormOpen) {
      addFormOpen = true;
    }
    wasOpen = open;
  });

  $effect(() => {
    const nextDrafts = { ...modelDraftByCredentialId };
    const nextDefaultDrafts = { ...defaultModelDraftByCredentialId };
    let changed = false;

    for (const credential of credentials) {
      if (!(credential.id in nextDrafts)) {
        nextDrafts[credential.id] = credential.models.join(', ');
        changed = true;
      }

      if (!(credential.id in nextDefaultDrafts)) {
        nextDefaultDrafts[credential.id] = credential.defaultModel ?? '';
        changed = true;
      }
    }

    if (changed) {
      modelDraftByCredentialId = nextDrafts;
      defaultModelDraftByCredentialId = nextDefaultDrafts;
    }
  });
</script>

{#if open}
  {#if !embedded}
    <div class="fixed inset-0 z-[60] bg-black/55" role="presentation" onclick={onClose}></div>
  {/if}
  <div
    class={embedded
      ? 'mt-4 border-t border-gray-200 pt-4 dark:border-neutral-800'
      : 'fixed left-1/2 top-1/2 z-[60] flex max-h-[calc(100vh-2rem)] w-[min(46rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-xl border border-gray-200 bg-white text-black shadow-2xl dark:border-neutral-800 dark:bg-neutral-950 dark:text-white'}
    role={embedded ? undefined : 'dialog'}
    aria-modal={embedded ? undefined : 'true'}
    aria-labelledby={embedded ? undefined : 'assistant-api-keys-title'}
  >
    {#if !embedded}
      <div class="flex items-start justify-between gap-4 border-b border-gray-200 px-5 py-4 dark:border-neutral-800">
        <div>
          <h2 id="assistant-api-keys-title" class="text-lg font-semibold">{$t('assistant_api_keys')}</h2>
          <Text size="small" color="muted">{$t('assistant_api_keys_description')}</Text>
        </div>
        <button
          type="button"
          class="rounded-md px-2 py-1 text-xl leading-none text-gray-500 hover:bg-gray-100 hover:text-black dark:text-neutral-400 dark:hover:bg-neutral-900 dark:hover:text-white"
          aria-label={$t('close')}
          onclick={onClose}
        >
          &times;
        </button>
      </div>
    {/if}

    <div class={embedded ? '' : 'min-h-0 overflow-y-auto px-5 py-5'}>
      <section aria-labelledby="assistant-existing-api-keys-title">
        <h3
          id="assistant-existing-api-keys-title"
          class="text-sm font-semibold uppercase text-gray-500 dark:text-neutral-400"
        >
          {$t('assistant_existing_api_keys')}
        </h3>

        {#if credentials.length === 0}
          <Text size="small" color="muted" class="mt-3">{$t('assistant_no_api_keys')}</Text>
        {:else}
          <div class="mt-3 grid gap-2">
            {#each credentials as credential (credential.id)}
              {@const isRevealed = Boolean(revealedCredentialIds[credential.id])}
              {@const isEditingModels = editingModelsCredentialId === credential.id}
              <div
                class="rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 dark:border-neutral-800 dark:bg-neutral-900/60"
              >
                <div class="min-w-0">
                  <div class="flex items-start justify-between gap-3">
                    <div class="min-w-0">
                      <div class="truncate font-medium">{credential.label}</div>
                      <div class="mt-1 truncate text-sm text-gray-500 dark:text-neutral-400">
                        {credential.providerType}
                        {#if credential.baseUrl}
                          · {credential.baseUrl}
                        {/if}
                      </div>
                    </div>
                    <div class="flex shrink-0 items-center gap-1">
                      <button
                        type="button"
                        class="inline-flex h-8 w-8 items-center justify-center rounded-md text-gray-600 hover:bg-gray-100 hover:text-black dark:text-neutral-300 dark:hover:bg-neutral-800 dark:hover:text-white"
                        aria-label={isRevealed ? $t('assistant_hide_api_key') : $t('assistant_show_api_key')}
                        onclick={() => toggleCredentialSecret(credential.id)}
                      >
                        <Icon icon={isRevealed ? mdiEyeOffOutline : mdiEyeOutline} size="18" />
                      </button>
                      <Button
                        type="button"
                        size="small"
                        color="secondary"
                        onclick={() => (editingModelsCredentialId = isEditingModels ? null : credential.id)}
                      >
                        {isEditingModels ? $t('cancel') : $t('assistant_edit_models')}
                      </Button>
                      <button
                        type="button"
                        class="inline-flex h-8 w-8 items-center justify-center rounded-md text-gray-500 hover:bg-red-50 hover:text-red-700 disabled:cursor-not-allowed disabled:opacity-60 dark:text-neutral-400 dark:hover:bg-red-950 dark:hover:text-red-200"
                        aria-label={$t('assistant_delete_api_key')}
                        disabled={deletingCredentialId === credential.id}
                        onclick={() => (confirmingDeleteCredentialId = credential.id)}
                      >
                        <Icon icon={mdiTrashCanOutline} size="18" />
                      </button>
                    </div>
                  </div>

                  <div class="mt-3 flex flex-wrap items-center gap-2">
                    <span
                      class="rounded-md bg-white px-2 py-1 font-mono text-xs text-gray-600 ring-1 ring-gray-200 dark:bg-black dark:text-neutral-300 dark:ring-neutral-800"
                      data-testid={`agent-api-key-secret-${credential.id}`}
                    >
                      {#if isRevealed}
                        {visibleSecretByCredentialId[credential.id] ?? $t('assistant_secret_not_retrievable')}
                      {:else}
                        {$t('assistant_api_key_masked')}
                      {/if}
                    </span>
                    {#if credential.defaultModel}
                      <span
                        class="rounded-md bg-blue-50 px-2 py-1 text-xs text-blue-700 dark:bg-blue-950 dark:text-blue-200"
                      >
                        {$t('assistant_default_model')}: {credential.defaultModel}
                      </span>
                    {/if}
                    {#each credential.models.slice(0, 4) as model (model)}
                      <span
                        class="rounded-md bg-white px-2 py-1 text-xs text-gray-700 ring-1 ring-gray-200 dark:bg-black dark:text-neutral-200 dark:ring-neutral-800"
                      >
                        {model}
                      </span>
                    {/each}
                    {#if credential.models.length > 4}
                      <span class="text-xs text-gray-500 dark:text-neutral-400">+{credential.models.length - 4}</span>
                    {/if}
                  </div>

                  {#if isEditingModels}
                    {@const draftModels = parseModelDraft(credential.id)}
                    <div class="mt-4 grid gap-2 border-t border-gray-200 pt-3 dark:border-neutral-800">
                      <label
                        class="text-xs font-medium uppercase text-gray-500 dark:text-neutral-400"
                        for={`assistant-models-${credential.id}`}
                      >
                        {$t('assistant_api_key_models')}
                      </label>
                      <Input
                        id={`assistant-models-${credential.id}`}
                        aria-label={`${credential.label} ${$t('assistant_api_key_models')}`}
                        value={modelDraftByCredentialId[credential.id] ?? ''}
                        oninput={(event) =>
                          (modelDraftByCredentialId = {
                            ...modelDraftByCredentialId,
                            [credential.id]: (event.currentTarget as HTMLInputElement).value,
                          })}
                        placeholder="gpt-5.1, gpt-5.2"
                        autocomplete="off"
                        disabled={updatingCredentialId === credential.id}
                      />
                      <label
                        class="text-xs font-medium uppercase text-gray-500 dark:text-neutral-400"
                        for={`assistant-default-model-${credential.id}`}
                      >
                        {$t('assistant_api_key_default_model')}
                      </label>
                      <select
                        id={`assistant-default-model-${credential.id}`}
                        aria-label={`${credential.label} ${$t('assistant_api_key_default_model')}`}
                        class="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-700 dark:bg-neutral-950"
                        value={defaultModelDraftByCredentialId[credential.id] ?? ''}
                        disabled={updatingCredentialId === credential.id}
                        onchange={(event) =>
                          (defaultModelDraftByCredentialId = {
                            ...defaultModelDraftByCredentialId,
                            [credential.id]: (event.currentTarget as HTMLSelectElement).value,
                          })}
                      >
                        <option value="">{$t('assistant_default_model')}</option>
                        {#each draftModels as model (model)}
                          <option value={model}>{model}</option>
                        {/each}
                      </select>
                      <div class="flex items-center justify-between gap-3">
                        <Text size="small" color="muted">{$t('assistant_api_key_models_hint')}</Text>
                        <Button
                          type="button"
                          size="small"
                          disabled={updatingCredentialId !== null}
                          loading={updatingCredentialId === credential.id}
                          onclick={() => saveCredentialModels(credential)}
                        >
                          {$t('save')}
                        </Button>
                      </div>
                    </div>
                  {/if}

                  {#if confirmingDeleteCredentialId === credential.id}
                    <div
                      class="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-900 dark:border-red-900 dark:bg-red-950 dark:text-red-100"
                      role="alert"
                    >
                      <div class="font-medium">{$t('assistant_delete_api_key_confirm_title')}</div>
                      <div class="mt-1 text-red-700 dark:text-red-200">
                        {$t('assistant_delete_api_key_confirm_description', { values: { label: credential.label } })}
                      </div>
                      <div class="mt-3 flex justify-end gap-2">
                        <Button
                          type="button"
                          size="small"
                          color="secondary"
                          disabled={deletingCredentialId === credential.id}
                          onclick={() => (confirmingDeleteCredentialId = null)}
                        >
                          {$t('cancel')}
                        </Button>
                        <Button
                          type="button"
                          size="small"
                          color="danger"
                          loading={deletingCredentialId === credential.id}
                          disabled={deletingCredentialId !== null}
                          onclick={() => deleteCredential(credential)}
                        >
                          {$t('delete')}
                        </Button>
                      </div>
                    </div>
                  {/if}
                </div>
              </div>
            {/each}
          </div>
        {/if}
      </section>

      <section
        class="mt-6 border-t border-gray-200 pt-5 dark:border-neutral-800"
        aria-labelledby="assistant-add-api-key-title"
      >
        <div class="flex items-center justify-between gap-3">
          <h3 id="assistant-add-api-key-title" class="text-base font-semibold">{$t('assistant_add_api_key')}</h3>
          {#if !addFormOpen}
            <Button type="button" size="small" onclick={() => (addFormOpen = true)}
              >{$t('assistant_add_api_key')}</Button
            >
          {/if}
        </div>

        {#if errorMessage}
          <div class="mt-3 text-sm text-red-600 dark:text-red-400" role="alert">{errorMessage}</div>
        {/if}

        {#if addFormOpen}
          <form
            class="mt-4 grid gap-4 rounded-lg border border-gray-200 bg-gray-50 p-4 dark:border-neutral-800 dark:bg-neutral-900/60"
            onsubmit={(event) => {
              event.preventDefault();
              void handleSubmit();
            }}
          >
            <Field label={$t('assistant_provider_type')}>
              <select
                id="assistant-provider-type"
                aria-label={$t('assistant_provider_type')}
                class="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-700 dark:bg-neutral-950"
                value={providerOption}
                onchange={handleProviderOptionChange}
                disabled={isSaving}
              >
                <option value={ProviderType.Openai}>OpenAI</option>
                <option value={ProviderType.Anthropic}>Anthropic</option>
                <option value="ollama">Ollama</option>
                <option value={ProviderType.OpenaiCompatible}>OpenAI compatible</option>
              </select>
            </Field>

            <Field label={$t('assistant_api_key_label')} required>
              <Input
                bind:value={label}
                aria-label={$t('assistant_api_key_label')}
                autocomplete="off"
                disabled={isSaving}
              />
            </Field>

            {#if !isOllama}
              <Field label={$t('assistant_api_key_secret')} required>
                <Input
                  type="password"
                  bind:value={secret}
                  aria-label={$t('assistant_api_key_secret')}
                  autocomplete="off"
                  disabled={isSaving}
                />
              </Field>
            {:else}
              <Text size="small" color="muted">{$t('assistant_ollama_no_api_key')}</Text>
            {/if}

            <Field label={$t('assistant_api_key_base_url')} required={isOpenAiCompatible}>
              <Input
                bind:value={baseUrl}
                aria-label={$t('assistant_api_key_base_url')}
                placeholder={isOllama ? OLLAMA_DEFAULT_BASE_URL : 'https://api.example.com/v1'}
                autocomplete="off"
                disabled={isSaving}
              />
            </Field>

            <Field label={$t('assistant_api_key_models')}>
              <Input
                bind:value={modelsText}
                aria-label={$t('assistant_api_key_models')}
                placeholder="gpt-5.1, gpt-5.2, gpt-5.2-mini"
                autocomplete="off"
                disabled={isSaving}
              />
              <Text size="small" color="muted">{$t('assistant_api_key_models_hint')}</Text>
            </Field>

            <Field label={$t('assistant_api_key_default_model')}>
              <Input
                bind:value={defaultModel}
                aria-label={$t('assistant_api_key_default_model')}
                placeholder="gpt-5.2"
                autocomplete="off"
                disabled={isSaving}
              />
            </Field>

            <div class="flex justify-end gap-2">
              <Button type="button" color="secondary" onclick={() => (addFormOpen = false)} disabled={isSaving}>
                {$t('cancel')}
              </Button>
              <Button type="submit" disabled={!canSave} loading={isSaving}>{$t('assistant_save_api_key')}</Button>
            </div>
          </form>
        {:else}
          <Text size="small" color="muted" class="mt-2">{$t('assistant_add_api_key_collapsed_hint')}</Text>
        {/if}
      </section>
    </div>
  </div>
{/if}
