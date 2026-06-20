import type { Action } from 'svelte/action';

export const longPress: Action<HTMLElement, { onLongPress: () => void }> = (element, params) => {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let didPress = false;
  const preventContextMenu = (event: Event) => event.preventDefault();
  const disposeables: (() => void)[] = [];

  const clear = () => {
    if (!timer) {
      return;
    }
    clearTimeout(timer);
    timer = null;
    for (const dispose of disposeables) {
      dispose();
    }
    disposeables.length = 0;
  };

  const start = () => {
    didPress = false;
    // 350ms long press (matches AlbumListItem).
    timer = setTimeout(() => {
      params.onLongPress();
      element.addEventListener('contextmenu', preventContextMenu, { once: true });
      disposeables.push(() => element.removeEventListener('contextmenu', preventContextMenu));
      didPress = true;
    }, 350);
  };

  const click = (event: MouseEvent) => {
    if (!didPress) {
      return;
    }
    event.stopPropagation();
    event.preventDefault();
  };

  element.addEventListener('click', click);
  element.addEventListener('pointerdown', start, true);
  element.addEventListener('pointerup', clear, { capture: true, passive: true });

  return {
    destroy: () => {
      element.removeEventListener('click', click);
      element.removeEventListener('pointerdown', start, true);
      element.removeEventListener('pointerup', clear, true);
    },
  };
};
