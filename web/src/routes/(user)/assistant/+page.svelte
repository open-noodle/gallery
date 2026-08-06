<script lang="ts">
  import UserPageLayout from '$lib/components/layouts/UserPageLayout.svelte';
  import type { PageData } from './$types';
  import AgentAssistantWorkspace from './agent-assistant-workspace.svelte';

  interface Props {
    data: PageData;
  }

  let { data }: Props = $props();
</script>

<UserPageLayout title={data.meta.title}>
  <AgentAssistantWorkspace
    runnerStatus={data.runnerStatus}
    credentials={data.credentials}
    sessions={data.sessions}
    requestedSessionId={data.requestedSessionId}
  />
</UserPageLayout>
