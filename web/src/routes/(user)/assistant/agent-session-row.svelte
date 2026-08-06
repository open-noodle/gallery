<script lang="ts">
  import type { AgentSessionResponseDto } from '@immich/sdk';
  import { Icon } from '@immich/ui';
  import { mdiCheck, mdiClose, mdiDeleteOutline, mdiDotsHorizontal, mdiPencilOutline } from '@mdi/js';
  import { t } from 'svelte-i18n';
  import {
    getAgentSessionStatusBadge,
    getAgentSessionTitle,
    type AgentSessionTitleCache,
  } from './agent-session-workspace-ui';

  interface Props {
    session: AgentSessionResponseDto;
    selected: boolean;
    titleBySessionId?: AgentSessionTitleCache;
    onSelectSession: (sessionId: string) => void;
    onRenameSession?: (sessionId: string, title: string) => Promise<void> | void;
    onDeleteSession?: (sessionId: string) => Promise<void> | void;
  }

  let { session, selected, titleBySessionId = {}, onSelectSession, onRenameSession, onDeleteSession }: Props = $props();

  const title = $derived(getAgentSessionTitle(session, titleBySessionId));
  const statusDotClass = $derived.by(() => {
    const tone = getAgentSessionStatusBadge(session.status)?.tone;

    switch (tone) {
      case 'attention':
      case 'danger': {
        return 'bg-amber-500';
      }

      case 'active': {
        return 'bg-blue-500 animate-pulse';
      }

      default: {
        return null;
      }
    }
  });
  let menuOpen = $state(false);
  let renaming = $state(false);
  let draftTitle = $state('');
  let busy = $state(false);

  const openRename = () => {
    menuOpen = false;
    draftTitle = title;
    renaming = true;
  };

  const saveRename = async () => {
    const nextTitle = draftTitle.trim();
    if (!nextTitle || nextTitle === title || busy) {
      renaming = false;
      return;
    }

    busy = true;
    try {
      await onRenameSession?.(session.id, nextTitle);
      renaming = false;
    } finally {
      busy = false;
    }
  };

  const deleteSession = async () => {
    if (busy) {
      return;
    }

    menuOpen = false;
    busy = true;
    try {
      await onDeleteSession?.(session.id);
    } finally {
      busy = false;
    }
  };
</script>

<div class="group relative">
  {#if renaming}
    <form
      class={[
        'flex min-h-9 w-full items-center gap-1 overflow-hidden rounded-md px-2 py-1.5 text-sm',
        selected ? 'bg-slate-200 dark:bg-neutral-800' : 'bg-slate-100 dark:bg-neutral-900',
      ]}
      onsubmit={(event) => {
        event.preventDefault();
        void saveRename();
      }}
    >
      <input
        class="min-w-0 flex-1 rounded border border-slate-300 bg-white px-2 py-1 text-sm text-slate-950 outline-none dark:border-neutral-700 dark:bg-neutral-950 dark:text-neutral-50"
        aria-label={$t('assistant_rename_chat_title')}
        bind:value={draftTitle}
        disabled={busy}
      />
      <button
        type="submit"
        class="rounded p-1 text-slate-600 hover:bg-slate-200 dark:text-neutral-300 dark:hover:bg-neutral-700"
        aria-label={$t('save')}
      >
        <Icon icon={mdiCheck} size="16" />
      </button>
      <button
        type="button"
        class="rounded p-1 text-slate-600 hover:bg-slate-200 dark:text-neutral-300 dark:hover:bg-neutral-700"
        aria-label={$t('cancel')}
        onclick={() => (renaming = false)}
      >
        <Icon icon={mdiClose} size="16" />
      </button>
    </form>
  {:else}
    <button
      type="button"
      class={[
        'flex min-h-9 w-full items-center gap-2 overflow-hidden rounded-xl px-2.5 py-2 pr-9 text-left text-sm transition-colors',
        selected
          ? 'bg-slate-200 text-slate-950 dark:bg-neutral-800 dark:text-neutral-50'
          : 'text-slate-700 hover:bg-slate-100 hover:text-slate-950 dark:text-neutral-300 dark:hover:bg-neutral-900 dark:hover:text-neutral-50',
      ]}
      data-testid={`agent-session-row-${session.id}`}
      data-session-id={session.id}
      aria-current={selected ? 'true' : undefined}
      onclick={() => onSelectSession(session.id)}
    >
      {#if statusDotClass}
        <span class={['h-1.5 w-1.5 shrink-0 rounded-full', statusDotClass]} aria-hidden="true"></span>
      {/if}
      <span class="min-w-0 truncate">{title}</span>
    </button>

    <button
      type="button"
      class={[
        'absolute right-1 top-1/2 inline-flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-md text-slate-500 hover:bg-slate-200 hover:text-slate-950 dark:text-neutral-400 dark:hover:bg-neutral-700 dark:hover:text-neutral-50',
        menuOpen ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 focus:opacity-100',
      ]}
      aria-label={$t('assistant_chat_menu')}
      aria-expanded={menuOpen}
      onclick={(event) => {
        event.stopPropagation();
        menuOpen = !menuOpen;
      }}
    >
      <Icon icon={mdiDotsHorizontal} size="18" />
    </button>
  {/if}

  {#if menuOpen}
    <div
      class="absolute right-1 top-8 z-20 w-44 rounded-xl border border-neutral-700 bg-neutral-800 p-1.5 text-sm text-neutral-100 shadow-2xl"
      role="menu"
    >
      <button
        type="button"
        class="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left hover:bg-neutral-700"
        role="menuitem"
        onclick={openRename}
      >
        <Icon icon={mdiPencilOutline} size="18" />
        <span>{$t('rename')}</span>
      </button>
      <button
        type="button"
        class="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-red-300 hover:bg-neutral-700"
        role="menuitem"
        onclick={deleteSession}
      >
        <Icon icon={mdiDeleteOutline} size="18" />
        <span>{$t('delete')}</span>
      </button>
    </div>
  {/if}
</div>
