<script lang="ts">
  import { LibraryView } from '@immich/sdk';
  import FilterSection from '$lib/components/filter-panel/filter-section.svelte';
  import { t } from 'svelte-i18n';
  import { libraryView, type LibraryViewMode } from './library-view.svelte';

  // The Photos library view (#1038) as the filter panel's first section, styled like Media type.
  let expanded = $state(true);

  const options = $derived<{ value: LibraryViewMode; label: string; title?: string }[]>([
    { value: 'both', label: $t('library_view_both') },
    {
      value: LibraryView.Personal,
      label: $t('library_view_personal'),
      title: $t('library_view_personal_description'),
    },
    { value: LibraryView.Spaces, label: $t('library_view_spaces'), title: $t('library_view_spaces_description') },
  ]);
</script>

<FilterSection
  title={$t('library_view')}
  testId="library-view"
  {expanded}
  onToggleExpanded={() => (expanded = !expanded)}
>
  <div class="flex flex-wrap gap-1.5" role="group" aria-label={$t('library_view')}>
    {#each options as option (option.value)}
      {@const isActive = libraryView.current === option.value}
      <button
        type="button"
        class="rounded-lg border px-2.5 py-1 text-xs
          {isActive
          ? 'border-immich-primary bg-immich-primary/10 text-immich-primary dark:border-immich-dark-primary dark:bg-immich-dark-primary/20 dark:text-immich-dark-primary'
          : 'border-gray-200 text-gray-500 dark:border-gray-700 dark:text-gray-400'}"
        title={option.title}
        aria-pressed={isActive}
        onclick={() => (libraryView.current = option.value)}
        data-testid="library-view-{option.value}"
      >
        {option.label}
      </button>
    {/each}
  </div>
</FilterSection>
