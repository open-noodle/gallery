<script lang="ts">
  import { goto } from '$app/navigation';
  import GameLeaderboard, { toAvatarUser } from '$lib/components/games/game-leaderboard.svelte';
  import GamePlay from '$lib/components/games/game-play.svelte';
  import UserPageLayout from '$lib/components/layouts/UserPageLayout.svelte';
  import { authManager } from '$lib/managers/auth-manager.svelte';
  import { Route } from '$lib/route';
  import { handleError } from '$lib/utils/handle-error';
  import {
    getLeaderboard,
    type GameChallengeDetailResponseDto,
    type GameLeaderboardResponseDto,
    type SharedSpaceMemberResponseDto,
  } from '@immich/sdk';
  import { IconButton } from '@immich/ui';
  import { mdiArrowLeft } from '@mdi/js';
  import { t } from 'svelte-i18n';
  import type { PageData } from './$types';

  interface Props {
    data: PageData;
  }

  let { data }: Props = $props();

  let challenge = $state<GameChallengeDetailResponseDto>(data.challenge);
  let leaderboard = $state<GameLeaderboardResponseDto>();

  const memberById = $derived(
    new Map((data.members as SharedSpaceMemberResponseDto[]).map((member) => [member.userId, member])),
  );

  const leaderboardRows = $derived(
    (leaderboard?.entries ?? []).flatMap((entry) => {
      const member = memberById.get(entry.userId);
      // The server only returns current members, so a miss here means the member list is stale -
      // skip rather than render a nameless avatar.
      if (!member) {
        return [];
      }
      return [
        {
          user: toAvatarUser(member),
          total: entry.total,
          detail:
            entry.answered === 0
              ? $t('game_not_played')
              : $t('game_rounds_answered', { values: { answered: entry.answered, total: challenge.rounds.length } }),
          value: entry.answered === 0 ? '—' : $t('game_points', { values: { score: entry.total } }),
          isMe: entry.userId === authManager.user.id,
        },
      ];
    }),
  );

  async function loadLeaderboard() {
    try {
      leaderboard = await getLeaderboard({ id: challenge.id });
    } catch (error) {
      handleError(error, $t('errors.something_went_wrong'));
    }
  }
</script>

<!-- The challenge's own name is the title (mirrors the space-album detail page's back-nav +
     title pattern); unlike that page, there is no editable title inline in the round/result
     surfaces below, so the header is the only place it's shown. -->
<!-- A daily has no user-facing name: the server stores its UTC date in `name` only to keep the
     column non-null, so titling the page with it would show a raw "2026-08-16" in every language. -->
<UserPageLayout title={challenge.dailyOn ? $t('game_daily_challenge') : challenge.name}>
  {#snippet leading()}
    <!-- spaceId is null for a solo challenge, and viewSpaceGames only exists for a space one -
         this route is space-only for now, so the guard is currently always true, but the type is
         nullable and a future solo route must not inherit a broken back button by omission. -->
    {#if challenge.spaceId}
      <IconButton
        variant="ghost"
        shape="round"
        color="secondary"
        aria-label={$t('back')}
        onclick={() => void goto(Route.viewSpaceGames({ id: challenge.spaceId! }))}
        icon={mdiArrowLeft}
      />
    {/if}
  {/snippet}

  <!-- The play loop (round rendering, guess submission, progress) is shared with solo (Task 13) -
       game-play.svelte owns it; only the ending differs, and this space route's ending is a
       leaderboard fetched once the loop reports the game complete. -->
  <GamePlay {challenge} onComplete={loadLeaderboard}>
    {#snippet ending()}
      {#if leaderboard}
        <GameLeaderboard rows={leaderboardRows} />
      {/if}
    {/snippet}
  </GamePlay>
</UserPageLayout>
