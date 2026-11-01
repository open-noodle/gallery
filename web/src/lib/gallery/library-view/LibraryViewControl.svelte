<script lang="ts">
  import { LibraryView } from '@immich/sdk';
  import PillGroup from '$lib/gallery/pill-group/PillGroup.svelte';
  import { t } from 'svelte-i18n';
  import { libraryView, type LibraryViewMode } from './library-view.svelte';
</script>

<PillGroup
  data-testid="library-view-control"
  label={$t('library_view')}
  options={[
    { value: 'both', label: $t('library_view_both') },
    {
      value: LibraryView.Personal,
      label: $t('library_view_personal'),
      title: $t('library_view_personal_description'),
    },
    { value: LibraryView.Spaces, label: $t('library_view_spaces'), title: $t('library_view_spaces_description') },
  ]}
  value={libraryView.current}
  onChange={(view: LibraryViewMode) => (libraryView.current = view)}
/>
