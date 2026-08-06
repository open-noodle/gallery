<script lang="ts">
  import { Icon, Text } from '@immich/ui';
  import { mdiAlertCircleOutline, mdiCheckCircleOutline, mdiRobotOutline } from '@mdi/js';
  import type { AgentRunnerStatusDto } from '@immich/sdk';
  import { t } from 'svelte-i18n';

  interface Props {
    status: AgentRunnerStatusDto;
  }

  let { status }: Props = $props();

  const reasonKey = $derived.by(() => {
    if (!status.configured) {
      return 'assistant_runner_not_configured';
    }

    if (!status.healthy) {
      return 'assistant_runner_unavailable';
    }

    return 'assistant_runner_healthy';
  });

  const icon = $derived(status.healthy ? mdiCheckCircleOutline : mdiAlertCircleOutline);
  const iconClass = $derived(
    status.healthy ? 'text-green-600 dark:text-green-400' : 'text-amber-600 dark:text-amber-400',
  );
  const protocol = $derived(status.capabilities?.protocolVersion ?? $t('unknown'));
</script>

<section
  class="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-8 text-black dark:text-white md:px-8"
  aria-labelledby="assistant-title"
>
  <div class="flex items-center gap-3">
    <Icon icon={mdiRobotOutline} class="text-primary" size="32" />
    <div>
      <h1 id="assistant-title" class="text-2xl font-semibold">{$t('assistant')}</h1>
      <Text size="small" color="muted">{$t('assistant_subtitle')}</Text>
    </div>
  </div>

  <div class="rounded-lg border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-immich-dark-gray">
    <div class="flex items-start gap-4">
      <Icon {icon} class={iconClass} size="28" />
      <div class="min-w-0 flex-1">
        <div data-testid="assistant-status-reason" class="text-lg font-medium">{$t(reasonKey)}</div>
        <div class="mt-2 grid gap-2 text-sm text-gray-600 dark:text-gray-300">
          <div>{$t('assistant_configured')}: {$t(status.configured ? 'assistant_yes' : 'assistant_no')}</div>
          <div>{$t('assistant_healthy')}: {$t(status.healthy ? 'assistant_yes' : 'assistant_no')}</div>
          {#if status.version}
            <div>{$t('assistant_runner', { values: { version: status.version } })}</div>
          {/if}
          {#if status.capabilities}
            <div>{$t('assistant_protocol', { values: { protocol } })}</div>
            <div>
              {$t('assistant_streaming')}: {$t(status.capabilities.streaming ? 'assistant_yes' : 'assistant_no')}
            </div>
          {/if}
        </div>
      </div>
    </div>
  </div>
</section>
