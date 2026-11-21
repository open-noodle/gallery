<script lang="ts">
  import SettingAccordion from '#lib/components/shared-components/settings/SettingAccordion.svelte';
  import SettingSwitch from '#lib/components/shared-components/settings/SettingSwitch.svelte';
  import { featureFlagsManager } from '#lib/managers/feature-flags-manager.svelte.ts';
  import { handleCreateJob } from '#lib/services/job.service.ts';
  import { ManualJobName, type AdminConfigServerDto } from '@immich/sdk';
  import { Button, Text, modalManager } from '@immich/ui';
  import { t } from 'svelte-i18n';

  // Asset versions' section of the server settings (specs/2026-11-07-asset-versions-design.md), saved with the rest of
  // `server` by the server settings' button row. Edits only matter while versions are on, so while versions are off
  // their switch shows off and cannot be changed (the saved choice is kept for when versions are turned on again).
  // While versions are off, an administrator can undo them: every version becomes a photo of its own again.

  interface Props {
    server: AdminConfigServerDto;
    disabled: boolean;
  }

  let { server = $bindable(), disabled }: Props = $props();

  // An older server's config has no `assetVersions`: the section is not shown (rule 6).
  const settings = $derived(server.assetVersions as AdminConfigServerDto['assetVersions'] | undefined);
  const off = $derived(disabled || !settings?.enabled);
  // Undoing is offered only while versions are off on the server (the saved setting, which the server's features
  // report) and the switch here is off too: with versions on, the files would be combined again right away. A server
  // that does not report the feature is read as "not off", so nothing is offered (rule 6).
  const canUndo = $derived(
    featureFlagsManager.valueOrUndefined?.assetVersions === false && settings?.enabled === false,
  );

  const undo = async () => {
    const confirmed = await modalManager.showDialog({
      title: $t('admin.asset_versions_undo'),
      prompt: $t('admin.asset_versions_undo_confirm'),
      confirmText: $t('admin.asset_versions_undo'),
    });
    if (confirmed) {
      await handleCreateJob({ name: ManualJobName.AssetVersionUndo });
    }
  };
</script>

{#if settings}
  <SettingAccordion
    key="asset-versions"
    title={$t('admin.asset_versions_settings')}
    subtitle={$t('admin.asset_versions_settings_description')}
  >
    <div class="ms-4 mt-4 flex flex-col gap-4">
      <SettingSwitch
        title={$t('admin.asset_versions_enabled')}
        subtitle={$t('admin.asset_versions_enabled_description')}
        {disabled}
        bind:checked={server.assetVersions.enabled}
      />

      <SettingSwitch
        title={$t('admin.asset_versions_detect_edits')}
        subtitle={$t('admin.asset_versions_detect_edits_description')}
        disabled={off}
        bind:checked={
          () => !!settings?.enabled && server.assetVersions.detectEdits,
          (checked) => (server.assetVersions.detectEdits = checked)
        }
      />

      {#if canUndo}
        <div class="flex flex-col items-start gap-2" data-testid="asset-versions-undo">
          <Text size="small" color="muted">{$t('admin.asset_versions_undo_description')}</Text>
          <Button size="small" color="secondary" onclick={undo}>{$t('admin.asset_versions_undo')}</Button>
        </div>
      {/if}
    </div>
  </SettingAccordion>
{/if}
