<script lang="ts">
  import { transformManager } from '$lib/managers/edit/transform-manager.svelte';
  import { Field, Switch } from '@immich/ui';
  import { t } from 'svelte-i18n';
</script>

<div class="mt-6">
  <div class="mb-5">
    <div class="mb-2 flex items-center justify-between text-sm">
      <span>{$t('editor_adjust_exposure')}</span>
      <span class="text-immich-fg/70 tabular-nums dark:text-immich-dark-fg/70">{transformManager.exposure}</span>
    </div>
    <input
      type="range"
      min="-100"
      max="100"
      step="1"
      bind:value={transformManager.exposure}
      ondblclick={() => (transformManager.exposure = 0)}
      aria-label={$t('editor_adjust_exposure')}
      class="w-full"
    />
  </div>

  <div class="mb-5">
    <div class="mb-2 flex items-center justify-between text-sm">
      <span>{$t('editor_adjust_contrast')}</span>
      <span class="text-immich-fg/70 tabular-nums dark:text-immich-dark-fg/70">{transformManager.contrast}</span>
    </div>
    <input
      type="range"
      min="-100"
      max="100"
      step="1"
      bind:value={transformManager.contrast}
      ondblclick={() => (transformManager.contrast = 0)}
      aria-label={$t('editor_adjust_contrast')}
      class="w-full"
    />
  </div>

  <div class="mb-6">
    <div class="mb-2 flex items-center justify-between text-sm">
      <span>{$t('editor_adjust_saturation')}</span>
      <span class="text-immich-fg/70 tabular-nums dark:text-immich-dark-fg/70">{transformManager.saturation}</span>
    </div>
    <input
      type="range"
      min="-100"
      max="100"
      step="1"
      bind:value={transformManager.saturation}
      ondblclick={() => (transformManager.saturation = 0)}
      aria-label={$t('editor_adjust_saturation')}
      class="w-full"
    />
  </div>

  <Field label={$t('editor_adjust_invert')} class="mb-4">
    <Switch bind:checked={transformManager.invert} />
  </Field>
</div>
