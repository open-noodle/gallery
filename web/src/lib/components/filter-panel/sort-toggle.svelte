<script lang="ts">
  import { Icon } from '@immich/ui';
  import { mdiSortCalendarAscending, mdiSortCalendarDescending } from '@mdi/js';

  interface Props {
    sortOrder: 'asc' | 'desc';
    onToggle: (order: 'asc' | 'desc') => void;
  }

  let { sortOrder, onToggle }: Props = $props();

  function handleClick() {
    onToggle(sortOrder === 'asc' ? 'desc' : 'asc');
  }

  let icon = $derived(sortOrder === 'asc' ? mdiSortCalendarAscending : mdiSortCalendarDescending);
  let title = $derived(sortOrder === 'asc' ? 'Sort: oldest first' : 'Sort: newest first');
</script>

<button
  type="button"
  class="flex h-8 w-8 items-center justify-center rounded-md text-[var(--fg-muted)] hover:bg-[var(--primary-soft)] hover:text-[var(--fg)]"
  onclick={handleClick}
  {title}
  data-testid="sort-toggle"
>
  <Icon {icon} size="18" />
</button>
