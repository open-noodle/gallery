<script lang="ts">
  import { goto } from '$app/navigation';
  import ChallengeCard from '$lib/components/games/challenge-card.svelte';
  import { authManager } from '$lib/managers/auth-manager.svelte';
  import { handleError } from '$lib/utils/handle-error';
  import {
    createChallenge,
    deleteChallenge,
    SharedSpaceRole,
    type GameChallengeListItemResponseDto,
    type SharedSpaceMemberResponseDto,
    type SharedSpaceResponseDto,
  } from '@immich/sdk';
  import { Button, Icon, toastManager } from '@immich/ui';
  import { mdiGamepadVariantOutline, mdiPlus } from '@mdi/js';
  import { t } from 'svelte-i18n';
  import type { PageData } from './$types';

  // The server defaults roundCount to 5 when omitted, but game_rounds_fewer_than_requested needs a
  // concrete {requested} value to compare the response against — so request it explicitly.
  const REQUESTED_ROUND_COUNT = 5;

  interface Props {
    data: PageData;
  }

  let { data }: Props = $props();

  const space = $derived<SharedSpaceResponseDto>(data.space);
  const members = $derived<SharedSpaceMemberResponseDto[]>(data.members);
  let challenges = $state<GameChallengeListItemResponseDto[]>(data.challenges);

  const currentMember = $derived(members.find((m) => m.userId === authManager.user.id));
  const isEditor = $derived(
    currentMember?.role === SharedSpaceRole.Owner || currentMember?.role === SharedSpaceRole.Editor,
  );

  async function handleCreate() {
    try {
      const challenge = await createChallenge({
        spaceId: space.id,
        gameCreateDto: { roundCount: REQUESTED_ROUND_COUNT },
      });
      if (challenge.roundCount < REQUESTED_ROUND_COUNT) {
        toastManager.warning(
          $t('game_rounds_fewer_than_requested', {
            values: { actual: challenge.roundCount, requested: REQUESTED_ROUND_COUNT },
          }),
        );
      } else {
        toastManager.success($t('game_challenge_created'));
      }
      // Relative to this list page (/spaces/{id}/games): resolves to /spaces/{id}/games/{challengeId}.
      await goto(`./games/${challenge.id}`);
    } catch (error) {
      handleError(error, $t('game_create_failed'));
    }
  }

  async function handleDelete(challenge: GameChallengeListItemResponseDto) {
    try {
      await deleteChallenge({ id: challenge.id });
      challenges = challenges.filter((c) => c.id !== challenge.id);
      toastManager.success($t('game_challenge_deleted'));
    } catch (error) {
      handleError(error, $t('game_delete_failed'));
    }
  }
</script>

<div class="flex h-full flex-col">
  {#if challenges.length === 0}
    <div class="flex min-h-[calc(66vh-11rem)] w-full place-content-center items-center dark:text-white">
      <div class="flex max-w-sm flex-col content-center items-center gap-4 text-center">
        <Icon icon={mdiGamepadVariantOutline} size="3.5em" />
        <p class="text-lg text-gray-500 dark:text-gray-400" data-testid="empty-state-message">
          {$t('game_no_challenges')}
        </p>
        <p class="text-sm text-gray-400 dark:text-gray-500">
          {$t('game_no_challenges_description')}
        </p>
        {#if isEditor}
          <Button leadingIcon={mdiPlus} onclick={() => void handleCreate()} data-testid="empty-new-challenge-button">
            {$t('game_new_challenge')}
          </Button>
        {/if}
      </div>
    </div>
  {:else}
    <div class="flex items-center justify-between px-4 py-2">
      <h2 class="text-lg font-semibold">{$t('game_challenges')}</h2>
      {#if isEditor}
        <Button
          size="small"
          leadingIcon={mdiPlus}
          onclick={() => void handleCreate()}
          data-testid="new-challenge-button"
        >
          {$t('game_new_challenge')}
        </Button>
      {/if}
    </div>
    <div class="px-4 pt-4">
      <div class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3" data-testid="challenge-list">
        {#each challenges as challenge (challenge.id)}
          <ChallengeCard
            name={challenge.name}
            roundCount={challenge.roundCount}
            answered={challenge.answered}
            href={`./games/${challenge.id}`}
            onDelete={isEditor ? () => void handleDelete(challenge) : undefined}
          />
        {/each}
      </div>
    </div>
  {/if}
</div>
