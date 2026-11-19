<script lang="ts">
  import OnEvents from '#lib/components/OnEvents.svelte';
  import MaintenanceBackupCard from '#lib/components/maintenance/MaintenanceBackupCard.svelte';
  import { authManager } from '#lib/managers/auth-manager.svelte.ts';
  import { getDatabaseBackupActions, handleRestoreDatabaseBackup } from '#lib/services/database-backups.service.ts';
  import { Button, ContextMenuButton } from '@immich/ui';
  import { t } from 'svelte-i18n';

  type Props = {
    filename: string;
    filesize: number;
    expectedVersion: string;
    timezone?: string;
  };

  const { filename, filesize, expectedVersion, timezone }: Props = $props();

  const isReadOnlyDemo = $derived(authManager.isReadOnlyDemo);

  const { Download, Delete } = $derived(getDatabaseBackupActions($t, filename));

  let isDeleting = $state(false);

  function onBackupDeleteStatus(event: { filename: string; isDeleting: boolean }) {
    if (event.filename === filename) {
      isDeleting = event.isDeleting;
    }
  }
</script>

<OnEvents {onBackupDeleteStatus} />

<MaintenanceBackupCard {filename} {filesize} {expectedVersion} {timezone}>
  {#snippet actions()}
    {#if !isReadOnlyDemo}
      <Button size="small" onclick={() => handleRestoreDatabaseBackup(filename)} disabled={isDeleting}>
        {$t('restore')}
      </Button>
      <ContextMenuButton
        disabled={isDeleting}
        position="top-right"
        aria-label={$t('open')}
        items={[Download, Delete]}
      />
    {/if}
  {/snippet}
</MaintenanceBackupCard>
