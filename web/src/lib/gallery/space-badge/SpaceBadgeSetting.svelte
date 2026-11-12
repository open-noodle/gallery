<script lang="ts">
  import { showSpaceBadges } from '#lib/gallery/stores/preferences.store.ts';
  import { Field, Switch } from '@immich/ui';
  import { t } from 'svelte-i18n';
</script>

<Field label={$t('show_space_badges')} description={$t('show_space_badges_description')}>
  <Switch bind:checked={$showSpaceBadges} />
</Field>
