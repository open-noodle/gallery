<script lang="ts">
  import { Icon } from '@immich/ui';
  import { mdiImageAlbum, mdiImageMultipleOutline, mdiImageOffOutline } from '@mdi/js';
  import { t } from 'svelte-i18n';

  interface Props {
    selected: 'all' | 'has' | 'none';
    onChange: (value: 'all' | 'has' | 'none') => void;
  }

  let { selected, onChange }: Props = $props();

  const activeClass =
    'border-immich-primary bg-immich-primary/10 text-immich-primary dark:border-immich-dark-primary dark:bg-immich-dark-primary/20 dark:text-immich-dark-primary';
  const inactiveClass = 'border-gray-200 text-gray-500 dark:border-gray-700 dark:text-gray-400';

  // Full-width vertical rows: the labels ("Has no album" and its longer translations)
  // don't fit three-across in the 224px panel without wrapping, so each option gets its own row.
  let options = $derived<Array<{ value: 'all' | 'has' | 'none'; label: string; icon: string }>>([
    { value: 'all', label: $t('all'), icon: mdiImageAlbum },
    { value: 'has', label: $t('filter_has_album'), icon: mdiImageMultipleOutline },
    { value: 'none', label: $t('filter_has_no_album'), icon: mdiImageOffOutline },
  ]);
</script>

<div class="flex flex-col gap-1.5" data-testid="albums-filter">
  {#each options as option (option.value)}
    <button
      type="button"
      class="flex w-full items-center gap-2 rounded-lg border px-2.5 py-1.5 text-xs {selected === option.value
        ? activeClass
        : inactiveClass}"
      onclick={() => onChange(option.value)}
      data-testid="albums-{option.value}"
    >
      <Icon icon={option.icon} size="16" />
      {option.label}
    </button>
  {/each}
</div>
