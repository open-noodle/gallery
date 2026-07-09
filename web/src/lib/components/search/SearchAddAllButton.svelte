<script lang="ts">
  import { Button } from '@immich/ui';
  import { mdiPlus } from '@mdi/js';
  import { t } from 'svelte-i18n';

  interface Props {
    total: number;
    onclick: () => void;
  }

  const { total, onclick }: Props = $props();
</script>

{#if total > 0}
  <Button
    size="small"
    color="secondary"
    shape="round"
    leadingIcon={mdiPlus}
    {onclick}
    data-testid="add-all-to-collection"
  >
    {$t('add_all_search_results', { values: { count: total } })}
  </Button>
{/if}
