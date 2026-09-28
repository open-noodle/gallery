<script lang="ts">
  import type { GameSoloStatsResponseDto } from '@immich/sdk';
  import { t } from 'svelte-i18n';

  type Props = {
    stats: GameSoloStatsResponseDto;
  };

  let { stats }: Props = $props();

  // The two halves of this panel count DIFFERENT games: the streaks count only fully played
  // dailies, everything else counts every game with a guess in it, free play included. Five tiles
  // in one grid would read as one population and make "Best score" look like "best daily score".
  const groups = $derived([
    {
      key: 'daily',
      heading: 'game_daily_challenge',
      tiles: [
        { name: 'current-streak', label: 'game_solo_current_streak', value: stats.currentStreak },
        { name: 'best-streak', label: 'game_solo_best_streak', value: stats.bestStreak },
      ],
    },
    {
      key: 'all',
      heading: 'game_solo_all_games',
      tiles: [
        { name: 'best-score', label: 'game_solo_best_score', value: stats.bestScore },
        { name: 'average-score', label: 'game_solo_average_score', value: stats.averageScore },
        { name: 'games-played', label: 'game_solo_games_played', value: stats.gamesPlayed },
      ],
    },
    // `as const` so the label keys stay literal types - $t() takes a known key, not a widened
    // string. Same reason as challenge-create-panel's TYPES.
  ] as const);

  const format = (value: number) => new Intl.NumberFormat().format(value);
</script>

<div class="flex flex-col gap-4 sm:flex-row sm:gap-6" data-testid="solo-stats">
  {#each groups as group (group.key)}
    <section class="flex flex-col gap-2" data-testid="solo-stats-{group.key}">
      <h2 class="text-xs font-semibold tracking-widest text-gray-500 uppercase dark:text-gray-400">
        {$t(group.heading)}
      </h2>
      <div class="flex flex-wrap gap-3">
        {#each group.tiles as stat (stat.name)}
          <div
            class="min-w-28 flex-1 rounded-2xl bg-gray-100 px-4 py-3 dark:bg-gray-900"
            data-testid="solo-stat-{stat.name}"
          >
            <!-- The server returns zeroes, never nulls, for a player with no games - so there is
                 nothing to special-case here, and a blank tile would be inventing an empty state
                 the data does not have. -->
            <p class="text-2xl font-bold dark:text-white">{format(stat.value)}</p>
            <p class="text-sm text-gray-600 dark:text-gray-400">{$t(stat.label)}</p>
          </div>
        {/each}
      </div>
    </section>
  {/each}
</div>
