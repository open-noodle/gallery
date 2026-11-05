<script lang="ts">
  import MenuOption from '$lib/components/shared-components/context-menu/MenuOption.svelte';
  import { albumStackPreferences } from '$lib/gallery/stack/album-stack-preferences.svelte';
  import { mdiCheckboxBlankOutline, mdiCheckboxMarkedOutline } from '@mdi/js';
  import { t } from 'svelte-i18n';

  // The album options menu's stack settings (specs/2026-11-01-album-stack-collapse-design.md), kept per browser.
  const checkbox = (checked: boolean) => (checked ? mdiCheckboxMarkedOutline : mdiCheckboxBlankOutline);
</script>

<MenuOption
  icon={checkbox(albumStackPreferences.countInAlbum)}
  text={$t('album_stack_count_in_album')}
  onClick={() => (albumStackPreferences.countInAlbum = !albumStackPreferences.countInAlbum)}
/>
<MenuOption
  icon={checkbox(albumStackPreferences.stripInAlbum)}
  text={$t('album_stack_strip_in_album')}
  onClick={() => (albumStackPreferences.stripInAlbum = !albumStackPreferences.stripInAlbum)}
/>
