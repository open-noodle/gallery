<script lang="ts">
  import SettingSwitch from '$lib/components/shared-components/settings/SettingSwitch.svelte';
  import type { AdminConfigServerDto } from '@immich/sdk';
  import { t } from 'svelte-i18n';

  interface Props {
    server: AdminConfigServerDto;
    disabled: boolean;
  }

  let { server = $bindable(), disabled }: Props = $props();
</script>

<SettingSwitch
  title={$t('admin.server_space_editors_can_add_members')}
  subtitle={$t('admin.server_space_editors_can_add_members_description')}
  {disabled}
  bind:checked={server.spaceEditorsCanAddMembers}
/>

<SettingSwitch
  title={$t('admin.server_space_editors_can_change_roles')}
  subtitle={$t('admin.server_space_editors_can_change_roles_description')}
  {disabled}
  bind:checked={server.spaceEditorsCanChangeRoles}
/>
