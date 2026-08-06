<script lang="ts">
  import {
    type AgentProviderCredentialResponseDto,
    type AgentRunnerStatusDto,
    type AgentSessionResponseDto,
  } from '@immich/sdk';
  import { t } from 'svelte-i18n';
  import AgentOperationPlanReviewPanel from './agent-operation-plan-review-panel.svelte';
  import AgentRunnerStatusPanel from './agent-runner-status-panel.svelte';
  import AgentSessionChatPanel from './agent-session-chat-panel.svelte';
  import AgentSessionSetupPanel from './agent-session-setup-panel.svelte';
  import { getApprovalModeLabelKey, getPermissionPresetLabelKey, getSessionStatusLabelKey } from './agent-session-ui';

  interface Props {
    runnerStatus: AgentRunnerStatusDto;
    credentials: AgentProviderCredentialResponseDto[];
  }

  let { runnerStatus, credentials }: Props = $props();
  let createdSession = $state<AgentSessionResponseDto | null>(null);
</script>

<div class="flex flex-col gap-6">
  <AgentRunnerStatusPanel status={runnerStatus} />

  <AgentSessionSetupPanel
    {runnerStatus}
    {credentials}
    onSessionCreated={(session) => {
      createdSession = session;
    }}
  />

  {#if createdSession}
    <section
      class="mx-auto w-full max-w-3xl px-4 pb-10 text-black dark:text-white md:px-8"
      aria-labelledby="assistant-created-session-title"
    >
      <div class="rounded-lg border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-immich-dark-gray">
        <h2 id="assistant-created-session-title" class="text-lg font-semibold">{$t('assistant_created_session')}</h2>
        <dl class="mt-4 grid gap-3 text-sm sm:grid-cols-2">
          <div>
            <dt class="text-gray-500 dark:text-gray-400">{$t('assistant_provider_credential')}</dt>
            <dd class="font-medium">{createdSession.credentialSnapshot.label}</dd>
          </div>
          <div>
            <dt class="text-gray-500 dark:text-gray-400">{$t('assistant_model')}</dt>
            <dd class="font-medium">{createdSession.modelSnapshot.model}</dd>
          </div>
          <div>
            <dt class="text-gray-500 dark:text-gray-400">{$t('status')}</dt>
            <dd class="font-medium">{$t(getSessionStatusLabelKey(createdSession.status))}</dd>
          </div>
          <div>
            <dt class="text-gray-500 dark:text-gray-400">{$t('assistant_permission_preset')}</dt>
            <dd class="font-medium">{$t(getPermissionPresetLabelKey(createdSession.permissionPreset))}</dd>
          </div>
          <div>
            <dt class="text-gray-500 dark:text-gray-400">{$t('assistant_approval_mode')}</dt>
            <dd class="font-medium">{$t(getApprovalModeLabelKey(createdSession.approvalMode))}</dd>
          </div>
        </dl>
      </div>
    </section>

    {#key createdSession.id}
      <AgentSessionChatPanel session={createdSession} />
      <AgentOperationPlanReviewPanel session={createdSession} />
    {/key}
  {/if}
</div>
