<script lang="ts">
  import GameLeaderboard, { toAvatarUser, type LeaderboardRow } from '$lib/components/games/game-leaderboard.svelte';
  import { formatStandingsMonth } from '$lib/utils/game';
  import type { GameLeaderboardResponseDto, GameStandingsResponseDto, SharedSpaceMemberResponseDto } from '@immich/sdk';
  import { t } from 'svelte-i18n';

  type Props = {
    /** Null when the space has no daily today - then there is only one board, so no tabs. */
    today: { entries: GameLeaderboardResponseDto['entries']; roundCount: number } | null;
    month: GameStandingsResponseDto;
    members: SharedSpaceMemberResponseDto[];
    currentUserId: string;
  };

  let { today, month, members, currentUserId }: Props = $props();

  let tab = $state<'today' | 'month'>('today');

  const memberById = $derived(new Map(members.map((member) => [member.userId, member])));

  /** Both endpoints return exactly the current members, so a miss means a stale member list. */
  const rowFor = (userId: string, total: number, detail: string, value: string): LeaderboardRow[] => {
    const member = memberById.get(userId);
    if (!member) {
      return [];
    }
    return [{ user: toAvatarUser(member), total, detail, value, isMe: userId === currentUserId }];
  };

  const todayRows = $derived(
    (today?.entries ?? []).flatMap((entry) =>
      rowFor(
        entry.userId,
        entry.total,
        entry.answered === 0
          ? $t('game_not_played')
          : $t('game_rounds_answered', { values: { answered: entry.answered, total: today?.roundCount ?? 0 } }),
        entry.answered === 0 ? '—' : $t('game_points', { values: { score: entry.total } }),
      ),
    ),
  );

  const monthRows = $derived(
    month.entries.flatMap((entry) =>
      rowFor(
        entry.userId,
        entry.total,
        entry.daysPlayed === 0
          ? $t('game_not_played')
          : `${$t('game_days_played', { values: { count: entry.daysPlayed } })} · ${$t('game_average_points', {
              values: { score: Math.round(entry.total / entry.daysPlayed) },
            })}`,
        entry.daysPlayed === 0 ? '—' : $t('game_points', { values: { score: entry.total } }),
      ),
    ),
  );

  // Falls back to today's board whenever there is a daily, so the section opens on the thing the
  // player just did.
  const rows = $derived(today === null || tab === 'month' ? monthRows : todayRows);
</script>

<section class="flex flex-col gap-3" data-testid="standings-section">
  <div class="flex flex-wrap items-center justify-between gap-2">
    <h2 class="text-lg font-semibold">{$t('game_leaderboard')}</h2>

    {#if today !== null}
      <!-- Same segmented control as challenge-create-panel.svelte: two options do not warrant a
           new widget, and aria-pressed already carries the state. -->
      <div class="flex overflow-hidden rounded-full border border-gray-300 dark:border-gray-700">
        <button
          type="button"
          aria-pressed={tab === 'today'}
          onclick={() => (tab = 'today')}
          data-testid="standings-tab-today"
          class="px-4 py-1.5 text-sm font-semibold transition-colors {tab === 'today'
            ? 'bg-primary text-light'
            : 'hover:bg-gray-200 dark:hover:bg-gray-800'}"
        >
          {$t('game_standings_today')}
        </button>
        <button
          type="button"
          aria-pressed={tab === 'month'}
          onclick={() => (tab = 'month')}
          data-testid="standings-tab-month"
          title={formatStandingsMonth(month.month)}
          class="px-4 py-1.5 text-sm font-semibold transition-colors {tab === 'month'
            ? 'bg-primary text-light'
            : 'hover:bg-gray-200 dark:hover:bg-gray-800'}"
        >
          {$t('game_standings_month')}
        </button>
      </div>
    {/if}
  </div>

  <GameLeaderboard {rows} />
</section>
