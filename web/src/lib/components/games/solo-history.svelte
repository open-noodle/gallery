<script lang="ts">
  import { Route } from '$lib/route';
  import { formatGameDate } from '$lib/utils/game';
  import type { GameSoloHistoryItemResponseDto } from '@immich/sdk';
  import { Button } from '@immich/ui';
  import { t } from 'svelte-i18n';

  type Props = {
    /** Newest first, in the order the server returned them - this list does not re-sort. */
    items: GameSoloHistoryItemResponseDto[];
    hasNextPage: boolean;
    loading: boolean;
    onLoadMore: () => void;
  };

  let { items, hasNextPage, loading, onLoadMore }: Props = $props();

  // A daily's `name` is the raw UTC date the server stores only to keep the column non-null, so
  // titling a row with it would show "2026-08-19" in every language. Its date still has to appear
  // somewhere or every daily row looks identical - which is what the second line is for.
  const titleOf = (item: GameSoloHistoryItemResponseDto) => (item.dailyOn ? $t('game_daily_challenge') : item.name);

  // Grouped before interpolation, like daily-challenge-card's hero total: game_points interpolates
  // `{score}` verbatim, so a raw number would render as "18420 pts".
  const format = (value: number) => new Intl.NumberFormat().format(value);
</script>

<section class="flex flex-col gap-3" data-testid="solo-history">
  <h2 class="text-lg font-semibold">{$t('game_solo_history')}</h2>

  {#if items.length === 0}
    <p class="py-6 text-center text-sm text-gray-500 dark:text-gray-400" data-testid="solo-history-empty">
      {$t('game_solo_no_games')}
    </p>
  {:else}
    <ul class="flex flex-col gap-2" data-testid="solo-history-list">
      {#each items as item (item.id)}
        <li>
          <a
            href={Route.viewPhotoGuesserGame({ challengeId: item.id })}
            data-testid="solo-history-row-{item.id}"
            class="flex items-center justify-between gap-4 rounded-2xl bg-gray-100 px-4 py-3 transition-colors hover:bg-gray-200 dark:bg-gray-900 dark:hover:bg-gray-800"
          >
            <div class="min-w-0">
              <p class="truncate font-medium dark:text-white">{titleOf(item)}</p>
              <p class="text-sm text-gray-600 dark:text-gray-400">
                {formatGameDate(item.dailyOn ?? item.createdAt)} · {$t('game_rounds_answered', {
                  values: { answered: item.answered, total: item.roundCount },
                })}
              </p>
            </div>
            <p class="shrink-0 font-semibold text-primary">
              {$t('game_points', { values: { score: format(item.total) } })}
            </p>
          </a>
        </li>
      {/each}
    </ul>

    <!-- hasNextPage is the only signal that history is truncated; without this the player never
         sees anything past the first page. -->
    {#if hasNextPage}
      <div class="flex justify-center">
        <Button
          size="small"
          variant="ghost"
          color="secondary"
          {loading}
          onclick={onLoadMore}
          data-testid="solo-history-load-more"
        >
          {$t('load_more')}
        </Button>
      </div>
    {/if}
  {/if}
</section>
