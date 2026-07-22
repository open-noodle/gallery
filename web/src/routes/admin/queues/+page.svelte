<script lang="ts">
  import AdminPageLayout from '$lib/components/layouts/AdminPageLayout.svelte';
  import ReadOnlyDemoNotice from '$lib/components/admin/ReadOnlyDemoNotice.svelte';
  import OnEvents from '$lib/components/OnEvents.svelte';
  import JobsPanel from './QueuePanel.svelte';
  import { authManager } from '$lib/managers/auth-manager.svelte';
  import { queueManager } from '$lib/managers/queue-manager.svelte';
  import { getQueuesActions } from '$lib/services/queue.service';
  import { type QueueResponseDto } from '@immich/sdk';
  import { CommandPaletteDefaultProvider, Container, type ActionItem } from '@immich/ui';
  import { onMount } from 'svelte';
  import { t } from 'svelte-i18n';
  import type { PageData } from './$types';

  type Props = {
    data: PageData;
  };

  const { data }: Props = $props();

  onMount(() => queueManager.listen());

  let queues = $derived<QueueResponseDto[]>(queueManager.queues);

  const { ResumePaused, CreateJob, ManageConcurrency } = $derived(getQueuesActions($t, queueManager.queues));
  const isReadOnlyDemo = $derived(authManager.isReadOnlyDemo);
  const commands: ActionItem[] = $derived([CreateJob, ManageConcurrency]);
  const pageActions = $derived(isReadOnlyDemo ? [ManageConcurrency] : [ResumePaused, CreateJob, ManageConcurrency]);

  const onQueueUpdate = (update: QueueResponseDto) => {
    queues = queues.map((queue) => {
      if (queue.name === update.name) {
        return update;
      }
      return queue;
    });
  };
</script>

<CommandPaletteDefaultProvider name={$t('admin.queues')} actions={commands} />

<OnEvents {onQueueUpdate} />

<AdminPageLayout breadcrumbs={[{ title: data.meta.title }]} actions={pageActions}>
  <Container size="medium" center>
    <ReadOnlyDemoNotice />
    {#if queues}
      <JobsPanel {queues} />
    {/if}
  </Container>
</AdminPageLayout>
