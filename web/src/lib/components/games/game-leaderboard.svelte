<script lang="ts">
  import { t } from 'svelte-i18n';

  type Props = {
    entries: Array<{ userId: string; name: string | null; total: number; answered: number }>;
    roundCount: number;
  };

  let { entries, roundCount }: Props = $props();
</script>

<div data-testid="game-leaderboard">
  <h2 class="text-lg font-semibold">{$t('game_leaderboard')}</h2>

  <table class="mt-2 w-full text-start">
    <tbody>
      {#each entries as entry, rank (entry.userId)}
        <tr data-testid="leaderboard-row" class="border-b border-gray-200 last:border-0 dark:border-gray-800">
          <td class="w-8 py-2 text-sm text-gray-500 dark:text-gray-400">{rank + 1}</td>
          <td class="py-2 text-start font-medium">
            <!-- The server deliberately returns a null name for a departed member so the client
                 localises the fallback rather than rendering the literal string "null". -->
            {entry.name ?? $t('unknown')}
          </td>
          <td class="py-2 text-sm text-gray-500 dark:text-gray-400">
            {$t('game_leaderboard_answered', { values: { answered: entry.answered, total: roundCount } })}
          </td>
          <td class="py-2 text-end font-semibold">
            {$t('game_points', { values: { score: entry.total } })}
          </td>
        </tr>
      {/each}
    </tbody>
  </table>
</div>
