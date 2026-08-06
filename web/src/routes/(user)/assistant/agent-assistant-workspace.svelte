<script lang="ts">
  import { goto } from '$app/navigation';
  import { handleError } from '$lib/utils/handle-error';
  import {
    AgentApprovalMode,
    AgentMessageTextBlockType,
    AgentPermissionPreset,
    appendAgentSessionMessage,
    createAgentSession,
    deleteAgentSession,
    getAgentProviderCredentials,
    getAgentSessions,
    validateAgentSession,
    type AgentMessageResponseDto,
    type AgentProviderCredentialResponseDto,
    type AgentRunnerStatusDto,
    type AgentSessionResponseDto,
    updateAgentSession,
  } from '@immich/sdk';
  import { Button, Icon } from '@immich/ui';
  import { mdiAlertCircleOutline, mdiDockLeft, mdiDotsHorizontal, mdiInformationOutline, mdiPlus } from '@mdi/js';
  import { t } from 'svelte-i18n';
  import AgentConversationPane from './agent-conversation-pane.svelte';
  import AgentOnboarding from './agent-onboarding.svelte';
  import AgentProviderCredentialsModal from './agent-provider-credentials-modal.svelte';
  import AgentSessionSidebar from './agent-session-sidebar.svelte';
  import {
    DEFAULT_AGENT_APPROVAL_MODE,
    DEFAULT_AGENT_PERMISSION_PRESET,
    approvalModeOptions,
    assistantSettingsApprovalModeOptions,
    getDefaultModel,
    permissionPresetOptions,
  } from './agent-session-ui';
  import {
    type AgentSessionTitleCache,
    getAgentSessionStatusLabelKey,
    getAgentSessionTitle,
    selectInitialAgentSessionId,
  } from './agent-session-workspace-ui';

  interface Props {
    runnerStatus: AgentRunnerStatusDto;
    credentials: AgentProviderCredentialResponseDto[];
    sessions: AgentSessionResponseDto[];
    requestedSessionId: string | null;
  }

  let { runnerStatus, credentials, sessions, requestedSessionId }: Props = $props();
  const getInitialCredentials = () => credentials;
  const getInitialSessions = () => sessions;
  const getInitialRequestedSessionId = () => requestedSessionId;
  const getInitialSelectedSessionId = () =>
    selectInitialAgentSessionId(getInitialSessions(), getInitialRequestedSessionId());
  const getInitialShouldReplaceSessionUrl = () => {
    const initialRequestedSessionId = getInitialRequestedSessionId()?.trim() ?? '';
    const initialSelectedSessionId = getInitialSelectedSessionId();
    return initialRequestedSessionId.length > 0 && initialSelectedSessionId !== initialRequestedSessionId;
  };

  let sidebarOpen = $state(false);
  let localSessions = $state<AgentSessionResponseDto[]>(getInitialSessions());
  let localCredentials = $state<AgentProviderCredentialResponseDto[]>(getInitialCredentials());
  let selectedSessionId = $state<string | null>(getInitialSelectedSessionId());
  let lastRequestedSessionId = $state(getInitialRequestedSessionId());
  let syncedFallbackSessionId = $state<string | null>(null);
  let shouldReplaceSelectedSessionUrl = $state(getInitialShouldReplaceSessionUrl());
  let titleBySessionId = $state<AgentSessionTitleCache>({});
  let sidebarCollapsed = $state(false);
  let credentialsModalOpen = $state(false);
  let assistantSettingsOpen = $state(false);
  let modelSettingsExpanded = $state(false);
  let apiKeysExpanded = $state(false);
  let apiKeysInitialAddFormOpen = $state(false);
  let assistantControlExpanded = $state(false);
  let newChatDraft = $state('');
  let newChatError = $state<string | null>(null);
  let isStartingFromMessage = $state(false);
  let startingFromMessageSessionId = $state<string | null>(null);
  let sentMessageBySessionId = $state<Record<string, AgentMessageResponseDto>>({});
  let assistantPermissionPreset = $state<AgentPermissionPreset>(DEFAULT_AGENT_PERMISSION_PRESET);
  let assistantApprovalMode = $state<AgentApprovalMode>(DEFAULT_AGENT_APPROVAL_MODE);
  let assistantCredentialId = $state<string | null>(null);
  let assistantModel = $state('');
  let runnerDetailsOpen = $state(false);
  let assistantDefaultsInitialized = false;
  let explicitNewChatPending = false;
  const defaultsStorageKey = 'gallery.assistant.defaults';

  const selectedSession = $derived(localSessions.find((session) => session.id === selectedSessionId) ?? null);
  const selectedTitle = $derived(
    selectedSession ? getAgentSessionTitle(selectedSession, titleBySessionId) : $t('assistant_new_chat'),
  );
  const isRunnerAvailable = $derived(runnerStatus.configured && runnerStatus.healthy);
  // First-run setup: onboarding replaces the chat surface, so hide the chat chrome (sidebar + settings menu).
  const onboardingActive = $derived(isRunnerAvailable && localCredentials.length === 0);
  const runnerStatusLabel = $derived($t('assistant_unavailable_banner'));
  const canSendNewChat = $derived(
    newChatDraft.trim().length > 0 && !isStartingFromMessage && isRunnerAvailable && localCredentials.length > 0,
  );
  const selectedAssistantCredential = $derived(
    localCredentials.find((credential) => credential.id === assistantCredentialId) ?? localCredentials[0] ?? null,
  );
  const selectedAssistantModel = $derived(
    selectedAssistantCredential ? getValidModelForCredential(selectedAssistantCredential, assistantModel) : '',
  );
  const selectedPermissionPresetOption = $derived(
    permissionPresetOptions.find((option) => option.value === assistantPermissionPreset) ?? permissionPresetOptions[0],
  );
  const selectedApprovalModeOption = $derived(
    assistantSettingsApprovalModeOptions.find((option) => option.value === assistantApprovalMode) ??
      assistantSettingsApprovalModeOptions[0],
  );
  const modelSettingsSummary = $derived(
    selectedAssistantCredential
      ? $t('assistant_model_settings_summary', {
          values: { credential: selectedAssistantCredential.label, model: selectedAssistantModel },
        })
      : $t('assistant_no_credentials_setup'),
  );
  const assistantControlSummary = $derived(
    `${$t(selectedPermissionPresetOption.labelKey)} · ${$t(selectedApprovalModeOption.labelKey)}`,
  );

  const isPermissionPreset = (value: unknown): value is AgentPermissionPreset =>
    permissionPresetOptions.some((option) => option.value === value);

  const isApprovalMode = (value: unknown): value is AgentApprovalMode =>
    approvalModeOptions.some((option) => option.value === value);

  const isAssistantSettingsApprovalMode = (value: unknown): value is AgentApprovalMode =>
    assistantSettingsApprovalModeOptions.some((option) => option.value === value);

  const primaryApprovalModeOptions = assistantSettingsApprovalModeOptions;
  const readStoredAssistantDefaults = () => {
    try {
      return JSON.parse(localStorage.getItem(defaultsStorageKey) ?? '{}') as Partial<{
        credentialId: string;
        model: string;
        permissionPreset: string;
        approvalMode: string;
      }>;
    } catch {
      return {};
    }
  };

  function getValidModelForCredential(credential: AgentProviderCredentialResponseDto, preferredModel: string) {
    const trimmedPreferredModel = preferredModel.trim();

    if (credential.models.length === 0) {
      return trimmedPreferredModel || credential.defaultModel || '';
    }

    if (trimmedPreferredModel && credential.models.includes(trimmedPreferredModel)) {
      return trimmedPreferredModel;
    }

    return getDefaultModel(credential);
  }

  const readAssistantDefaults = () => {
    const parsed = readStoredAssistantDefaults();
    const credential =
      selectedAssistantCredential ??
      localCredentials.find((candidate) => candidate.id === parsed.credentialId) ??
      localCredentials[0];
    return {
      credential,
      model: credential ? selectedAssistantModel || getValidModelForCredential(credential, parsed.model ?? '') : '',
      permissionPreset: isPermissionPreset(parsed.permissionPreset)
        ? parsed.permissionPreset
        : assistantPermissionPreset,
      approvalMode: isAssistantSettingsApprovalMode(parsed.approvalMode) ? parsed.approvalMode : assistantApprovalMode,
    };
  };

  const persistAssistantDefaults = (partialDefaults: {
    credentialId?: string;
    model?: string;
    permissionPreset?: AgentPermissionPreset;
    approvalMode?: AgentApprovalMode;
  }) => {
    try {
      localStorage.setItem(
        defaultsStorageKey,
        JSON.stringify({
          ...readStoredAssistantDefaults(),
          ...partialDefaults,
        }),
      );
    } catch {
      // localStorage can be unavailable in private or embedded contexts.
    }
  };

  const writeAssistantDefaults = (session: AgentSessionResponseDto) => {
    assistantPermissionPreset = session.permissionPreset;
    assistantApprovalMode = session.approvalMode;
    assistantCredentialId = session.providerCredentialId ?? null;
    assistantModel = session.modelSnapshot.model;
    persistAssistantDefaults({
      credentialId: session.providerCredentialId ?? undefined,
      model: session.modelSnapshot.model,
      permissionPreset: session.permissionPreset,
      approvalMode: session.approvalMode,
    });
  };

  const handlePermissionPresetChange = (event: Event) => {
    const nextPermissionPreset = (event.currentTarget as HTMLSelectElement).value;
    if (!isPermissionPreset(nextPermissionPreset)) {
      return;
    }

    assistantPermissionPreset = nextPermissionPreset;
    persistAssistantDefaults({ permissionPreset: nextPermissionPreset });
  };

  const handleApprovalModeChange = (event: Event) => {
    const nextApprovalMode = (event.currentTarget as HTMLSelectElement).value;
    if (!isApprovalMode(nextApprovalMode)) {
      return;
    }

    assistantApprovalMode = nextApprovalMode;
    persistAssistantDefaults({ approvalMode: nextApprovalMode });
  };

  const handleAssistantCredentialChange = (event: Event) => {
    const nextCredentialId = (event.currentTarget as HTMLSelectElement).value;
    const nextCredential = localCredentials.find((credential) => credential.id === nextCredentialId) ?? null;
    assistantCredentialId = nextCredential?.id ?? null;
    assistantModel = nextCredential ? getDefaultModel(nextCredential) : '';
    persistAssistantDefaults({ credentialId: assistantCredentialId ?? undefined, model: assistantModel });
  };

  const handleAssistantModelChange = (event: Event) => {
    const nextModel = (event.currentTarget as HTMLInputElement | HTMLSelectElement).value;
    if (!selectedAssistantCredential) {
      return;
    }

    assistantModel = getValidModelForCredential(selectedAssistantCredential, nextModel);
    persistAssistantDefaults({ credentialId: selectedAssistantCredential.id, model: assistantModel });
  };

  const toggleApiKeySettings = () => {
    apiKeysInitialAddFormOpen = !apiKeysExpanded && localCredentials.length === 0;
    apiKeysExpanded = !apiKeysExpanded;
  };

  $effect(() => {
    if (assistantDefaultsInitialized) {
      return;
    }

    assistantDefaultsInitialized = true;
    const storedDefaults = readStoredAssistantDefaults();
    if (isPermissionPreset(storedDefaults.permissionPreset)) {
      assistantPermissionPreset = storedDefaults.permissionPreset;
    }
    if (isAssistantSettingsApprovalMode(storedDefaults.approvalMode)) {
      assistantApprovalMode = storedDefaults.approvalMode;
    }
    const storedCredential =
      localCredentials.find((credential) => credential.id === storedDefaults.credentialId) ??
      localCredentials[0] ??
      null;
    assistantCredentialId = storedCredential?.id ?? null;
    assistantModel = storedCredential ? getValidModelForCredential(storedCredential, storedDefaults.model ?? '') : '';
  });

  $effect(() => {
    const nextCredential =
      localCredentials.find((credential) => credential.id === assistantCredentialId) ?? localCredentials[0] ?? null;
    const nextCredentialId = nextCredential?.id ?? null;
    const nextModel = nextCredential ? getValidModelForCredential(nextCredential, assistantModel) : '';
    let changed = false;

    if (assistantCredentialId !== nextCredentialId) {
      assistantCredentialId = nextCredentialId;
      changed = true;
    }

    if (assistantModel !== nextModel) {
      assistantModel = nextModel;
      changed = true;
    }

    if (changed && nextCredential) {
      persistAssistantDefaults({ credentialId: nextCredential.id, model: nextModel });
    }
  });
  const buildAssistantPath = (sessionId: string | null) => {
    const url = new URL(globalThis.location.href);

    if (sessionId) {
      url.searchParams.set('session', sessionId);
    } else {
      url.searchParams.delete('session');
    }

    return `${url.pathname}${url.search}${url.hash}`;
  };

  const updateSessionUrl = async (sessionId: string | null, replaceState = false) => {
    await goto(buildAssistantPath(sessionId), { keepFocus: true, noScroll: true, replaceState });
  };

  const selectSession = (sessionId: string) => {
    explicitNewChatPending = false;
    shouldReplaceSelectedSessionUrl = false;
    selectedSessionId = sessionId;
    sidebarOpen = false;
    void updateSessionUrl(sessionId);
  };

  const startNewChat = () => {
    explicitNewChatPending = true;
    shouldReplaceSelectedSessionUrl = false;
    selectedSessionId = null;
    sidebarOpen = false;
    void updateSessionUrl(null);
  };

  const handleSessionCreated = (session: AgentSessionResponseDto) => {
    writeAssistantDefaults(session);
    explicitNewChatPending = false;
    localSessions = [session, ...localSessions.filter((existingSession) => existingSession.id !== session.id)];
    shouldReplaceSelectedSessionUrl = false;
    selectedSessionId = session.id;
    void updateSessionUrl(session.id);
  };

  const startSessionFromMessage = async () => {
    const text = newChatDraft.trim();
    if (!text || isStartingFromMessage) {
      return;
    }

    if (!isRunnerAvailable) {
      newChatError = $t('assistant_unavailable_banner');
      return;
    }

    if (localCredentials.length === 0) {
      credentialsModalOpen = true;
      return;
    }

    const defaults = readAssistantDefaults();
    if (!defaults.credential || !defaults.model) {
      credentialsModalOpen = true;
      return;
    }

    const agentSessionCreateDto = {
      providerCredentialId: defaults.credential.id,
      model: defaults.model,
      permissionPreset: defaults.permissionPreset,
      approvalMode: defaults.approvalMode,
    };

    isStartingFromMessage = true;
    newChatError = null;

    try {
      await validateAgentSession({ agentSessionCreateDto });
      const session = await createAgentSession({ agentSessionCreateDto });
      startingFromMessageSessionId = session.id;
      handleSessionCreated(session);
      const message = await appendAgentSessionMessage({
        id: session.id,
        agentMessageCreateDto: {
          content: {
            blocks: [{ type: AgentMessageTextBlockType.Text, text }],
          },
        },
      });
      sentMessageBySessionId = { ...sentMessageBySessionId, [session.id]: message };
      titleBySessionId = { ...titleBySessionId, [session.id]: text };
      void persistSessionTitle(session.id, text);
      newChatDraft = '';
    } catch (error) {
      newChatError = $t('assistant_session_create_error');
      handleError(error, newChatError);
    } finally {
      startingFromMessageSessionId = null;
      isStartingFromMessage = false;
    }
  };

  const handleNewChatComposerKeydown = (event: KeyboardEvent) => {
    if (
      event.key !== 'Enter' ||
      event.shiftKey ||
      event.ctrlKey ||
      event.altKey ||
      event.metaKey ||
      event.isComposing
    ) {
      return;
    }

    event.preventDefault();
    void startSessionFromMessage();
  };

  const handleTitleDiscovered = (sessionId: string, title: string) => {
    if (sessionId !== selectedSessionId || !localSessions.some((session) => session.id === sessionId)) {
      return;
    }

    titleBySessionId = { ...titleBySessionId, [sessionId]: title };
  };

  const handleSessionUpdated = (session: AgentSessionResponseDto) => {
    const existingSession = localSessions.find((candidate) => candidate.id === session.id);
    if (session.id !== selectedSessionId || !existingSession) {
      return;
    }

    // Periodic refreshes often return an unchanged session — keep the existing object so
    // downstream consumers (pane, drawer, header) see no identity churn.
    if (existingSession.status === session.status && existingSession.updatedAt === session.updatedAt) {
      return;
    }

    localSessions = localSessions.map((candidate) => (candidate.id === session.id ? session : candidate));
  };

  // Persist the first message as the session title so it survives reloads (best-effort:
  // the in-memory cache still covers this tab if the update fails).
  const persistSessionTitle = async (sessionId: string, text: string) => {
    const title = text.trim().slice(0, 120).trim();
    if (!title) {
      return;
    }
    try {
      const session = await updateAgentSession({ id: sessionId, agentSessionUpdateDto: { title } });
      localSessions = localSessions.map((existingSession) =>
        existingSession.id === session.id ? session : existingSession,
      );
    } catch {
      // Title just won't survive a reload; not worth surfacing as an error mid-send.
    }
  };

  const handleRenameSession = async (sessionId: string, title: string) => {
    const session = await updateAgentSession({ id: sessionId, agentSessionUpdateDto: { title } });
    localSessions = localSessions.map((existingSession) =>
      existingSession.id === session.id ? session : existingSession,
    );
    titleBySessionId = { ...titleBySessionId, [sessionId]: null };
  };

  const handleDeleteSession = async (sessionId: string) => {
    try {
      await deleteAgentSession({ id: sessionId });
    } catch (error) {
      const status = (error as { status?: number } | null)?.status;
      if (status !== 400 && status !== 404) {
        handleError(error, $t('assistant_session_delete_error'));
        return;
      }
      // Already gone server-side — treat as success so the row can never dangle.
    }

    localSessions = localSessions.filter((session) => session.id !== sessionId);

    if (selectedSessionId === sessionId) {
      selectedSessionId = null;
      void updateSessionUrl(null);
    }

    // Converge with the server: a delete can race other list updates, so the
    // authoritative list wins (skipped when it matches to avoid identity churn).
    try {
      const serverSessions = await getAgentSessions();
      if (Array.isArray(serverSessions) && !sessionListsEquivalent(serverSessions, localSessions)) {
        localSessions = serverSessions;
      }
    } catch {
      // The local removal above already applied; the next page load reconciles.
    }
  };

  const sessionListsEquivalent = (first: AgentSessionResponseDto[], second: AgentSessionResponseDto[]) =>
    first.length === second.length &&
    first.every(
      (session, index) =>
        session.id === second[index].id &&
        session.status === second[index].status &&
        session.updatedAt === second[index].updatedAt,
    );

  $effect(() => {
    if (requestedSessionId === lastRequestedSessionId) {
      return;
    }

    lastRequestedSessionId = requestedSessionId;

    if (explicitNewChatPending && !requestedSessionId?.trim()) {
      explicitNewChatPending = false;
      selectedSessionId = null;
      shouldReplaceSelectedSessionUrl = false;
      return;
    }

    explicitNewChatPending = false;
    selectedSessionId = selectInitialAgentSessionId(localSessions, requestedSessionId);
    const normalizedRequestedSessionId = requestedSessionId?.trim() ?? '';
    shouldReplaceSelectedSessionUrl =
      normalizedRequestedSessionId.length > 0 && selectedSessionId !== normalizedRequestedSessionId;
  });

  $effect(() => {
    if (!shouldReplaceSelectedSessionUrl) {
      return;
    }

    if (!selectedSessionId) {
      shouldReplaceSelectedSessionUrl = false;
      syncedFallbackSessionId = null;
      void updateSessionUrl(null, true);
      return;
    }

    if (syncedFallbackSessionId === selectedSessionId) {
      return;
    }

    shouldReplaceSelectedSessionUrl = false;
    syncedFallbackSessionId = selectedSessionId;
    void updateSessionUrl(selectedSessionId, true);
  });

  $effect(() => {
    if (isRunnerAvailable) {
      runnerDetailsOpen = false;
    }
  });

  const handleOnboardingComplete = async (result: {
    credentialId: string;
    model: string;
    permissionPreset: AgentPermissionPreset;
    approvalMode: AgentApprovalMode;
    initialPrompt?: string;
  }) => {
    localCredentials = await getAgentProviderCredentials();
    assistantCredentialId = result.credentialId;
    assistantModel = result.model;
    assistantPermissionPreset = result.permissionPreset;
    assistantApprovalMode = result.approvalMode;
    persistAssistantDefaults({
      credentialId: result.credentialId,
      model: result.model,
      permissionPreset: result.permissionPreset,
      approvalMode: result.approvalMode,
    });
    if (result.initialPrompt) {
      newChatDraft = result.initialPrompt;
    }
  };
</script>

<div class="relative flex h-full min-h-0 overflow-hidden bg-white text-black dark:bg-black dark:text-white">
  <AgentProviderCredentialsModal
    open={credentialsModalOpen}
    credentials={localCredentials}
    onClose={() => (credentialsModalOpen = false)}
    onCredentialsChanged={(nextCredentials) => (localCredentials = nextCredentials)}
  />

  {#if assistantSettingsOpen}
    <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4 py-6" role="presentation">
      <div
        class="max-h-full w-full max-w-3xl overflow-y-auto rounded-lg border border-gray-200 bg-white p-4 shadow-2xl dark:border-neutral-800 dark:bg-neutral-950"
        role="dialog"
        aria-modal="true"
        aria-labelledby="assistant-settings-title"
      >
        <div class="mb-4 flex items-center justify-between gap-4">
          <h2 id="assistant-settings-title" class="text-lg font-semibold">{$t('assistant_settings')}</h2>
          <Button type="button" size="small" color="secondary" onclick={() => (assistantSettingsOpen = false)}>
            {$t('close')}
          </Button>
        </div>
        <div class="grid gap-3">
          <section class="rounded-lg border border-gray-200 p-4 dark:border-neutral-800">
            <div class="flex items-center justify-between gap-4">
              <div class="min-w-0">
                <h3 class="text-base font-semibold">{$t('assistant_model')}</h3>
                <p class="mt-1 truncate text-sm text-gray-500 dark:text-gray-400">{modelSettingsSummary}</p>
              </div>
              {#if localCredentials.length > 0}
                <button
                  type="button"
                  class="shrink-0 rounded-lg px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 dark:text-neutral-200 dark:hover:bg-neutral-900"
                  aria-label={`${$t('assistant_change')} ${$t('assistant_model').toLocaleLowerCase()}`}
                  aria-expanded={modelSettingsExpanded}
                  onclick={() => (modelSettingsExpanded = !modelSettingsExpanded)}
                >
                  {$t('assistant_change')}
                </button>
              {/if}
            </div>
            {#if localCredentials.length === 0}
              <p class="mt-2 text-sm text-gray-500 dark:text-gray-400">{$t('assistant_no_credentials_setup')}</p>
            {:else if modelSettingsExpanded}
              <div class="mt-3 grid gap-3 border-t border-gray-200 pt-3 dark:border-neutral-800">
                <div class="grid gap-2">
                  <label class="text-sm font-medium" for="assistant-default-provider-credential">
                    {$t('assistant_provider_credential')}
                  </label>
                  <select
                    id="assistant-default-provider-credential"
                    aria-label={$t('assistant_provider_credential')}
                    class="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-700 dark:bg-immich-dark-gray"
                    value={selectedAssistantCredential?.id ?? ''}
                    onchange={handleAssistantCredentialChange}
                  >
                    {#each localCredentials as credential (credential.id)}
                      <option value={credential.id}>{credential.label}</option>
                    {/each}
                  </select>
                </div>

                <div class="grid gap-2">
                  <label class="text-sm font-medium" for="assistant-default-model">{$t('assistant_model')}</label>
                  {#if selectedAssistantCredential && selectedAssistantCredential.models.length > 0}
                    <select
                      id="assistant-default-model"
                      aria-label={$t('assistant_model')}
                      class="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-700 dark:bg-immich-dark-gray"
                      value={selectedAssistantModel}
                      onchange={handleAssistantModelChange}
                    >
                      {#each selectedAssistantCredential.models as model (model)}
                        <option value={model}>{model}</option>
                      {/each}
                    </select>
                  {:else}
                    <input
                      id="assistant-default-model"
                      aria-label={$t('assistant_model')}
                      class="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-700 dark:bg-immich-dark-gray"
                      value={selectedAssistantModel}
                      oninput={handleAssistantModelChange}
                      placeholder={$t('assistant_model')}
                    />
                  {/if}
                </div>
              </div>
            {/if}
          </section>

          <section class="rounded-lg border border-gray-200 p-4 dark:border-neutral-800">
            <div class="flex items-center justify-between gap-3">
              <div class="min-w-0">
                <h3 class="text-base font-semibold">{$t('assistant_api_keys')}</h3>
                <p class="mt-1 text-sm text-gray-500 dark:text-gray-400">{$t('assistant_api_keys_summary')}</p>
              </div>
              <button
                type="button"
                class="shrink-0 whitespace-nowrap rounded-lg bg-gray-100 px-3 py-2 text-sm font-medium text-gray-900 hover:bg-gray-200 dark:bg-neutral-800 dark:text-neutral-100 dark:hover:bg-neutral-700"
                aria-label={localCredentials.length > 0 ? $t('assistant_manage_api_keys') : $t('assistant_add_api_key')}
                aria-expanded={apiKeysExpanded}
                onclick={toggleApiKeySettings}
              >
                {localCredentials.length > 0 ? $t('assistant_manage') : $t('assistant_add_api_key')}
              </button>
            </div>
            {#if apiKeysExpanded}
              <AgentProviderCredentialsModal
                open={apiKeysExpanded}
                embedded
                initialAddFormOpen={apiKeysInitialAddFormOpen}
                credentials={localCredentials}
                onCredentialsChanged={(nextCredentials) => (localCredentials = nextCredentials)}
              />
            {/if}
          </section>

          <section class="rounded-lg border border-gray-200 p-4 dark:border-neutral-800">
            <div class="flex min-h-14 items-center justify-between gap-4">
              <div class="min-w-0">
                <h3 class="text-base font-semibold">{$t('assistant_control')}</h3>
                <p class="mt-1 text-sm text-gray-500 dark:text-gray-400">{assistantControlSummary}</p>
                <p class="mt-1 text-xs text-gray-500 dark:text-gray-400">
                  {$t('assistant_settings_apply_to_new_chats')}
                </p>
              </div>
              <button
                type="button"
                class="shrink-0 rounded-lg px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 dark:text-neutral-200 dark:hover:bg-neutral-900"
                aria-label={`${$t('assistant_change')} ${$t('assistant_control').toLocaleLowerCase()}`}
                aria-expanded={assistantControlExpanded}
                onclick={() => (assistantControlExpanded = !assistantControlExpanded)}
              >
                {$t('assistant_change')}
              </button>
            </div>

            {#if assistantControlExpanded}
              <div class="mt-3 grid gap-5 border-t border-gray-200 pt-3 dark:border-neutral-800">
                <fieldset aria-labelledby="assistant-photo-access-legend">
                  <legend id="assistant-photo-access-legend" class="text-sm font-semibold">
                    {$t('assistant_photo_access')}
                  </legend>
                  <div class="mt-3 grid gap-1.5">
                    {#each permissionPresetOptions as option (option.value)}
                      <label
                        class={[
                          'flex cursor-pointer gap-3 rounded-lg border px-3 py-2.5 text-sm leading-snug transition-colors',
                          assistantPermissionPreset === option.value
                            ? 'border-blue-500 bg-blue-50 text-blue-950 dark:border-blue-500/70 dark:bg-blue-950/30 dark:text-blue-100'
                            : 'border-gray-200 hover:bg-gray-50 dark:border-neutral-800 dark:hover:bg-neutral-900',
                        ]}
                      >
                        <input
                          class="mt-1"
                          type="radio"
                          name="assistant-photo-access"
                          value={option.value}
                          checked={assistantPermissionPreset === option.value}
                          onchange={handlePermissionPresetChange}
                        />
                        <span class="grid gap-0.5">
                          <span class="flex items-center gap-1.5 font-medium">
                            {$t(option.labelKey)}
                            <span
                              class="inline-flex text-gray-400 dark:text-gray-500"
                              title={$t(option.detailsKey)}
                              aria-label={$t(option.detailsKey)}
                            >
                              <Icon icon={mdiInformationOutline} size="15" />
                            </span>
                          </span>
                          <span class="text-gray-500 dark:text-gray-400">{$t(option.descriptionKey)}</span>
                        </span>
                      </label>
                    {/each}
                  </div>
                </fieldset>

                <fieldset aria-labelledby="assistant-approval-behavior-legend">
                  <legend id="assistant-approval-behavior-legend" class="text-sm font-semibold">
                    {$t('assistant_approval_behavior')}
                  </legend>
                  <div class="mt-3 grid gap-1.5">
                    {#each primaryApprovalModeOptions as option (option.value)}
                      <label
                        class={[
                          'flex cursor-pointer gap-3 rounded-lg border px-3 py-2.5 text-sm leading-snug transition-colors',
                          assistantApprovalMode === option.value
                            ? 'border-blue-500 bg-blue-50 text-blue-950 dark:border-blue-500/70 dark:bg-blue-950/30 dark:text-blue-100'
                            : 'border-gray-200 hover:bg-gray-50 dark:border-neutral-800 dark:hover:bg-neutral-900',
                        ]}
                      >
                        <input
                          class="mt-1"
                          type="radio"
                          name="assistant-approval-behavior"
                          value={option.value}
                          checked={assistantApprovalMode === option.value}
                          onchange={handleApprovalModeChange}
                        />
                        <span class="grid gap-0.5">
                          <span class="font-medium">{$t(option.labelKey)}</span>
                          <span class="text-gray-500 dark:text-gray-400">{$t(option.descriptionKey)}</span>
                        </span>
                      </label>
                    {/each}
                  </div>
                </fieldset>
              </div>
            {/if}
          </section>
        </div>
      </div>
    </div>
  {/if}

  {#if !onboardingActive}
    <div class="hidden shrink-0 md:block">
      {#if sidebarCollapsed}
        <div
          class="flex h-full w-14 flex-col items-center gap-1 border-r border-gray-200 bg-slate-50 py-2 dark:border-neutral-800 dark:bg-neutral-950"
        >
          <button
            type="button"
            data-testid="agent-session-sidebar-expand"
            class="flex h-10 w-10 items-center justify-center rounded-full text-gray-600 hover:bg-gray-100 hover:text-black dark:text-neutral-300 dark:hover:bg-neutral-900 dark:hover:text-white"
            aria-label={$t('assistant_open_sessions')}
            title={$t('assistant_open_sessions')}
            onclick={() => (sidebarCollapsed = false)}
          >
            <Icon icon={mdiDockLeft} size="18" />
          </button>
          <button
            type="button"
            class="flex h-10 w-10 items-center justify-center rounded-full text-gray-600 hover:bg-gray-100 hover:text-black dark:text-neutral-300 dark:hover:bg-neutral-900 dark:hover:text-white"
            aria-label={$t('assistant_new_chat')}
            title={$t('assistant_new_chat')}
            onclick={startNewChat}
          >
            <Icon icon={mdiPlus} size="18" />
          </button>
        </div>
      {:else}
        <div class="h-full w-72">
          <AgentSessionSidebar
            sessions={localSessions}
            {selectedSessionId}
            {titleBySessionId}
            onSelectSession={selectSession}
            onNewChat={startNewChat}
            onRenameSession={handleRenameSession}
            onDeleteSession={handleDeleteSession}
            onCollapse={() => (sidebarCollapsed = true)}
          />
        </div>
      {/if}
    </div>
  {/if}

  {#if sidebarOpen && !onboardingActive}
    <div
      class="fixed inset-0 z-40 bg-black/40 md:hidden"
      role="presentation"
      onclick={() => (sidebarOpen = false)}
    ></div>
    <div class="fixed inset-y-0 left-0 z-50 w-80 max-w-[85vw] md:hidden">
      <AgentSessionSidebar
        sessions={localSessions}
        {selectedSessionId}
        {titleBySessionId}
        onSelectSession={selectSession}
        onNewChat={startNewChat}
        onRenameSession={handleRenameSession}
        onDeleteSession={handleDeleteSession}
      />
    </div>
  {/if}

  <main class="flex min-w-0 flex-1 flex-col overflow-hidden">
    {#if !onboardingActive}
      <header
        class={[
          'flex min-h-14 shrink-0 items-center gap-3 border-b border-gray-200 px-4 dark:border-gray-800 md:px-6',
          selectedSession ? 'md:hidden' : '',
        ]}
      >
        <button
          type="button"
          class="rounded-lg border border-gray-300 px-3 py-2 text-sm md:hidden dark:border-gray-700"
          aria-label={$t('assistant_open_sessions')}
          onclick={() => (sidebarOpen = true)}
        >
          {$t('assistant_sessions')}
        </button>
        <div class="min-w-0">
          <h1 class="truncate text-lg font-semibold">{selectedTitle}</h1>
          {#if selectedSession}
            <p class="truncate text-sm text-gray-500 dark:text-gray-400">
              {$t(getAgentSessionStatusLabelKey(selectedSession.status))} · {selectedSession.modelSnapshot.model}
            </p>
          {/if}
        </div>
        <div class="ml-auto flex shrink-0 items-center gap-2">
          {#if !isRunnerAvailable}
            <div class="relative">
              <button
                type="button"
                class="inline-flex h-9 w-9 items-center justify-center rounded-full border border-red-500/40 bg-red-500/10 text-red-600 transition-colors hover:bg-red-500/15 dark:text-red-300"
                aria-label={runnerStatusLabel}
                aria-expanded={runnerDetailsOpen}
                title={runnerStatusLabel}
                onclick={() => (runnerDetailsOpen = !runnerDetailsOpen)}
              >
                <Icon icon={mdiAlertCircleOutline} size="18" />
              </button>

              {#if runnerDetailsOpen}
                <div
                  class="absolute right-0 z-20 mt-2 w-72 rounded-lg border border-red-200 bg-white p-3 text-sm shadow-lg dark:border-red-900 dark:bg-neutral-950"
                  role="status"
                >
                  <p class="font-medium text-red-700 dark:text-red-200">{runnerStatusLabel}</p>
                  <dl class="mt-3 grid grid-cols-[7rem_1fr] gap-x-3 gap-y-1 text-xs text-gray-600 dark:text-gray-300">
                    <dt>{$t('assistant_configured')}</dt>
                    <dd>{runnerStatus.configured ? $t('assistant_yes') : $t('assistant_no')}</dd>
                    <dt>{$t('assistant_healthy')}</dt>
                    <dd>{runnerStatus.healthy ? $t('assistant_yes') : $t('assistant_no')}</dd>
                    {#if runnerStatus.version}
                      <dt>{$t('assistant_runner', { values: { version: runnerStatus.version } })}</dt>
                      <dd>{runnerStatus.version}</dd>
                    {/if}
                    {#if runnerStatus.capabilities?.protocolVersion}
                      <dt>
                        {$t('assistant_protocol', {
                          values: { protocol: runnerStatus.capabilities.protocolVersion },
                        })}
                      </dt>
                      <dd>{runnerStatus.capabilities.protocolVersion}</dd>
                    {/if}
                  </dl>
                </div>
              {/if}
            </div>
          {/if}
          <button
            type="button"
            class="inline-flex h-9 w-9 items-center justify-center rounded-md text-gray-600 hover:bg-gray-100 hover:text-black dark:text-neutral-300 dark:hover:bg-neutral-900 dark:hover:text-white"
            data-testid="assistant-settings-menu"
            aria-label={$t('assistant_settings')}
            onclick={() => (assistantSettingsOpen = true)}
          >
            <Icon icon={mdiDotsHorizontal} size="20" />
          </button>
        </div>
      </header>
    {/if}

    <div class="min-h-0 flex-1 overflow-hidden">
      {#if selectedSession}
        <AgentConversationPane
          session={selectedSession}
          title={selectedTitle}
          seedMessages={sentMessageBySessionId[selectedSession.id] ? [sentMessageBySessionId[selectedSession.id]] : []}
          assistantResponsePending={isStartingFromMessage && startingFromMessageSessionId === selectedSession.id}
          onNewChat={startNewChat}
          onTitleDiscovered={handleTitleDiscovered}
          onSessionUpdated={handleSessionUpdated}
        />
      {:else}
        <section
          class="flex h-full min-h-0 flex-col px-4 pb-4 text-black dark:text-white md:px-8"
          data-testid="assistant-empty-chat"
        >
          {#if !isRunnerAvailable}
            <div
              class="mx-auto mt-5 w-full max-w-3xl rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-100"
              role="alert"
            >
              {$t('assistant_unavailable_banner')}
            </div>
          {/if}

          <div
            class="mx-auto flex min-h-0 w-full max-w-3xl flex-1 flex-col justify-center gap-4 pb-20"
            data-testid="assistant-empty-chat-surface"
          >
            {#if onboardingActive}
              <AgentOnboarding onComplete={handleOnboardingComplete} />
            {:else}
              <div class="text-center" data-testid="assistant-empty-chat-heading">
                <h2 class="text-2xl font-semibold">{$t('assistant_new_chat_prompt')}</h2>
              </div>

              {#if newChatError}
                <div
                  class="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-200"
                  role="alert"
                >
                  {newChatError}
                </div>
              {/if}

              <form
                class="mt-4 shrink-0"
                data-testid="assistant-new-chat-composer"
                onsubmit={(event) => {
                  event.preventDefault();
                  void startSessionFromMessage();
                }}
              >
                <div
                  class="grid w-full gap-2 rounded-2xl border border-gray-300 bg-white p-2 shadow-lg dark:border-neutral-700 dark:bg-neutral-900"
                >
                  {#if selectedAssistantCredential}
                    <div class="flex items-center justify-between gap-2 px-2 pt-1">
                      <button
                        type="button"
                        class="max-w-full truncate rounded-md px-2 py-1 text-left text-xs text-gray-600 hover:bg-gray-100 hover:text-black dark:text-neutral-300 dark:hover:bg-neutral-800 dark:hover:text-white"
                        aria-label={$t('assistant_model_selector')}
                        onclick={() => (assistantSettingsOpen = true)}
                      >
                        {selectedAssistantCredential.label} · {selectedAssistantModel}
                      </button>
                    </div>
                  {/if}
                  <div class="flex items-end gap-3">
                    <label for="assistant-new-message" class="sr-only">{$t('assistant_message')}</label>
                    <textarea
                      id="assistant-new-message"
                      aria-label={$t('assistant_message')}
                      class="min-h-14 flex-1 resize-none bg-transparent px-3 py-2 text-sm outline-none disabled:cursor-not-allowed disabled:opacity-60"
                      bind:value={newChatDraft}
                      placeholder={$t('assistant_new_chat_placeholder')}
                      disabled={isStartingFromMessage || !isRunnerAvailable}
                      onkeydown={handleNewChatComposerKeydown}
                    ></textarea>
                    <Button type="submit" disabled={!canSendNewChat} loading={isStartingFromMessage}
                      >{$t('assistant_send')}</Button
                    >
                  </div>
                </div>
              </form>
            {/if}
          </div>
        </section>
      {/if}
    </div>
  </main>
</div>
