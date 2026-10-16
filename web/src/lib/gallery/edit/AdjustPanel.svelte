<script lang="ts">
  import { imageAdjustManager } from '$lib/gallery/edit/image-adjust-manager.svelte';
  import { Button, Field, HStack, Switch } from '@immich/ui';
  import { t } from 'svelte-i18n';

  type Slider = 'exposure' | 'contrast' | 'saturation';

  const sliders: { key: Slider; label: string }[] = $derived([
    { key: 'exposure', label: $t('editor_adjust_exposure') },
    { key: 'contrast', label: $t('editor_adjust_contrast') },
    { key: 'saturation', label: $t('editor_adjust_saturation') },
  ]);
</script>

<!-- Edit (these sliders) or Crop (Immich's aspect-ratio grid, which TransformTool hides while Edit shows). -->
<HStack class="mt-6">
  {#each ['edit', 'crop'] as const as mode (mode)}
    <Button
      class="w-full"
      shape="round"
      size="small"
      onclick={() => (imageAdjustManager.mode = mode)}
      color={imageAdjustManager.mode === mode ? 'primary' : 'secondary'}
      variant={imageAdjustManager.mode === mode ? 'filled' : 'outline'}
    >
      {mode === 'edit' ? $t('edit') : $t('crop')}
    </Button>
  {/each}
</HStack>

{#if imageAdjustManager.mode === 'edit'}
  <div class="mt-6">
    {#each sliders as { key, label } (key)}
      <div class="mb-5">
        <div class="mb-2 flex items-center justify-between text-sm">
          <span>{label}</span>
          <span class="text-immich-fg/70 tabular-nums dark:text-immich-dark-fg/70">{imageAdjustManager[key]}</span>
        </div>
        <input
          type="range"
          min="-100"
          max="100"
          step="1"
          bind:value={imageAdjustManager[key]}
          ondblclick={() => (imageAdjustManager[key] = 0)}
          aria-label={label}
          class="w-full"
        />
      </div>
    {/each}

    <Field label={$t('editor_adjust_invert')} class="mb-4">
      <Switch bind:checked={imageAdjustManager.invert} />
    </Field>
  </div>
{/if}
