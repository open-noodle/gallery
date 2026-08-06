<script lang="ts">
  import type { AgentSessionResponseDto } from '@immich/sdk';
  import { t } from 'svelte-i18n';
  import { getApprovalModeLabelKey, getPermissionPresetLabelKey } from './agent-session-ui';
  import { getAgentSessionStatusLabelKey } from './agent-session-workspace-ui';

  type RunnerCapabilitiesSummary = {
    protocolVersion?: unknown;
    streaming?: unknown;
    tools?: unknown;
    models?: unknown;
  };

  interface Props {
    session: AgentSessionResponseDto;
    open?: boolean;
    onClose: () => void;
  }

  let { session, open = false, onClose }: Props = $props();
  let visible = $derived(open);

  const capabilities = $derived((session.runnerCapabilitiesSnapshot ?? null) as RunnerCapabilitiesSummary | null);
  const protocolVersion = $derived(
    typeof capabilities?.protocolVersion === 'string' && capabilities.protocolVersion.trim()
      ? capabilities.protocolVersion
      : $t('assistant_not_available'),
  );
  const streaming = $derived(
    typeof capabilities?.streaming === 'boolean'
      ? $t(capabilities.streaming ? 'assistant_yes' : 'assistant_no')
      : $t('assistant_not_available'),
  );
  const toolCount = $derived(Array.isArray(capabilities?.tools) ? capabilities.tools.length : null);
  const modelCount = $derived(Array.isArray(capabilities?.models) ? capabilities.models.length : null);

  const formatCount = (count: number | null, singular: string, plural: string) => {
    if (count === null) {
      return $t('assistant_not_available');
    }

    return `${count} ${count === 1 ? singular : plural}`;
  };

  const close = () => {
    visible = false;
    onClose();
  };
</script>

{#if visible}
  <div class="fixed inset-0 z-50">
    <button
      type="button"
      class="absolute inset-0 h-full w-full cursor-default bg-black/40"
      aria-label={$t('assistant_dismiss_details')}
      onclick={close}
    ></button>
    <div
      class="absolute inset-y-0 right-0 h-full w-full max-w-md overflow-y-auto bg-white p-5 text-black shadow-xl dark:bg-immich-dark-gray dark:text-white"
      role="dialog"
      aria-modal="true"
      aria-labelledby="agent-session-details-title"
    >
      <div class="flex items-start justify-between gap-4">
        <h2 id="agent-session-details-title" class="text-lg font-semibold">{$t('assistant_session_details')}</h2>
        <button
          type="button"
          class="rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800"
          onclick={close}
        >
          {$t('assistant_close_details')}
        </button>
      </div>

      <dl class="mt-5 grid gap-4 text-sm">
        <div>
          <dt class="text-gray-500 dark:text-gray-400">{$t('assistant_provider_credential')}</dt>
          <dd class="mt-1 break-words font-medium">{session.credentialSnapshot.label}</dd>
        </div>
        <div>
          <dt class="text-gray-500 dark:text-gray-400">{$t('assistant_model')}</dt>
          <dd class="mt-1 break-words font-medium">{session.modelSnapshot.model}</dd>
        </div>
        <div>
          <dt class="text-gray-500 dark:text-gray-400">{$t('status')}</dt>
          <dd class="mt-1 font-medium">{$t(getAgentSessionStatusLabelKey(session.status))}</dd>
        </div>
        <div>
          <dt class="text-gray-500 dark:text-gray-400">{$t('assistant_permission_preset')}</dt>
          <dd class="mt-1 font-medium">{$t(getPermissionPresetLabelKey(session.permissionPreset))}</dd>
        </div>
        <div>
          <dt class="text-gray-500 dark:text-gray-400">{$t('assistant_approval_mode')}</dt>
          <dd class="mt-1 font-medium">{$t(getApprovalModeLabelKey(session.approvalMode))}</dd>
        </div>
      </dl>

      <section class="mt-6 border-t border-gray-200 pt-5 dark:border-gray-700">
        <h3 class="text-sm font-semibold">{$t('assistant_runner_capabilities')}</h3>
        <dl class="mt-3 grid gap-4 text-sm">
          <div>
            <dt class="text-gray-500 dark:text-gray-400">{$t('assistant_protocol_version')}</dt>
            <dd class="mt-1 font-medium">{protocolVersion}</dd>
          </div>
          <div>
            <dt class="text-gray-500 dark:text-gray-400">{$t('assistant_streaming')}</dt>
            <dd class="mt-1 font-medium">{streaming}</dd>
          </div>
          <div>
            <dt class="text-gray-500 dark:text-gray-400">{$t('assistant_tools')}</dt>
            <dd class="mt-1 font-medium">{formatCount(toolCount, 'tool', 'tools')}</dd>
          </div>
          <div>
            <dt class="text-gray-500 dark:text-gray-400">{$t('assistant_models')}</dt>
            <dd class="mt-1 font-medium">{formatCount(modelCount, 'model', 'models')}</dd>
          </div>
        </dl>
      </section>

      <dl class="mt-6 grid gap-4 border-t border-gray-200 pt-5 text-sm dark:border-gray-700">
        <div>
          <dt class="text-gray-500 dark:text-gray-400">{$t('assistant_created_at')}</dt>
          <dd class="mt-1 font-medium">{session.createdAt}</dd>
        </div>
        <div>
          <dt class="text-gray-500 dark:text-gray-400">{$t('assistant_updated_at')}</dt>
          <dd class="mt-1 font-medium">{session.updatedAt}</dd>
        </div>
        <div>
          <dt class="text-gray-500 dark:text-gray-400">{$t('assistant_ended_at')}</dt>
          <dd class="mt-1 font-medium">{session.endedAt ?? $t('assistant_not_available')}</dd>
        </div>
      </dl>
    </div>
  </div>
{/if}
