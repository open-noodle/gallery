<script lang="ts">
  import { GameChallengeType } from '@immich/sdk';
  import { Button, Icon } from '@immich/ui';
  import { mdiCalendarBlankOutline, mdiMapMarkerOutline, mdiShuffleVariant } from '@mdi/js';
  import { t } from 'svelte-i18n';

  type Props = {
    creating: boolean;
    onCreate: (options: { roundCount: number; type: GameChallengeType }) => void;
  };

  let { creating, onCreate }: Props = $props();

  // Three steps rather than a slider or a number field: the useful range is small, and a tap
  // target you can hit without aiming is the difference between "pick a game" and "fill in a form".
  const ROUND_COUNTS = [3, 5, 10];

  // `as const` so the labels stay literal types - $t() takes a known key, not a widened string.
  const TYPES = [
    { value: GameChallengeType.Mixed, label: 'game_type_mixed', icon: mdiShuffleVariant },
    { value: GameChallengeType.Location, label: 'game_type_location', icon: mdiMapMarkerOutline },
    { value: GameChallengeType.Date, label: 'game_type_date', icon: mdiCalendarBlankOutline },
  ] as const;

  let roundCount = $state(5);
  let type = $state<GameChallengeType>(GameChallengeType.Mixed);
</script>

<div class="flex flex-col gap-4 rounded-2xl bg-gray-100 p-4 dark:bg-gray-900" data-testid="challenge-create-panel">
  <div class="flex flex-wrap items-center gap-x-6 gap-y-3">
    <div class="flex items-center gap-2">
      <span class="text-sm font-medium text-gray-600 dark:text-gray-400">{$t('game_round_count')}</span>
      <div class="flex overflow-hidden rounded-full border border-gray-300 dark:border-gray-700">
        {#each ROUND_COUNTS as count (count)}
          <button
            type="button"
            aria-pressed={roundCount === count}
            onclick={() => (roundCount = count)}
            data-testid="challenge-create-rounds-{count}"
            class="px-4 py-1.5 text-sm font-semibold transition-colors {roundCount === count
              ? 'bg-primary text-light'
              : 'hover:bg-gray-200 dark:hover:bg-gray-800'}"
          >
            {count}
          </button>
        {/each}
      </div>
    </div>

    <div class="flex items-center gap-2">
      <span class="text-sm font-medium text-gray-600 dark:text-gray-400">{$t('game_type')}</span>
      <div class="flex overflow-hidden rounded-full border border-gray-300 dark:border-gray-700">
        {#each TYPES as option (option.value)}
          <button
            type="button"
            aria-pressed={type === option.value}
            onclick={() => (type = option.value)}
            data-testid="challenge-create-type-{option.value}"
            class="flex items-center gap-1.5 px-4 py-1.5 text-sm font-semibold transition-colors {type === option.value
              ? 'bg-primary text-light'
              : 'hover:bg-gray-200 dark:hover:bg-gray-800'}"
          >
            <Icon icon={option.icon} size="16" />
            {$t(option.label)}
          </button>
        {/each}
      </div>
    </div>
  </div>

  <div class="flex justify-end">
    <!-- `loading` rather than `disabled`, and it implies disabled so the double-submit guard still
         holds: the candidate queries and CLIP prompts behind a challenge take long enough for a
         second click to land and create a duplicate from one intent - and long enough that a merely
         greyed-out button reads as a frozen page rather than as work in progress. -->
    <Button
      size="small"
      loading={creating}
      onclick={() => onCreate({ roundCount, type })}
      data-testid="challenge-create-submit"
    >
      {$t('game_new_challenge')}
    </Button>
  </div>
</div>
