<script lang="ts">
  import { Container } from '@immich/ui';
  import { t } from 'svelte-i18n';
</script>

<Container size="large" center>
  <div class="flex flex-col gap-6 py-8">
    <h1 class="text-2xl font-medium">{$t('import_select_source')}</h1>
    <p class="text-gray-500">{$t('import_select_source_description')}</p>
  </div>
</Container>
