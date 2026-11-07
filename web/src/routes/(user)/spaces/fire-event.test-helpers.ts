// Dispatches a synthetic DOM event the way the old testing-library `fireEvent.<type>` did, for the
// cases a real user gesture cannot reach: a drag carrying a hand-built DataTransfer, a key or focus
// event on a specific element, an `input` with a value already set. Returns `dispatchEvent`'s result,
// so `false` means a listener called preventDefault().

type EventInit = Record<string, unknown> & {
  dataTransfer?: unknown;
  target?: Record<string, unknown>;
};

const NON_BUBBLING = new Set(['focus', 'blur', 'mouseenter', 'mouseleave', 'load', 'error', 'scroll']);

const constructorFor = (type: string) => {
  if (type.startsWith('drag') || type === 'drop') {
    return DragEvent;
  }
  if (type.startsWith('key')) {
    return KeyboardEvent;
  }
  if (type.startsWith('pointer')) {
    return PointerEvent;
  }
  if (type.startsWith('mouse') || type === 'contextmenu' || type === 'click' || type === 'dblclick') {
    return MouseEvent;
  }
  if (type.startsWith('focus') || type === 'blur') {
    return FocusEvent;
  }
  if (type === 'wheel') {
    return WheelEvent;
  }
  if (type.startsWith('touch')) {
    return TouchEvent;
  }
  return Event;
};

export const fireEvent = (type: string, element: Element | Window | Document, init: EventInit = {}) => {
  const { dataTransfer, target, ...rest } = init;
  if (target) {
    Object.assign(element, target);
  }
  const EventType = constructorFor(type);
  const event = new EventType(type, { bubbles: !NON_BUBBLING.has(type), cancelable: true, composed: true, ...rest });
  if (dataTransfer !== undefined) {
    Object.defineProperty(event, 'dataTransfer', { value: dataTransfer });
  }
  return element.dispatchEvent(event);
};
