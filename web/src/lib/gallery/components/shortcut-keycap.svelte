<script lang="ts">
  import { cleanClass } from '$lib';

  interface Props {
    /** The key as printed on the cap, e.g. `s` or `→`. */
    key: string;
    class?: string;
  }

  const { key, class: className }: Props = $props();
</script>

<!-- A hint, not a control: hidden from assistive tech (the button's own label is what gets announced) and from
     touch-only devices, which have no keyboard to press it on. -->
<kbd
  aria-hidden="true"
  class={cleanClass(
    'hidden min-w-5 items-center justify-center rounded border border-current/25 px-1 font-mono text-[0.7rem] leading-4 font-medium opacity-70 pointer-fine:inline-flex',
    className,
  )}
>
  {key}
</kbd>
