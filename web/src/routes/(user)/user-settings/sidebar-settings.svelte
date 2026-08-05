<script lang="ts">
  import type { ComboBoxOption } from '$lib/components/shared-components/Combobox.svelte';
  import { SIDEBAR_MODES, sidebarModeStore, type SidebarMode } from '$lib/stores/sidebar-mode.svelte';
  import SettingCombobox from './SettingCombobox.svelte';
  import { t } from 'svelte-i18n';

  const labels: Record<SidebarMode, string> = $derived({
    auto: $t('sidebar_mode_auto'),
    expanded: $t('sidebar_mode_expanded'),
    rail: $t('sidebar_mode_rail'),
  });

  const options: ComboBoxOption[] = $derived(SIDEBAR_MODES.map((value) => ({ value, label: labels[value] })));
  const selectedOption = $derived({ value: sidebarModeStore.mode, label: labels[sidebarModeStore.mode] });

  const handleSelect = (option: ComboBoxOption | undefined) => {
    if (option && SIDEBAR_MODES.includes(option.value as SidebarMode)) {
      sidebarModeStore.mode = option.value as SidebarMode;
    }
  };
</script>

<div data-testid="sidebar-mode-setting">
  <SettingCombobox
    title={$t('sidebar_mode')}
    subtitle={$t('sidebar_mode_description')}
    comboboxPlaceholder={$t('sidebar_mode')}
    {options}
    {selectedOption}
    onSelect={handleSelect}
  />
</div>
