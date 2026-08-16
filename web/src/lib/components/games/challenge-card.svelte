<script lang="ts">
  import { roundImageUrl } from '$lib/utils/game';
  import { Icon } from '@immich/ui';
  import { mdiTrashCanOutline } from '@mdi/js';
  import { t } from 'svelte-i18n';

  interface Props {
    challengeId: string;
    name: string;
    roundCount: number;
    answered: number;
    href: string;
    onDelete?: () => void;
  }

  let { challengeId, name, roundCount, answered, href, onDelete }: Props = $props();

  // Not started / partway / done — mirrors the play page's own game_completed heading for the
  // finished case.
  const cta = $derived(
    answered <= 0 ? $t('game_play') : answered >= roundCount ? $t('game_completed') : $t('game_continue'),
  );

  const pips = $derived(Array.from({ length: roundCount }, (_, index) => index < answered));
</script>

<div
  data-testid="challenge-card"
  class="group relative isolate overflow-hidden rounded-2xl bg-gray-900 text-white shadow-sm transition-shadow hover:shadow-lg"
>
  <!-- The challenge's own first photo. Served by the round-image endpoint, which is keyed by
       (challenge, round index) and never discloses an asset id or filename - so this shows nothing
       the player would not see the moment they open the challenge. -->
  <img
    src={roundImageUrl(challengeId, 0)}
    alt=""
    aria-hidden="true"
    data-testid="challenge-card-backdrop"
    class="absolute inset-0 -z-10 size-full object-cover opacity-45 transition-opacity group-hover:opacity-60"
  />

  {#if onDelete}
    <!-- Sibling of the anchor, not inside it -->
    <button
      type="button"
      class="absolute inset-e-2 top-2 z-10 rounded-full bg-black/50 p-1 opacity-0 shadow-sm group-hover:opacity-100 focus-within:opacity-100 hover:bg-black/70"
      onclick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onDelete?.();
      }}
      aria-label={$t('game_delete_challenge')}
      data-testid="challenge-card-delete"
    >
      <Icon icon={mdiTrashCanOutline} size="18" class="text-red-400" />
    </button>
  {/if}

  <a {href} class="flex h-full flex-col justify-end gap-2 bg-linear-to-t from-black/80 to-black/20 p-4 pt-16">
    <p class="line-clamp-2 w-full text-lg/6 font-semibold" title={name}>
      {name}
    </p>

    <!-- Progress as pips rather than the sentence it used to be: at a glance, on a card, the shape
         of "2 of 5" reads faster than the words. The sentence stays as the accessible name, so this
         is a visual shorthand and not a loss of information. -->
    <div
      class="flex gap-1"
      role="img"
      aria-label={$t('game_rounds_answered', { values: { answered, total: roundCount } })}
    >
      {#each pips as filled, index (index)}
        <span
          data-testid="challenge-card-pip-{index}"
          data-filled={filled}
          class="h-1.5 w-5 rounded-full {filled ? 'bg-primary' : 'bg-white/30'}"
        ></span>
      {/each}
    </div>

    <p class="text-sm font-medium text-primary" data-testid="challenge-card-cta">
      {cta}
    </p>
  </a>
</div>
