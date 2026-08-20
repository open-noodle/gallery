<script lang="ts">
  import { goto } from '$app/navigation';
  import ChallengeCreatePanel from '$lib/components/games/challenge-create-panel.svelte';
  import DailyChallengeCard from '$lib/components/games/daily-challenge-card.svelte';
  import SoloHistory from '$lib/components/games/solo-history.svelte';
  import SoloStats from '$lib/components/games/solo-stats.svelte';
  import UserPageLayout from '$lib/components/layouts/UserPageLayout.svelte';
  import { authManager } from '$lib/managers/auth-manager.svelte';
  import { Route } from '$lib/route';
  import { SOLO_HISTORY_PAGE_SIZE } from '$lib/utils/game';
  import { handleError } from '$lib/utils/handle-error';
  import {
    createSoloChallenge,
    getSoloHistory,
    isHttpError,
    type GameChallengeType,
    type GameSoloHistoryItemResponseDto,
    type GameSoloSourcesDto,
  } from '@immich/sdk';
  import { Button, toastManager } from '@immich/ui';
  import { mdiPlus } from '@mdi/js';
  import { onMount } from 'svelte';
  import { t } from 'svelte-i18n';
  import type { PageData } from './$types';

  interface Props {
    data: PageData;
  }

  let { data }: Props = $props();

  const daily = $derived(data.daily);
  const stats = $derived(data.stats);

  // Owned as state rather than derived: "load more" appends to this list, and a $derived would
  // throw every appended page away on the next unrelated re-render.
  //
  // The constraint that buys: these three are seeded ONCE, so a navigation that re-runs this
  // loader while SvelteKit reuses this component would leave them stale. Nothing reaches that
  // today - no route navigates to /photoguesser from /photoguesser - but it is the same hazard the
  // sibling play route has to spend a {#key} on, so anything that adds such a path needs one here.
  let historyItems = $state<GameSoloHistoryItemResponseDto[]>(data.history.items);
  let hasNextPage = $state(data.history.hasNextPage);
  let historyPage = $state(1);
  let loadingHistory = $state(false);

  // Ticks once a minute, which is the countdown's own resolution - a per-second clock would
  // re-render the hero sixty times a minute to change nothing visible.
  let now = $state(new Date());
  onMount(() => {
    const timer = setInterval(() => (now = new Date()), 60_000);
    return () => clearInterval(timer);
  });

  let showCreatePanel = $state(false);
  let creating = $state(false);

  // The stored preference is only the SEED for the panel's toggles: the panel sends its choice back
  // as a per-game override, and nothing here writes it back. Overriding for one game must not
  // rewrite the preference, because that preference is what every future daily is generated from.
  const storedSources = $derived({
    includePartners: authManager.preferences.photoGuesser.includePartners,
    includeSpaces: authManager.preferences.photoGuesser.includeSpaces,
  });

  // handleError prefers the server's raw message for any HttpError, truncated to 75 chars
  // (handle-error.ts). The 400 body here is longer than that and arrives cut off mid-sentence, so
  // the localized string has to win for this one known status.
  //
  // Only for that status, though: handleError's fallback is what renders when there is NO server
  // message at all - a dropped connection - and "add photos with GPS data" would blame the library
  // for a network failure.
  function reportCreateFailure(error: unknown) {
    if (isHttpError(error) && error.status === 400) {
      toastManager.danger($t('game_solo_no_photos'));
      return;
    }
    handleError(error, $t('errors.something_went_wrong'));
  }

  async function handleCreate({
    roundCount,
    type,
    sources,
  }: {
    roundCount: number;
    type: GameChallengeType;
    sources?: GameSoloSourcesDto;
  }) {
    creating = true;
    try {
      const challenge = await createSoloChallenge({ gameSoloCreateDto: { roundCount, type, sources } });
      if (challenge.roundCount < roundCount) {
        // The solo sibling of game_rounds_fewer_than_requested, not that key itself: the space one
        // reads "This space's photos filled…", and several of its translations hard-code the
        // product noun (de "dieses Spaces", nl "deze Space", ru "этого Space"), so it would tell a
        // solo player - who may belong to no space at all - about photos in one.
        toastManager.warning(
          $t('game_solo_rounds_fewer_than_requested', {
            values: { actual: challenge.roundCount, requested: roundCount },
          }),
        );
      }
      await goto(Route.viewPhotoGuesserGame({ challengeId: challenge.id }));
    } catch (error) {
      // 400: nothing in the chosen sources can fill a round of the requested kind.
      reportCreateFailure(error);
    } finally {
      creating = false;
    }
  }

  async function handleLoadMore() {
    if (loadingHistory) {
      return;
    }
    loadingHistory = true;
    try {
      const next = await getSoloHistory({ page: historyPage + 1, size: SOLO_HISTORY_PAGE_SIZE });
      historyItems = [...historyItems, ...next.items];
      hasNextPage = next.hasNextPage;
      historyPage += 1;
    } catch (error) {
      handleError(error, $t('errors.something_went_wrong'));
    } finally {
      loadingHistory = false;
    }
  }
</script>

<UserPageLayout title={data.meta.title}>
  <div class="flex h-full flex-col gap-8 overflow-y-auto p-4">
    <!-- The daily leads the page: it is the reason to come back, and it is the only game that
         feeds the streak.

         Its empty state is deliberately NOT game_solo_no_photos, the copy the free-play path uses.
         That sentence offers the create panel's source toggles as the remedy, and those are a
         per-game override that is never written back - the daily is generated server-side from the
         STORED preference, which nothing on the web sets. A player who followed it would get a
         playable free-play game and this same card, unchanged, forever. -->
    <DailyChallengeCard
      challenge={daily}
      href={daily ? Route.viewPhotoGuesserGame({ challengeId: daily.id }) : ''}
      {now}
      unavailableMessage={$t('game_solo_daily_unavailable')}
    />

    <section class="flex flex-col gap-4">
      <div>
        <Button
          size="small"
          leadingIcon={mdiPlus}
          onclick={() => (showCreatePanel = !showCreatePanel)}
          data-testid="start-free-play"
        >
          {$t('game_solo_start_free_play')}
        </Button>
      </div>

      {#if showCreatePanel}
        <ChallengeCreatePanel {creating} sources={storedSources} onCreate={(options) => void handleCreate(options)} />
      {/if}
    </section>

    <SoloStats {stats} />

    <SoloHistory items={historyItems} {hasNextPage} loading={loadingHistory} onLoadMore={() => void handleLoadMore()} />
  </div>
</UserPageLayout>
