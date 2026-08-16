<script lang="ts">
  import { Icon } from '@immich/ui';
  import { mdiTrashCanOutline } from '@mdi/js';
  import { t } from 'svelte-i18n';

  interface Props {
    name: string;
    roundCount: number;
    answered: number;
    href: string;
    onDelete?: () => void;
  }

  let { name, roundCount, answered, href, onDelete }: Props = $props();

  // Not started / partway / done — mirrors the play page's own game_completed heading for the
  // finished case.
  const cta = $derived(
    answered <= 0 ? $t('game_play') : answered >= roundCount ? $t('game_completed') : $t('game_continue'),
  );
</script>

<div
  data-testid="challenge-card"
  class="group relative rounded-2xl border border-transparent p-5 hover:border-gray-200 hover:bg-gray-100 dark:hover:border-gray-800 dark:hover:bg-gray-900"
>
  <!-- delete control — sibling of the anchor, not inside it -->
  {#if onDelete}
    <button
      type="button"
      class="absolute inset-e-2 top-2 z-10 rounded-full bg-white/80 p-1 opacity-0 shadow-sm group-hover:opacity-100 focus-within:opacity-100 hover:bg-white dark:bg-gray-800/80 dark:hover:bg-gray-800"
      onclick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onDelete?.();
      }}
      aria-label={$t('game_delete_challenge')}
      data-testid="challenge-card-delete"
    >
      <Icon icon={mdiTrashCanOutline} size="18" class="text-red-600 dark:text-red-400" />
    </button>
  {/if}

  <a {href} class="block">
    <p
      class="line-clamp-2 w-full text-lg/6 font-semibold text-black group-hover:text-primary dark:text-white"
      title={name}
    >
      {name}
    </p>
    <p class="text-sm dark:text-immich-dark-fg">
      {$t('game_leaderboard_answered', { values: { answered, total: roundCount } })}
    </p>
    <p class="text-sm font-medium text-primary" data-testid="challenge-card-cta">
      {cta}
    </p>
  </a>
</div>
