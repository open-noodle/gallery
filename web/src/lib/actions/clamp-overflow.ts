import type { ActionReturn } from 'svelte/action';

export interface ClampOverflowParams {
  /** Called on mount, then only when the overflow verdict changes. */
  onChange: (isOverflowing: boolean) => void;
  /** Re-measure when this changes (e.g. the label text). */
  key?: unknown;
}

interface Measurement {
  read: () => boolean;
  report: (isOverflowing: boolean) => void;
}

const pending = new Set<Measurement>();

/**
 * Takes every queued measurement together: all reads first, then all reports.
 *
 * A report can re-render its row (the tag filter only wraps a row in a tooltip once it overflows),
 * and reading layout after a DOM write forces the browser to lay the page out again. Measuring each
 * node as it mounted therefore cost one layout per row — with a few thousand tag rows that froze
 * WebKit for ~15s on a single keystroke (#1125). Batched, the reads share one layout. A microtask
 * rather than a frame keeps the verdict ahead of the next paint, so a row never shows unclipped
 * without its tooltip.
 */
function flush() {
  const batch = [...pending];
  pending.clear();
  const verdicts = batch.map((measurement) => measurement.read());
  for (const [index, measurement] of batch.entries()) {
    measurement.report(verdicts[index]);
  }
}

function schedule(measurement: Measurement) {
  if (pending.size === 0) {
    queueMicrotask(flush);
  }
  pending.add(measurement);
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

  const measurement: Measurement = {
    read: () => node.scrollHeight > node.clientHeight,
    report: (isOverflowing) => {
      if (isOverflowing === previous) {
        return;
      }

      previous = isOverflowing;
      current.onChange(isOverflowing);
    },
  };

  schedule(measurement);

  // Guarded so a test missing the global stub fails on its assertion rather than on this constructor.
  const observer = globalThis.ResizeObserver ? new ResizeObserver(() => schedule(measurement)) : undefined;
  observer?.observe(node);

  return {
    update(next: ClampOverflowParams) {
      current = next;
      schedule(measurement);
    },
    destroy() {
      pending.delete(measurement);
      observer?.disconnect();
    },
  };
}
