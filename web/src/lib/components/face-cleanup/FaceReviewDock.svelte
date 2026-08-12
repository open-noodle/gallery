<script lang="ts">
  import { Icon } from '@immich/ui';
  import { mdiInformationOutline } from '@mdi/js';
  import type { Snippet } from 'svelte';
  import { t } from 'svelte-i18n';
  import { effectKeyFor, FACE_ACTIONS, type FaceActionId, type FaceReviewMode } from './face-actions';

  // The ONE footer dock for both review modes. It used to be two near-identical copies that drifted (different
  // radii, paddings, text sizes, and an (i) button in guided only) — see design §1.3.
  //
  // The page keeps the {#if} visibility gate: guided shows the dock on `flaggedFaces.length > 0`, manual on
  // `vm.loadedCount > 0`. Those are genuinely different conditions over different models, so this component is
  // only ever rendered when it should be visible and has no hidden state of its own.

  interface DockAction {
    id: FaceActionId;
    /** Preserved verbatim per page — the e2e suite targets these, not labels. */
    testId: string;
  }

  interface Props {
    mode: FaceReviewMode;
    selectedCount: number;
    actions: DockAction[];
    onAction: (id: FaceActionId) => void;
    onHelp: () => void;
    onClear: () => void;
    /** Everything left of Apply while nothing is selected. Guided renders a tally, a rest-of-cluster chip and a
     *  blocked reason; manual renders four tally chips. One snippet, not a tally/apply pair, because guided's
     *  blocked reason sits BETWEEN the tally and the button and would have nowhere to live in a two-way split. */
    summary: Snippet;
    apply: Snippet;
  }

  const { mode, selectedCount, actions, onAction, onHelp, onClear, summary, apply }: Props = $props();

  // Drives BOTH the popover and the hint row, so the two can never describe different actions.
  let hoveredId: FaceActionId | null = $state(null);

  // Applying an action clears the selection, so the bar unmounts while the pointer is still over where a button
  // was. Only the inner branch unmounts, not this component, so without the reset a stale effect line greets the
  // next selection.
  $effect(() => {
    if (selectedCount === 0) {
      hoveredId = null;
    }
  });

  // `$props.id()` (Svelte 5.20+; this repo is on 5.56.5) — a per-instance id that is STABLE across SSR and
  // hydration. `Math.random()` or a module counter would generate different ids on the server and the client
  // and produce a hydration mismatch on an SSR'd admin route. Svelte requires the call itself to be the direct
  // initializer of a variable declaration, so it can't be inlined into the template literal below.
  const instanceId = $props.id();
  const hintId = `face-review-dock-hint-${instanceId}`;

  const hintText = $derived.by(() => {
    // Copied to an explicitly-annotated local first. `hoveredId`'s only assignments inside this <script> are
    // `null` (its declaration and the reset above) — every real assignment happens in a template event
    // handler further down — so TypeScript's control-flow analysis narrows it to `null` here, and the truthy
    // branch below would index FACE_ACTIONS with `never`. The annotation restores the declared type.
    const id: FaceActionId | null = hoveredId;
    if (!id) {
      return $t('admin.face_cleanup_review_bulk_hint_default');
    }
    return $t('admin.face_cleanup_review_bulk_hint_effect', {
      values: { action: $t(FACE_ACTIONS[id].labelKey), effect: $t(effectKeyFor(id, mode)) },
    });
  });

  const actionBtn =
    'relative inline-flex items-center gap-2 rounded-lg px-3.5 py-2 text-sm font-semibold ring-1 ring-inset transition-colors';
  const toneClass = (tone: 'default' | 'danger') =>
    tone === 'danger'
      ? 'bg-red-500/15 text-red-100 ring-red-400/30 hover:bg-red-500/25'
      : 'bg-white/10 text-white ring-white/15 hover:bg-white/20';
</script>

<div
  class="shrink-0 border-t border-gray-200 bg-white py-3.5 dark:border-gray-700 dark:bg-gray-900"
  data-testid="face-dock"
>
  <div class="mx-auto flex max-w-screen-xl flex-wrap items-center gap-3.5 px-6">
    {#if selectedCount === 0}
      {@render summary()}
      {@render apply()}
    {:else}
      <div
        class="flex flex-1 flex-col gap-2 rounded-2xl bg-gray-900 px-4 py-3 text-white dark:bg-gray-950"
        data-testid="face-bulk-bar"
      >
        <div class="flex flex-wrap items-center gap-2">
          <span class="mr-1 text-base font-bold whitespace-nowrap">
            {selectedCount}
            {$t('admin.face_cleanup_review_bulk_selected_suffix')}
          </span>
          <span class="h-6 w-px bg-white/15"></span>

          {#each actions as action (action.id)}
            {@const meta = FACE_ACTIONS[action.id]}
            <button
              type="button"
              class={`${actionBtn} ${toneClass(meta.tone)}`}
              data-testid={action.testId}
              data-tone={meta.tone}
              aria-describedby={hintId}
              onclick={() => onAction(action.id)}
              onmouseenter={() => (hoveredId = action.id)}
              onmouseleave={() => (hoveredId = null)}
              onfocusin={() => (hoveredId = action.id)}
              onfocusout={() => (hoveredId = null)}
            >
              {#if meta.buttonIcon}
                <Icon icon={meta.buttonIcon} size="16" />
              {/if}
              {$t(meta.labelKey)}

              {#if hoveredId === action.id}
                <!-- A local popover rather than @immich/ui's Tooltip: that component styles for the page
                     background rather than this dark bar, and needs a TooltipProvider these pages' isolated
                     specs don't have. aria-hidden because the hint row below already carries the text into the
                     accessibility tree via aria-describedby — announcing both would say it twice. -->
                <span
                  class="pointer-events-none absolute bottom-full left-1/2 z-10 mb-2 w-56 -translate-x-1/2 rounded-lg bg-gray-800 px-3 py-2 text-xs/relaxed font-normal text-gray-100 shadow-lg ring-1 ring-white/10"
                  data-testid="face-bulk-popover"
                  aria-hidden="true"
                >
                  {$t(meta.tipKey)}
                </span>
              {/if}
            </button>
          {/each}

          <button
            type="button"
            onclick={onHelp}
            aria-label={$t('admin.face_cleanup_review_help_open')}
            title={$t('admin.face_cleanup_review_help_open')}
            class="inline-flex items-center rounded-lg bg-white/10 p-2 ring-1 ring-white/15 ring-inset hover:bg-white/20"
            data-testid="face-bulk-help"
          >
            <Icon icon={mdiInformationOutline} size="16" />
          </button>

          <button
            type="button"
            onclick={onClear}
            class="ml-auto text-sm font-bold text-gray-300 hover:text-white"
            data-testid="face-bulk-clear"
          >
            {$t('admin.face_cleanup_review_bulk_clear')}
          </button>
        </div>

        <!-- Two reserved lines so swapping between the shortest and the longest effect string cannot change the
             dock's height and move the buttons out from under the pointer. -->
        <p id={hintId} class="line-clamp-2 min-h-8 text-xs/relaxed text-gray-300" data-testid="face-bulk-hint">
          {hintText}
        </p>
      </div>
    {/if}
  </div>
</div>
