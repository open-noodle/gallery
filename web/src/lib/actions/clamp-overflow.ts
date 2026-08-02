import type { ActionReturn } from 'svelte/action';

export interface ClampOverflowParams {
  /** Called on mount, then only when the overflow verdict changes. */
  onChange: (isOverflowing: boolean) => void;
  /** Re-measure when this changes (e.g. the label text). */
  key?: unknown;
}

/**
 * Reports whether a node's content overflows its box vertically — the standard way to detect that a
 * `line-clamp` has actually clipped something.
 *
 * Only meaningful when the node also allows mid-word breaks (`wrap-break-word` — note the singular
 * `word`; Tailwind v4 renamed v3's `break-words` and silently emits nothing for an unrecognised
 * name). Without that, an unbreakable token overflows horizontally instead and this reports a false
 * "fits".
 */
export function clampOverflow(node: HTMLElement, params: ClampOverflowParams): ActionReturn<ClampOverflowParams> {
  let current = params;
  // Undefined rather than false: the mount-time verdict must always be reported, even when it is false.
  let previous: boolean | undefined;

  const measure = () => {
    const isOverflowing = node.scrollHeight > node.clientHeight;
    if (isOverflowing === previous) {
      return;
    }

    previous = isOverflowing;
    current.onChange(isOverflowing);
  };

  measure();

  // Guarded so a test missing the global stub fails on its assertion rather than on this constructor.
  const observer = globalThis.ResizeObserver ? new ResizeObserver(() => measure()) : undefined;
  observer?.observe(node);

  return {
    update(next: ClampOverflowParams) {
      current = next;
      measure();
    },
    destroy() {
      observer?.disconnect();
    },
  };
}
