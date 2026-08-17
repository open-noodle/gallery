<script lang="ts">
  import { goto, invalidateAll } from '$app/navigation';
  import ChallengeCard from '$lib/components/games/challenge-card.svelte';
  import ChallengeCreatePanel from '$lib/components/games/challenge-create-panel.svelte';
  import DailyChallengeCard from '$lib/components/games/daily-challenge-card.svelte';
  import DailyChallengePrompt from '$lib/components/games/daily-challenge-prompt.svelte';
  import ButtonContextMenu from '$lib/components/shared-components/context-menu/ButtonContextMenu.svelte';
  import MenuOption from '$lib/components/shared-components/context-menu/MenuOption.svelte';
  import StandingsSection from '$lib/components/games/standings-section.svelte';
  import { authManager } from '$lib/managers/auth-manager.svelte';
  import { Route } from '$lib/route';
  import { handleError } from '$lib/utils/handle-error';
  import { shouldShowStandings } from '$lib/utils/game';
  import {
    createChallenge,
    deleteChallenge,
    GameChallengeType,
    isHttpError,
    SharedSpaceRole,
    updateSpace,
    type GameChallengeListItemResponseDto,
    type SharedSpaceMemberResponseDto,
    type SharedSpaceResponseDto,
  } from '@immich/sdk';
  import { Button, LoadingSpinner, modalManager, toastManager } from '@immich/ui';
  import { mdiCalendarStarOutline, mdiDotsVertical, mdiPlus } from '@mdi/js';
  import { onMount } from 'svelte';
  import { t } from 'svelte-i18n';
  import type { PageData } from './$types';

  interface Props {
    data: PageData;
  }

  let { data }: Props = $props();

  const space = $derived<SharedSpaceResponseDto>(data.space);
  const members = $derived<SharedSpaceMemberResponseDto[]>(data.members);
  // A one-time snapshot, not $derived - unlike daily/standings/todayBoard below, this does NOT
  // refresh when invalidateAll() runs (e.g. from setDailyEnabled). Harmless today because enabling
  // the daily never changes the custom challenge list, but do not assume this list is fresh after
  // an invalidateAll() if that stops being true.
  let challenges = $state<GameChallengeListItemResponseDto[]>(data.challenges);
  const daily = $derived<GameChallengeListItemResponseDto | null>(data.daily);
  const standings = $derived(data.standings);
  const todayBoard = $derived(data.todayBoard);

  let showCreatePanel = $state(false);
  let creating = $state(false);

  // Ticks once a minute, which is the countdown's own resolution - a per-second clock would
  // re-render the hero sixty times a minute to change nothing visible.
  let now = $state(new Date());
  onMount(() => {
    const timer = setInterval(() => (now = new Date()), 60_000);
    return () => clearInterval(timer);
  });

  const currentMember = $derived(members.find((m) => m.userId === authManager.user.id));
  const isEditor = $derived(
    currentMember?.role === SharedSpaceRole.Owner || currentMember?.role === SharedSpaceRole.Editor,
  );

  let togglingDaily = $state(false);
  // Tracked separately from togglingDaily because only the ENABLE direction generates anything.
  // Declining is a plain column write, so claiming to be "generating today's challenge" there would
  // be a lie.
  let generatingDaily = $state(false);
  const dailyEnabled = $derived(space.dailyChallengeEnabled === true);
  const dailyUnanswered = $derived(space.dailyChallengeEnabled === null || space.dailyChallengeEnabled === undefined);
  const showStandings = $derived(shouldShowStandings(space.dailyChallengeEnabled, standings.entries));

  async function setDailyEnabled(enabled: boolean) {
    // The prompt's own buttons lock via `pending`, but the overflow menu's MenuOption has no
    // disabled prop and closes on click - without this guard, re-opening the menu mid-write (the
    // slow enable path generates the daily) fires a second updateSpace + invalidateAll().
    if (togglingDaily) {
      return;
    }
    togglingDaily = true;
    generatingDaily = enabled;
    try {
      await updateSpace({ id: space.id, sharedSpaceUpdateDto: { dailyChallengeEnabled: enabled } });
      // Enabling generates the daily during this reload - candidate queries plus the CLIP scene
      // prompts, so seconds rather than milliseconds. This await is the whole wait the user sees,
      // which is why generatingDaily drives a placeholder for its duration.
      await invalidateAll();
    } catch (error) {
      handleError(error, $t('game_daily_toggle_failed'));
    } finally {
      togglingDaily = false;
      generatingDaily = false;
    }
  }

  // handleError prefers the server's raw message for any HttpError, truncated to 75 chars
  // (handle-error.ts) - fine for a generic failure, but it drowns out the localized string for
  // these two KNOWN cases, whose real bodies are longer than that and cut off mid-sentence
  // ("This space has no photos usable for a challenge - add photos with GPS data ..."). Branch on
  // the status so the localized message wins here, falling through to handleError otherwise.
  function reportGameError(error: unknown, knownStatus: number, localizedMessage: string) {
    if (isHttpError(error) && error.status === knownStatus) {
      toastManager.danger(localizedMessage);
      return;
    }
    handleError(error, localizedMessage);
  }

  /** The 400 the server sends when the requested type cannot be built from this space's photos. */
  const createFailureMessage = (type: GameChallengeType) => {
    if (type === GameChallengeType.Location) {
      return $t('game_create_location_failed');
    }
    return type === GameChallengeType.Date ? $t('game_create_date_failed') : $t('game_create_failed');
  };

  async function handleCreate({ roundCount, type }: { roundCount: number; type: GameChallengeType }) {
    creating = true;
    try {
      const challenge = await createChallenge({
        spaceId: space.id,
        gameCreateDto: { roundCount, type },
      });
      if (challenge.roundCount < roundCount) {
        toastManager.warning(
          $t('game_rounds_fewer_than_requested', {
            values: { actual: challenge.roundCount, requested: roundCount },
          }),
        );
      } else {
        toastManager.success($t('game_challenge_created'));
      }
      await goto(Route.viewSpaceGame({ spaceId: space.id, challengeId: challenge.id }));
    } catch (error) {
      // 400: the space has no photos usable for the requested kind of challenge.
      reportGameError(error, 400, createFailureMessage(type));
    } finally {
      creating = false;
    }
  }

  async function handleDelete(challenge: GameChallengeListItemResponseDto) {
    // Deleting a challenge is irreversible and cascades every round, every player's guesses, and
    // the leaderboard - confirm first, mirroring every other destructive action in this space UI
    // (leave/delete space in the [spaceId] layout, unlink library). spaces_delete_confirmation's
    // wording is generic (just "delete {name}?"), so it's reused as-is rather than adding a key.
    const confirmed = await modalManager.showDialog({
      prompt: $t('spaces_delete_confirmation', { values: { name: challenge.name } }),
      title: $t('game_delete_challenge'),
    });
    if (!confirmed) {
      return;
    }
    try {
      await deleteChallenge({ id: challenge.id });
      challenges = challenges.filter((c) => c.id !== challenge.id);
      toastManager.success($t('game_challenge_deleted'));
    } catch (error) {
      // 403: the caller's role no longer permits deleting (e.g. demoted mid-session).
      reportGameError(error, 403, $t('game_delete_failed'));
    }
  }
</script>

<div class="flex h-full flex-col gap-8 p-4">
  {#if isEditor}
    <div class="flex justify-end">
      <ButtonContextMenu
        icon={mdiDotsVertical}
        size="medium"
        title={dailyEnabled ? $t('game_daily_turn_off') : $t('game_daily_turn_on')}
        data-testid="daily-toggle"
      >
        <MenuOption
          text={dailyEnabled ? $t('game_daily_turn_off') : $t('game_daily_turn_on')}
          icon={mdiCalendarStarOutline}
          onClick={() => setDailyEnabled(!dailyEnabled)}
        />
      </ButtonContextMenu>
    </div>
  {/if}

  <!-- The daily leads the page even when the space has no custom challenges at all: it is the
       reason to come back, and burying it under an empty-state would hide the only game there is. -->
  {#if generatingDaily}
    <!-- Sits ahead of both branches below so it covers BOTH slow enable paths: the prompt's button
         (which also spins) and the overflow menu (which cannot - MenuOption has no pending state and
         the menu closes on click, so this placeholder is the only feedback that path can give).
         Card-shaped and in the card's slot, so the feedback appears where the result will. -->
    <section
      class="flex items-center justify-center gap-3 rounded-3xl border border-gray-300 p-6 dark:border-gray-700"
      data-testid="daily-generating"
    >
      <LoadingSpinner size="medium" />
      <p class="text-sm text-gray-600 dark:text-gray-300">{$t('game_daily_generating')}</p>
    </section>
  {:else if dailyEnabled}
    <DailyChallengeCard
      challenge={daily}
      href={daily ? Route.viewSpaceGame({ spaceId: space.id, challengeId: daily.id }) : ''}
      {now}
    />
  {:else if dailyUnanswered && isEditor}
    <DailyChallengePrompt
      pending={togglingDaily}
      onEnable={() => setDailyEnabled(true)}
      onDecline={() => setDailyEnabled(false)}
    />
  {/if}

  {#if showStandings}
    <StandingsSection
      today={todayBoard && daily ? { entries: todayBoard.entries, roundCount: daily.roundCount } : null}
      month={standings}
      {members}
      currentUserId={authManager.user.id}
    />
  {/if}

  <section class="flex flex-col gap-4">
    <div class="flex items-center justify-between">
      <h2 class="text-lg font-semibold">{$t('game_your_challenges')}</h2>
      {#if isEditor}
        <Button
          size="small"
          leadingIcon={mdiPlus}
          onclick={() => (showCreatePanel = !showCreatePanel)}
          data-testid="new-challenge-button"
        >
          {$t('game_new_challenge')}
        </Button>
      {/if}
    </div>

    {#if isEditor && showCreatePanel}
      <ChallengeCreatePanel {creating} onCreate={(options) => void handleCreate(options)} />
    {/if}

    {#if challenges.length === 0}
      <p class="py-6 text-center text-sm text-gray-500 dark:text-gray-400" data-testid="empty-state-message">
        {$t('game_no_challenges_description')}
      </p>
    {:else}
      <div class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3" data-testid="challenge-list">
        {#each challenges as challenge (challenge.id)}
          <ChallengeCard
            challengeId={challenge.id}
            name={challenge.name}
            roundCount={challenge.roundCount}
            answered={challenge.answered}
            href={Route.viewSpaceGame({ spaceId: space.id, challengeId: challenge.id })}
            onDelete={isEditor ? () => void handleDelete(challenge) : undefined}
          />
        {/each}
      </div>
    {/if}
  </section>
</div>
