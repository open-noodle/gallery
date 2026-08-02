<script lang="ts">
  import { Tooltip } from '@immich/ui';
  import { clampOverflow } from '$lib/actions/clamp-overflow';

  interface Props {
    id: string;
    name: string;
    checked: boolean;
    /** Orphaned selections render faded — selected, but absent from the current suggestions. */
    dimmed?: boolean;
    onToggle: (id: string) => void;
  }

  let { id, name, checked, dimmed = false, onToggle }: Props = $props();

  let isOverflowing = $state(false);

  // The tooltip trigger supplies its own onclick, so we compose rather than replace it: this
  // component must not assume provider-level configuration it does not own. Today that handler is
  // inert because @immich/ui's shared TooltipProvider sets disableCloseOnTriggerClick app-wide —
  // but that is not this component's to rely on, so both handlers still run.
  function handleClick(triggerProps: Record<string, unknown>, event: MouseEvent) {
    (triggerProps.onclick as ((event: MouseEvent) => void) | undefined)?.(event);
    onToggle(id);
  }

  // When isOverflowing flips, @immich/ui's Tooltip below switches its `{#if text}` branch, which
  // destroys and recreates this button (see Tooltip.svelte in @immich/ui). Every clipped row
  // therefore mounts twice on first render (bare branch, then Tooltip.Root branch), and a
  // mid-session flip (window narrowed, a webfont finishing load) while that row holds keyboard
  // focus sends focus to <body>, since the focused element is destroyed. This is inherent to the
  // Tooltip's conditional rendering, not something this component can fix — out of scope here.
</script>

<Tooltip text={isOverflowing ? name : undefined}>
  {#snippet child({ props })}
    <button
      {...props}
      type="button"
      class="-mx-2 flex w-[calc(100%+1rem)] items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-subtle {checked
        ? 'font-medium'
        : 'text-gray-500 dark:text-gray-300'} {dimmed ? 'opacity-50' : ''}"
      onclick={(event) => handleClick(props, event)}
      aria-pressed={checked}
      data-testid="tags-item-{id}"
    >
      <div
        class="flex size-4 shrink-0 items-center justify-center rounded-sm {checked
          ? 'bg-immich-primary dark:bg-immich-dark-primary'
          : 'border border-gray-300 dark:border-gray-600'}"
      >
        {#if checked}
          <svg viewBox="0 0 24 24" class="size-3 text-white dark:text-black">
            <path fill="currentColor" d="M21,7L9,19L3.5,13.5L4.91,12.09L9,16.17L19.59,5.59L21,7Z" />
          </svg>
        {/if}
      </div>

      <!-- wrap-break-word is required, not cosmetic: without it an unbreakable token (a tag name
           with no space or hyphen to break on, e.g. Bilder_Nordlichter_Originalbilder_DMY) overflows
           horizontally, gets clipped by the panel, and clampOverflow reports a false "fits" — so the
           row loses its tooltip too. Note the singular `word`: Tailwind v4 renamed v3's
           `break-words`, and emits nothing at all for a name it does not recognise, so a misspelling
           here fails silently. R14 compiles this label's classes to catch exactly that. -->
      <!-- key includes `checked`, not just `name`: selecting a row flips its class from
           `text-gray-500 dark:text-gray-300` (font-weight 400) to `font-medium` (500), which changes
           the label's text metrics without changing its border box — so ResizeObserver never fires
           for this — and without `checked` here the action's update() never re-measures either. -->
      <span
        class="line-clamp-2 flex-1 text-left wrap-break-word"
        use:clampOverflow={{ onChange: (overflowing) => (isOverflowing = overflowing), key: `${name}|${checked}` }}
      >
        {name}
      </span>
    </button>
  {/snippet}
</Tooltip>
