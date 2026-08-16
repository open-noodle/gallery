<script lang="ts" module>
  // toAvatarUser and its types live in $lib/utils/leaderboard, not here, so a .ts file (this
  // component's own spec) can import the real implementation without tripping bare tsc's blind
  // spot for named value exports from .svelte modules - see that file's doc comment. Re-exported
  // here so a .svelte caller (Task 9, the play page) still gets both from one import.
  export { toAvatarUser } from '$lib/utils/leaderboard';
  export type { LeaderboardRow, LeaderboardUser } from '$lib/utils/leaderboard';
</script>

<script lang="ts">
  import UserAvatar from '$lib/components/shared-components/UserAvatar.svelte';
  import { competitionRanks } from '$lib/utils/game';
  import { t } from 'svelte-i18n';

  // Inline `import()` type rather than a named import of LeaderboardRow: a named import here would
  // collide, under eslint's no-import-assign, with the module block's `export type … from` of the
  // same name above.
  type Props = { rows: import('$lib/utils/leaderboard').LeaderboardRow[] };

  let { rows }: Props = $props();

  // Ranked on the score, not on array position: two players on the same points share a place even
  // though the sort had to put one of them first.
  const ranks = $derived(competitionRanks(rows.map((row) => row.total)));
</script>

<table class="w-full text-start" data-testid="game-leaderboard">
  <!-- sr-only: whichever surface hosts this table already names it visibly, so a second visible
       "Leaderboard" would be redundant - but the table itself still needs an accessible name. -->
  <caption class="sr-only">{$t('game_leaderboard')}</caption>
  <tbody>
    {#each rows as row, index (row.user.id)}
      <tr
        data-testid="leaderboard-row"
        data-me={row.isMe ? 'true' : undefined}
        class="border-b border-gray-200 last:border-0 dark:border-gray-800 {row.isMe
          ? 'bg-primary/10 font-semibold'
          : ''}"
      >
        <td class="w-8 py-2 text-sm text-gray-500 dark:text-gray-400" data-testid="leaderboard-rank">
          {ranks[index]}
        </td>
        <td class="w-10 py-2">
          <div class="size-8">
            <UserAvatar user={row.user} size="full" />
          </div>
        </td>
        <td class="py-2 text-start font-medium">{row.user.name}</td>
        <td class="py-2 text-sm text-gray-500 dark:text-gray-400">{row.detail}</td>
        <td class="py-2 text-end font-semibold">{row.value}</td>
      </tr>
    {/each}
  </tbody>
</table>
