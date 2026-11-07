/**
Dispatches a bubbling, cancelable drag event on `target`, as a synthetic event (no
real drag gesture). A real `DataTransfer` cannot be pre-filled from a
test (and reads back empty outside a user drag), so the given stand-in is attached as the event's
`dataTransfer`. Resolves to `false` when a handler called `preventDefault()`, after Svelte has
flushed the updates the handlers queued.
*/
export const fireDragEvent = async (
  target: Element,
  type: 'dragstart' | 'dragend' | 'dragenter' | 'dragover' | 'dragleave' | 'drop',
  init: { dataTransfer?: DataTransfer } = {},
) => {
  const event = new DragEvent(type, { bubbles: true, cancelable: true });
  if (init.dataTransfer) {
    Object.defineProperty(event, 'dataTransfer', { value: init.dataTransfer });
  }
  const notPrevented = target.dispatchEvent(event);
  await Promise.resolve();
  return notPrevented;
};

/**
Dispatches `event` on `target` and resolves once Svelte has flushed the updates its handlers
queued, for events no user gesture produces on its own (`pointerenter` without moving the real
pointer, `focusout` with a chosen `relatedTarget`, …). Resolves to `false` when a handler called
`preventDefault()`.
*/
export const dispatchAndFlush = async (target: EventTarget, event: Event) => {
  const notPrevented = target.dispatchEvent(event);
  await Promise.resolve();
  return notPrevented;
};
