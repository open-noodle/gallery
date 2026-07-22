<script lang="ts">
  import OnEvents from '$lib/components/OnEvents.svelte';
  import { authManager } from '$lib/managers/auth-manager.svelte';
  import { getIntegrityReportItemActions } from '$lib/services/integrity.service';
  import type { IntegrityReport } from '@immich/sdk';
  import { ContextMenuButton, TableCell, TableRow } from '@immich/ui';
  import { t } from 'svelte-i18n';

  type Props = {
    id: string;
    path: string;
    reportType: IntegrityReport;
  };

  let { id, path, reportType }: Props = $props();
  let deleting = $state(false);

  const isReadOnlyDemo = $derived(authManager.isReadOnlyDemo);

  const { Download, Delete } = $derived(getIntegrityReportItemActions($t, id, reportType));

  const onIntegrityReportDeleteStatus = ({
    id: reportId,
    type,
    isDeleting,
  }: {
    id?: string;
    type?: IntegrityReport;
    isDeleting: boolean;
  }) => {
    if (type === reportType || reportId === id) {
      deleting = isDeleting;
    }
  };
</script>

<OnEvents {onIntegrityReportDeleteStatus} />

<TableRow>
  <TableCell class="w-7/8 px-4 text-left">{path}</TableCell>
  <TableCell class="flex w-1/8 justify-end">
    {#if !isReadOnlyDemo}
      <ContextMenuButton disabled={deleting} position="top-right" aria-label={$t('open')} items={[Download, Delete]} />
    {/if}
  </TableCell>
</TableRow>
