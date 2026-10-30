<script lang="ts">
  import { Icon } from '@immich/ui';
  import { mdiArrowExpand } from '@mdi/js';
  import { t } from 'svelte-i18n';

  type Props = {
    id: string;
    /** Called with the tile's rect, so the photo window can grow out of it. */
    onExpand: (id: string, rect: DOMRect) => void;
    class?: string;
  };

  let { id, onExpand, class: className = '' }: Props = $props();

  const onclick = (event: MouseEvent) => {
    // The tile itself toggles its selection or mark on click; opening the window must not.
    event.stopPropagation();
    const tile = (event.currentTarget as HTMLElement).closest('[data-asset]') ?? (event.currentTarget as HTMLElement);
    onExpand(id, tile.getBoundingClientRect());
  };
</script>

<!-- Shown on hover and keyboard focus on pointer devices, always on touch screens (no hover to reveal it). -->
<button
  type="button"
  class="grid size-8 place-items-center rounded-full bg-black/55 text-white shadow-md backdrop-blur-sm transition-opacity duration-(--motion-quick) group-focus-within:opacity-100 group-hover:opacity-100 hover:bg-black/75 focus-visible:opacity-100 focus-visible:outline-2 focus-visible:outline-white pointer-fine:opacity-0 {className}"
  aria-label={$t('cleanup_view_larger')}
  title={$t('cleanup_view_larger')}
  data-testid="cleanup-expand-{id}"
  data-no-press
  {onclick}
>
  <Icon icon={mdiArrowExpand} size="16" />
</button>
