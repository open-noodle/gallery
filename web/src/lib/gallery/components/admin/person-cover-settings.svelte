<script lang="ts">
  import SettingSwitch from '#lib/components/shared-components/settings/SettingSwitch.svelte';
  import type { AdminConfigDto } from '@immich/sdk';
  import { t } from 'svelte-i18n';

  // Person thumbnails picked by quality, inside the facial recognition section of the machine learning settings
  // (specs/2026-11-21-person-cover-quality-design.md). It needs no model, so it does not follow the ML switches.

  type Props = {
    configToEdit: AdminConfigDto;
    disabled: boolean;
  };

  let { configToEdit = $bindable(), disabled }: Props = $props();
</script>

<!-- An older server sends no `covers` block; the switch is then hidden rather than shown with nothing to bind. -->
{#if configToEdit.machineLearning.facialRecognition.covers}
  <hr />

  <SettingSwitch
    title={$t('admin.machine_learning_person_covers_setting')}
    subtitle={$t('admin.machine_learning_person_covers_setting_description')}
    bind:checked={configToEdit.machineLearning.facialRecognition.covers.enabled}
    {disabled}
  />
{/if}
