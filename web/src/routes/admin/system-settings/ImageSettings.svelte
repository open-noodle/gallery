<script lang="ts">
  import SettingSelect from './SettingSelect.svelte';
  import { Colorspace, ImageFormat, ImagePresetPosition, type AdminConfigImagePresetDto } from '@immich/sdk';
  import { Button, IconButton, Text } from '@immich/ui';
  import { mdiDelete, mdiPlus } from '@mdi/js';
  import { fade } from 'svelte/transition';

  import SettingAccordion from '$lib/components/shared-components/settings/SettingAccordion.svelte';
  import SettingInputField from '$lib/components/shared-components/settings/SettingInputField.svelte';
  import SettingSwitch from '$lib/components/shared-components/settings/SettingSwitch.svelte';
  import SettingButtonsRow from '$lib/components/shared-components/settings/SystemConfigButtonRow.svelte';
  import { SettingInputFieldType } from '$lib/constants';
  import { featureFlagsManager } from '$lib/managers/feature-flags-manager.svelte';
  import { systemConfigManager } from '$lib/managers/system-config-manager.svelte';
  import { t } from 'svelte-i18n';

  const disabled = $derived(featureFlagsManager.value.configFile);
  const config = $derived(systemConfigManager.value);
  let configToEdit = $state(systemConfigManager.cloneValue());

  // Gallery-fork: derived image presets (image.presets). A preset is an aspect ratio plus the widths a
  // client may request; the server derives the height and renders on demand. Mirrors the server-side
  // rules in server/src/utils/image-preset.ts. See specs/2026-09-22-derived-image-presets-design.md.
  const PRESET_NAME_PATTERN = /^[a-z0-9][a-z0-9-]{0,31}$/;
  const ASPECT_RATIO_PATTERN = /^\d{1,4}:\d{1,4}$/;

  configToEdit.image.presets ??= {};
  const presets = configToEdit.image.presets;

  const parseWidths = (text: string): number[] => {
    const widths: number[] = [];
    for (const part of text.split(/[\s,;]+/)) {
      const width = Number(part);
      if (Number.isSafeInteger(width) && width >= 16 && width <= 8192 && !widths.includes(width)) {
        widths.push(width);
      }
    }
    return widths;
  };

  // Widths are edited as free text and folded back into the config on every keystroke, so a
  // half-typed list never leaves the save payload in an invalid state (unparseable tokens drop out).
  let widthsText = $state<Record<string, string>>(
    Object.fromEntries(Object.entries(presets).map(([name, preset]) => [name, preset.widths.join(', ')])),
  );
  $effect(() => {
    for (const [name, text] of Object.entries(widthsText)) {
      const preset = presets[name];
      if (!preset) {
        continue;
      }
      const parsed = parseWidths(text);
      if (parsed.join(',') !== preset.widths.join(',')) {
        preset.widths = parsed;
      }
    }
  });

  let newPresetName = $state('');
  const newPresetNameValid = $derived(
    PRESET_NAME_PATTERN.test(newPresetName) && !Object.hasOwn(presets, newPresetName),
  );

  const addPreset = () => {
    if (!newPresetNameValid) {
      return;
    }
    const preset: AdminConfigImagePresetDto = {
      aspectRatio: '16:9',
      widths: [1600, 1280, 960, 640, 320],
      position: ImagePresetPosition.Center,
      format: ImageFormat.Webp,
      quality: 80,
    };
    presets[newPresetName] = preset;
    widthsText[newPresetName] = preset.widths.join(', ');
    newPresetName = '';
  };

  const removePreset = (name: string) => {
    delete presets[name];
    delete widthsText[name];
  };

  const isPresetEdited = (name: string, field: keyof AdminConfigImagePresetDto) => {
    const saved = config.image.presets?.[name];
    if (!saved) {
      return true;
    }
    return JSON.stringify(saved[field]) !== JSON.stringify(presets[name]?.[field]);
  };

  const presetNames = $derived(Object.keys(presets).sort());
  const positionOptions = $derived([
    { value: ImagePresetPosition.Center, text: $t('admin.image_preset_position_center') },
    { value: ImagePresetPosition.Attention, text: $t('admin.image_preset_position_attention') },
    { value: ImagePresetPosition.Entropy, text: $t('admin.image_preset_position_entropy') },
  ]);
</script>

<div>
  <div in:fade={{ duration: 500 }}>
    <form autocomplete="off" onsubmit={(event) => event.preventDefault()}>
      <div class="ms-4 mt-4">
        <SettingAccordion
          key="thumbnail-settings"
          title={$t('admin.image_thumbnail_title')}
          subtitle={$t('admin.image_thumbnail_description')}
        >
          <SettingSelect
            label={$t('admin.image_format')}
            desc={$t('admin.image_format_description')}
            bind:value={configToEdit.image.thumbnail.format}
            options={[
              { value: ImageFormat.Jpeg, text: 'JPEG' },
              { value: ImageFormat.Webp, text: 'WebP' },
            ]}
            name="format"
            isEdited={configToEdit.image.thumbnail.format !== config.image.thumbnail.format}
            {disabled}
            onSelect={(value) => {
              if (value === ImageFormat.Webp) {
                configToEdit.image.thumbnail.progressive = false;
              }
            }}
          />

          <SettingSelect
            label={$t('admin.image_resolution')}
            desc={$t('admin.image_resolution_description')}
            number
            bind:value={configToEdit.image.thumbnail.size}
            options={[
              { value: 1080, text: '1080p' },
              { value: 720, text: '720p' },
              { value: 480, text: '480p' },
              { value: 250, text: '250p' },
              { value: 200, text: '200p' },
            ]}
            name="resolution"
            isEdited={configToEdit.image.thumbnail.size !== config.image.thumbnail.size}
            {disabled}
          />

          <SettingInputField
            inputType={SettingInputFieldType.NUMBER}
            label={$t('admin.image_quality')}
            description={$t('admin.image_thumbnail_quality_description')}
            bind:value={configToEdit.image.thumbnail.quality}
            isEdited={configToEdit.image.thumbnail.quality !== config.image.thumbnail.quality}
            {disabled}
          />

          <SettingSwitch
            title={$t('admin.image_progressive')}
            subtitle={$t('admin.image_progressive_description')}
            checked={configToEdit.image.thumbnail.progressive}
            onToggle={(isChecked) => (configToEdit.image.thumbnail.progressive = isChecked)}
            isEdited={configToEdit.image.thumbnail.progressive !== config.image.thumbnail.progressive}
            disabled={disabled || configToEdit.image.thumbnail.format === ImageFormat.Webp}
          />
        </SettingAccordion>

        <SettingAccordion
          key="preview-settings"
          title={$t('admin.image_preview_title')}
          subtitle={$t('admin.image_preview_description')}
        >
          <SettingSelect
            label={$t('admin.image_format')}
            desc={$t('admin.image_format_description')}
            bind:value={configToEdit.image.preview.format}
            options={[
              { value: ImageFormat.Jpeg, text: 'JPEG' },
              { value: ImageFormat.Webp, text: 'WebP' },
            ]}
            name="format"
            isEdited={configToEdit.image.preview.format !== config.image.preview.format}
            {disabled}
            onSelect={(value) => {
              if (value === ImageFormat.Webp) {
                configToEdit.image.preview.progressive = false;
              }
            }}
          />

          <SettingSelect
            label={$t('admin.image_resolution')}
            desc={$t('admin.image_resolution_description')}
            number
            bind:value={configToEdit.image.preview.size}
            options={[
              { value: 2160, text: '4K' },
              { value: 1440, text: '1440p' },
              { value: 1080, text: '1080p' },
              { value: 720, text: '720p' },
            ]}
            name="resolution"
            isEdited={configToEdit.image.preview.size !== config.image.preview.size}
            {disabled}
          />

          <SettingInputField
            inputType={SettingInputFieldType.NUMBER}
            label={$t('admin.image_quality')}
            description={$t('admin.image_preview_quality_description')}
            bind:value={configToEdit.image.preview.quality}
            isEdited={configToEdit.image.preview.quality !== config.image.preview.quality}
            {disabled}
          />

          <SettingSwitch
            title={$t('admin.image_progressive')}
            subtitle={$t('admin.image_progressive_description')}
            checked={configToEdit.image.preview.progressive}
            onToggle={(isChecked) => (configToEdit.image.preview.progressive = isChecked)}
            isEdited={configToEdit.image.preview.progressive !== config.image.preview.progressive}
            disabled={disabled || configToEdit.image.preview.format === ImageFormat.Webp}
          />
        </SettingAccordion>

        <SettingAccordion
          key="fullsize-settings"
          title={$t('admin.image_fullsize_title')}
          subtitle={$t('admin.image_fullsize_description')}
        >
          <SettingSwitch
            title={$t('admin.image_fullsize_enabled')}
            subtitle={$t('admin.image_fullsize_enabled_description')}
            checked={configToEdit.image.fullsize.enabled}
            onToggle={(isChecked) => (configToEdit.image.fullsize.enabled = isChecked)}
            isEdited={configToEdit.image.fullsize.enabled !== config.image.fullsize.enabled}
            {disabled}
          />

          <hr class="my-4" />

          <SettingSelect
            label={$t('admin.image_format')}
            desc={$t('admin.image_format_description')}
            bind:value={configToEdit.image.fullsize.format}
            options={[
              { value: ImageFormat.Jpeg, text: 'JPEG' },
              { value: ImageFormat.Webp, text: 'WebP' },
            ]}
            name="format"
            isEdited={configToEdit.image.fullsize.format !== config.image.fullsize.format}
            disabled={disabled || !configToEdit.image.fullsize.enabled}
            onSelect={(value) => {
              if (value === ImageFormat.Webp) {
                configToEdit.image.fullsize.progressive = false;
              }
            }}
          />

          <SettingInputField
            inputType={SettingInputFieldType.NUMBER}
            label={$t('admin.image_quality')}
            description={$t('admin.image_fullsize_quality_description')}
            bind:value={configToEdit.image.fullsize.quality}
            isEdited={configToEdit.image.fullsize.quality !== config.image.fullsize.quality}
            disabled={disabled || !configToEdit.image.fullsize.enabled}
          />

          <SettingSwitch
            title={$t('admin.image_progressive')}
            subtitle={$t('admin.image_progressive_description')}
            checked={configToEdit.image.fullsize.progressive}
            onToggle={(isChecked) => (configToEdit.image.fullsize.progressive = isChecked)}
            isEdited={configToEdit.image.fullsize.progressive !== config.image.fullsize.progressive}
            disabled={disabled ||
              !configToEdit.image.fullsize.enabled ||
              configToEdit.image.fullsize.format === ImageFormat.Webp}
          />
        </SettingAccordion>

        <SettingAccordion
          key="derived-image-presets"
          title={$t('admin.image_presets_title')}
          subtitle={$t('admin.image_presets_description')}
        >
          <Text size="small" color="muted" class="mb-2">
            {$t('admin.image_presets_usage')}
            <code class="rounded-sm bg-gray-100 px-1 py-0.5 text-xs dark:bg-gray-800"
              >/api/assets/&lbrace;id&rbrace;/thumbnail?preset=&lbrace;name&rbrace;&amp;width=&lbrace;px&rbrace;</code
            >
          </Text>

          {#if presetNames.length === 0}
            <Text class="py-4" color="muted">{$t('admin.image_presets_empty')}</Text>
          {/if}

          {#each presetNames as name (name)}
            {@const preset = presets[name]}
            <div
              class="mt-4 rounded-2xl border border-gray-200 bg-slate-50 p-4 dark:border-gray-800 dark:bg-gray-900"
              data-testid="image-preset-{name}"
            >
              <div class="flex items-center justify-between gap-3">
                <Text fontWeight="medium" class="truncate">{name}</Text>
                <IconButton
                  shape="round"
                  color="secondary"
                  variant="ghost"
                  icon={mdiDelete}
                  size="small"
                  onclick={() => removePreset(name)}
                  aria-label={$t('admin.image_preset_remove', { values: { name } })}
                  {disabled}
                />
              </div>

              <SettingInputField
                inputType={SettingInputFieldType.TEXT}
                label={$t('admin.image_preset_aspect_ratio')}
                description={$t('admin.image_preset_aspect_ratio_description')}
                bind:value={preset.aspectRatio}
                required
                isEdited={isPresetEdited(name, 'aspectRatio')}
                {disabled}
              />
              {#if !ASPECT_RATIO_PATTERN.test(preset.aspectRatio)}
                <Text size="tiny" color="danger">{$t('admin.image_preset_aspect_ratio_invalid')}</Text>
              {/if}

              <SettingInputField
                inputType={SettingInputFieldType.TEXT}
                label={$t('admin.image_preset_widths')}
                description={$t('admin.image_preset_widths_description')}
                bind:value={widthsText[name]}
                required
                isEdited={isPresetEdited(name, 'widths')}
                {disabled}
              />
              {#if preset.widths.length === 0}
                <Text size="tiny" color="danger">{$t('admin.image_preset_widths_invalid')}</Text>
              {/if}

              <SettingSelect
                label={$t('admin.image_preset_position')}
                desc={$t('admin.image_preset_position_description')}
                bind:value={preset.position}
                options={positionOptions}
                name="position-{name}"
                isEdited={isPresetEdited(name, 'position')}
                {disabled}
              />

              <SettingSelect
                label={$t('admin.image_format')}
                desc={$t('admin.image_format_description')}
                bind:value={preset.format}
                options={[
                  { value: ImageFormat.Jpeg, text: 'JPEG' },
                  { value: ImageFormat.Webp, text: 'WebP' },
                ]}
                name="format-{name}"
                isEdited={isPresetEdited(name, 'format')}
                {disabled}
              />

              <SettingInputField
                inputType={SettingInputFieldType.NUMBER}
                min={1}
                max={100}
                label={$t('admin.image_quality')}
                description={$t('admin.image_preset_quality_description')}
                bind:value={preset.quality}
                isEdited={isPresetEdited(name, 'quality')}
                {disabled}
              />
            </div>
          {/each}

          <div class="mt-4 flex items-end gap-2">
            <div class="flex-1">
              <SettingInputField
                inputType={SettingInputFieldType.TEXT}
                label={$t('admin.image_preset_name')}
                description={$t('admin.image_preset_name_description')}
                bind:value={newPresetName}
                {disabled}
              />
            </div>
            <Button
              shape="round"
              size="small"
              leadingIcon={mdiPlus}
              onclick={addPreset}
              disabled={disabled || !newPresetNameValid}
            >
              {$t('admin.image_preset_add')}
            </Button>
          </div>
          {#if newPresetName.length > 0 && !newPresetNameValid}
            <Text size="tiny" color="danger">{$t('admin.image_preset_name_invalid')}</Text>
          {/if}
        </SettingAccordion>

        <div class="mt-4">
          <SettingSwitch
            title={$t('admin.image_prefer_wide_gamut')}
            subtitle={$t('admin.image_prefer_wide_gamut_setting_description')}
            checked={configToEdit.image.colorspace === Colorspace.P3}
            onToggle={(isChecked) => (configToEdit.image.colorspace = isChecked ? Colorspace.P3 : Colorspace.Srgb)}
            isEdited={configToEdit.image.colorspace !== config.image.colorspace}
            {disabled}
          />
        </div>

        <div class="mt-4">
          <SettingSwitch
            title={$t('admin.image_prefer_embedded_preview')}
            subtitle={$t('admin.image_prefer_embedded_preview_setting_description')}
            checked={configToEdit.image.extractEmbedded}
            onToggle={() => (configToEdit.image.extractEmbedded = !configToEdit.image.extractEmbedded)}
            isEdited={configToEdit.image.extractEmbedded !== config.image.extractEmbedded}
            {disabled}
          />
        </div>
      </div>

      <div class="ms-4 mt-4">
        <SettingButtonsRow bind:configToEdit keys={['image']} {disabled} />
      </div>
    </form>
  </div>
</div>
