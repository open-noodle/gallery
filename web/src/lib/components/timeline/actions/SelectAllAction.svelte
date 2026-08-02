<script lang="ts">
  import type { AssetMultiSelectManager } from '$lib/managers/asset-multi-select-manager.svelte';
  import { TimelineManager } from '$lib/managers/timeline-manager/timeline-manager.svelte';
  import { selectAllAssets } from '$lib/utils/asset-utils';
  import { Button, IconButton } from '@immich/ui';
  import { mdiSelectAll, mdiSelectRemove } from '@mdi/js';
  import { t } from 'svelte-i18n';

  type Props = {
    /** Absent on surfaces with no timeline behind them (e.g. smart search results). */
    timelineManager?: TimelineManager;
    assetInteraction: AssetMultiSelectManager;
    withText?: boolean;
    /** Overrides the timeline-wide select-all — pass on non-timeline surfaces. */
    onSelectAll?: () => void;
  };

  let { timelineManager, assetInteraction, withText = false, onSelectAll }: Props = $props();
  const allAssetsSelected = $derived(assetInteraction.selectAll);

  const icon = $derived(allAssetsSelected ? mdiSelectRemove : mdiSelectAll);
  const label = $derived(allAssetsSelected ? $t('unselect_all') : $t('select_all'));
  const onclick = async () => {
    if (allAssetsSelected) {
      assetInteraction.clear();
      return;
    }
    if (onSelectAll) {
      onSelectAll();
      return;
    }
    if (timelineManager) {
      await selectAllAssets(timelineManager, assetInteraction);
    }
  };
</script>

{#if withText}
  <Button leadingIcon={icon} size="medium" color="secondary" variant="ghost" {onclick}>{label}</Button>
{:else}
  <IconButton shape="round" color="secondary" variant="ghost" aria-label={label} {icon} {onclick} />
{/if}
