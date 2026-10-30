<script lang="ts">
  import { celebrate } from '$lib/gallery/motion';
  import { prefersReducedMotion } from '$lib/gallery/motion/tokens';
  import { getByteUnitString } from '$lib/utils/byte-units';
  import { Button } from '@immich/ui';
  import { mdiArrowRight } from '@mdi/js';
  import { onMount } from 'svelte';
  import { locale, t } from 'svelte-i18n';

  type Props = {
    /** The finished date, already formatted ("October 29"). */
    date: string;
    kept: number;
    favorites: number;
    trashed: number;
    freedBytes: number;
    streak?: number;
    /** The next date still to review, formatted; absent when every date is done. */
    nextDate?: string;
    onNext?: () => void;
    onHub: () => void;
  };

  const { date, kept, favorites, trashed, freedBytes, streak, nextDate, onNext, onHub }: Props = $props();

  let card = $state<HTMLElement>();
  let primary = $state<HTMLElement>();
  const reduced = prefersReducedMotion();

  onMount(() => {
    primary?.querySelector<HTMLElement>('a, button')?.focus();
    const rect = card?.getBoundingClientRect();
    if (rect) {
      celebrate('success', { x: rect.left + rect.width / 2, y: rect.top + rect.height / 3 });
    }
  });

  // The card waits for a choice; Escape is the quiet one, back to the hub.
  const onKeydown = (event: KeyboardEvent) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      onHub();
    }
  };
</script>

<svelte:document onkeydown={onKeydown} />

<div
  class="fixed inset-0 z-50 grid place-items-center bg-black/55 p-4 backdrop-blur-sm {reduced
    ? ''
    : 'motion-safe:animate-[gallery-fade-in_var(--motion-base)_var(--ease-standard)]'}"
  data-testid="cleanup-day-done"
>
  <div
    bind:this={card}
    role="dialog"
    aria-modal="true"
    aria-labelledby="cleanup-day-done-title"
    class="w-full max-w-sm rounded-3xl border bg-light px-6 pt-7 pb-6 text-center shadow-2xl {reduced
      ? ''
      : 'motion-safe:animate-[gallery-pop_var(--spring-bouncy-duration)_var(--spring-bouncy)]'}"
  >
    <svg viewBox="0 0 52 52" class="mx-auto size-18 text-success" aria-hidden="true">
      <circle cx="26" cy="26" r="24" fill="currentColor" opacity="0.15" />
      <circle
        cx="26"
        cy="26"
        r="24"
        fill="none"
        stroke="currentColor"
        stroke-width="3"
        class="done-ring"
        class:done-draw={!reduced}
      />
      <path
        d="M15 27 l7 7 l15 -16"
        fill="none"
        stroke="currentColor"
        stroke-width="4"
        stroke-linecap="round"
        stroke-linejoin="round"
        class="done-check"
        class:done-draw={!reduced}
      />
    </svg>

    <h2 id="cleanup-day-done-title" class="mt-4 text-xl font-bold">
      {$t('cleanup_day_done_title', { values: { date } })}
    </h2>

    <dl class="mt-4 grid grid-cols-3 gap-2 text-center" data-testid="cleanup-day-done-stats">
      <div class="rounded-xl bg-subtle px-2 py-2.5">
        <dt class="text-xs text-muted">{$t('cleanup_day_done_kept')}</dt>
        <dd class="text-lg font-bold tabular-nums">{kept}</dd>
      </div>
      <div class="rounded-xl bg-subtle px-2 py-2.5">
        <dt class="text-xs text-muted">{$t('favorites')}</dt>
        <dd class="text-lg font-bold text-pink-500 tabular-nums">{favorites}</dd>
      </div>
      <div class="rounded-xl bg-subtle px-2 py-2.5">
        <dt class="text-xs text-muted">{$t('cleanup_day_done_trashed')}</dt>
        <dd class="text-lg font-bold text-danger tabular-nums">{trashed}</dd>
      </div>
    </dl>

    {#if freedBytes > 0 || (streak && streak > 1)}
      <p class="mt-3 text-sm text-muted">
        {#if freedBytes > 0}
          {$t('cleanup_day_done_freed', { values: { size: getByteUnitString(freedBytes, $locale ?? 'en') } })}
        {/if}
        {#if freedBytes > 0 && streak && streak > 1}·{/if}
        {#if streak && streak > 1}
          {$t('cleanup_streak', { values: { count: streak } })}
        {/if}
      </p>
    {/if}

    <div class="mt-6 flex flex-col gap-2" bind:this={primary}>
      {#if nextDate && onNext}
        <Button
          fullWidth
          shape="round"
          trailingIcon={mdiArrowRight}
          onclick={onNext}
          data-testid="cleanup-day-done-next"
        >
          {$t('cleanup_day_done_next', { values: { date: nextDate } })}
        </Button>
      {/if}
      <Button
        fullWidth
        shape="round"
        variant={nextDate ? 'ghost' : 'filled'}
        color={nextDate ? 'secondary' : 'primary'}
        onclick={onHub}
        data-testid="cleanup-day-done-hub"
      >
        {$t('cleanup_day_done_hub')}
      </Button>
    </div>
  </div>
</div>

<style>
  /* The ring closes, then the check draws itself. */
  .done-ring {
    stroke-dasharray: 151;
    stroke-dashoffset: 0;
    transform: rotate(-90deg);
    transform-origin: center;
  }
  .done-check {
    stroke-dasharray: 36;
    stroke-dashoffset: 0;
  }
  .done-ring.done-draw {
    animation: done-stroke 520ms var(--ease-standard, ease-out) both;
    --done-length: 151;
  }
  .done-check.done-draw {
    animation: done-stroke 360ms 420ms var(--ease-standard, ease-out) both;
    --done-length: 36;
  }
  @keyframes done-stroke {
    from {
      stroke-dashoffset: var(--done-length);
    }
    to {
      stroke-dashoffset: 0;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .done-draw {
      animation: none !important;
    }
  }
</style>
