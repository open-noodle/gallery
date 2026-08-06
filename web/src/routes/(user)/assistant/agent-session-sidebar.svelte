<script lang="ts">
  import type { AgentSessionResponseDto, AgentSessionStatus } from '@immich/sdk';
  import { t } from 'svelte-i18n';
  import AgentSessionRow from './agent-session-row.svelte';
  import {
    filterAgentSessionsForSidebar,
    getAgentSessionStatusLabelKey,
    sortAgentSessionsForSidebar,
    type AgentSessionTitleCache,
  } from './agent-session-workspace-ui';

  interface Props {
    sessions: AgentSessionResponseDto[];
    selectedSessionId: string | null;
    titleBySessionId?: AgentSessionTitleCache;
    onSelectSession: (sessionId: string) => void;
    onNewChat: () => void;
    onRenameSession?: (sessionId: string, title: string) => Promise<void> | void;
    onDeleteSession?: (sessionId: string) => Promise<void> | void;
    onCollapse?: () => void;
  }

  let {
    sessions,
    selectedSessionId,
    titleBySessionId = {},
    onSelectSession,
    onNewChat,
    onRenameSession,
    onDeleteSession,
    onCollapse,
  }: Props = $props();
  let query = $state('');

  const sortedSessions = $derived(sortAgentSessionsForSidebar(sessions));
  const statusLabels = $derived.by(
    () =>
      Object.fromEntries(
        sortedSessions.map((session) => [session.status, $t(getAgentSessionStatusLabelKey(session.status))]),
      ) as Partial<Record<AgentSessionStatus, string>>,
  );
  const visibleSessions = $derived(
    filterAgentSessionsForSidebar(sortedSessions, query, titleBySessionId, statusLabels),
  );
</script>

<aside
  class="flex h-full min-h-0 w-full flex-col border-r border-gray-200 bg-slate-50 text-slate-950 dark:border-neutral-800 dark:bg-neutral-950 dark:text-neutral-50"
>
  <div class="shrink-0 border-b border-slate-200 p-2.5 dark:border-neutral-800">
    <div class="mb-3 flex items-center justify-between gap-3 px-1">
      <h2 class="text-base font-semibold text-slate-900 dark:text-neutral-50">{$t('assistant_sessions')}</h2>
      {#if onCollapse}
        <button
          type="button"
          class="flex h-7 w-7 items-center justify-center rounded-full text-slate-500 hover:bg-slate-100 hover:text-slate-900 dark:text-neutral-400 dark:hover:bg-neutral-900 dark:hover:text-neutral-100"
          aria-label={$t('assistant_collapse_sessions')}
          onclick={onCollapse}
        >
          ‹
        </button>
      {/if}
    </div>
    <button
      type="button"
      data-testid="agent-session-sidebar-new-chat"
      class="w-full rounded-full bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary/90"
      onclick={onNewChat}
    >
      {$t('assistant_new_chat')}
    </button>
  </div>

  <div class="shrink-0 px-2.5 py-2">
    <input
      class="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-950 outline-none placeholder:text-slate-400 focus:border-slate-500 focus:ring-2 focus:ring-slate-200 dark:border-neutral-700 dark:bg-neutral-950 dark:text-neutral-50 dark:placeholder:text-neutral-500 dark:focus:border-neutral-500 dark:focus:ring-neutral-800"
      type="search"
      aria-label={$t('assistant_search_chats')}
      placeholder={$t('assistant_search_chats')}
      bind:value={query}
    />
  </div>

  <div class="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
    <div class="px-1 pb-1 pt-2 text-xs text-slate-500 dark:text-neutral-500">Recents</div>
    <div class="flex flex-col gap-0.5">
      {#each visibleSessions as session (session.id)}
        <div data-testid="agent-session-row" data-session-id={session.id}>
          <AgentSessionRow
            {session}
            selected={session.id === selectedSessionId}
            {titleBySessionId}
            {onSelectSession}
            {onRenameSession}
            {onDeleteSession}
          />
        </div>
      {/each}
    </div>
  </div>
</aside>
