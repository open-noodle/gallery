<script lang="ts">
  import { roundImageUrl, timeUntilNextDaily } from '$lib/utils/game';
  import { Button, Icon } from '@immich/ui';
  import { mdiCalendarBlankOutline, mdiMapMarkerOutline, mdiShuffleVariant, mdiTrophyOutline } from '@mdi/js';
  import { t } from 'svelte-i18n';

  /** Only the fields the hero renders - deliberately narrower than the SDK DTO so a page test can
   * build one without inventing a frozen pool scale. */
  type DailyChallenge = {
    id: string;
    roundCount: number;
    locationRoundCount: number;
    answered: number;
    total: number;
  };

  type Props = {
    challenge: DailyChallenge | null;
    href: string;
    /** Injected rather than read from the clock, so the countdown is testable at a fixed instant. */
    now: Date;
    // Design §5.1 - failure phrasing is per-scope. The default tells the player to add photos "to
    // this space", which is nonsense for a solo player who may be in no space at all and whose
    // remedy includes the source toggles instead. Defaulted, so the space callers say nothing.
    unavailableMessage?: string;
  };

  let { challenge, href, now, unavailableMessage }: Props = $props();

  const finished = $derived(challenge !== null && challenge.answered >= challenge.roundCount);

  // Labelled from the rounds the challenge actually contains, not from a requested type - a mixed
  // request that could only find location photos is a places game, whatever was asked for.
  const typeIcon = $derived.by(() => {
    if (!challenge) {
      return mdiShuffleVariant;
    }
    if (challenge.locationRoundCount === challenge.roundCount) {
      return mdiMapMarkerOutline;
    }
    return challenge.locationRoundCount === 0 ? mdiCalendarBlankOutline : mdiShuffleVariant;
  });

  const typeLabel = $derived.by(() => {
    if (!challenge) {
      return 'game_type_mixed';
    }
    if (challenge.locationRoundCount === challenge.roundCount) {
      return 'game_type_location';
    }
    return challenge.locationRoundCount === 0 ? 'game_type_date' : 'game_type_mixed';
  });

  const countdown = $derived(timeUntilNextDaily(now));

  const formattedTotal = $derived(new Intl.NumberFormat().format(challenge?.total ?? 0));
</script>

<section
  data-testid="daily-challenge"
  class="relative isolate overflow-hidden rounded-3xl bg-gray-900 text-white shadow-lg"
>
  {#if challenge}
    <!-- The challenge's own first photo as a backdrop. Served by the round-image endpoint, which
         is keyed by (challenge, index) and never discloses an asset id or filename - so this shows
         nothing the player would not see the moment they press Play. -->
    <img
      src={roundImageUrl(challenge.id, 0)}
      alt=""
      aria-hidden="true"
      class="absolute inset-0 -z-10 size-full object-cover opacity-35"
    />
  {/if}

  <div class="flex flex-col gap-4 bg-linear-to-t from-black/80 to-black/30 p-6 sm:p-8">
    <div class="flex items-center gap-2 text-xs font-semibold tracking-widest uppercase">
      <Icon icon={mdiTrophyOutline} size="18" />
      {$t('game_daily_challenge')}
    </div>

    {#if !challenge}
      <p class="max-w-lg text-sm text-gray-300" data-testid="daily-challenge-unavailable">
        {unavailableMessage ?? $t('game_daily_unavailable')}
      </p>
    {:else}
      <div class="flex items-center gap-3 text-sm text-gray-200">
        <span
          >{$t('game_round_progress', { values: { current: challenge.answered, total: challenge.roundCount } })}</span
        >
        <span class="flex items-center gap-1">
          <Icon icon={typeIcon} size="16" />
          {$t(typeLabel)}
        </span>
      </div>

      {#if finished}
        <p class="text-4xl font-bold sm:text-5xl" data-testid="daily-challenge-score">
          {formattedTotal}
        </p>
        <p class="text-sm text-gray-300">{$t('game_daily_played')}</p>
        <p class="text-sm text-gray-400" data-testid="daily-challenge-countdown">
          {$t('game_daily_next_in', { values: { time: countdown } })}
        </p>
      {:else}
        <div>
          <Button {href} variant="filled" data-testid="daily-challenge-play">
            {challenge.answered > 0 ? $t('game_continue') : $t('game_play')}
          </Button>
        </div>
      {/if}
    {/if}
  </div>
</section>
