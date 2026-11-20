<script lang="ts">
  import {
    checkRenameState,
    isValidRenameName,
    renameFile,
    splitFileName,
  } from '#lib/gallery/asset-viewer/rename-file.ts';
  import { AssetRenameTargetState, type AssetResponseDto } from '@immich/sdk';
  import { Checkbox, Field, FormModal, Input, Label } from '@immich/ui';
  import { mdiRename } from '@mdi/js';
  import { debounce } from 'lodash-es';
  import { t } from 'svelte-i18n';

  type Props = {
    asset: AssetResponseDto;
    onClose: (renamed: boolean) => void;
  };

  let { asset, onClose }: Props = $props();

  // The dialog is opened for one asset and closed before another is shown.
  // svelte-ignore state_referenced_locally
  const original = splitFileName(asset.originalFileName);
  // Only a file in an external library is on disk for Gallery to rename (an upload's name is only a label).
  // svelte-ignore state_referenced_locally
  const isExternal = !!asset.libraryId;

  let name = $state(original.name);
  let renameOnDisk = $state(false);
  let targetState = $state<AssetRenameTargetState>();
  let isSubmitting = $state(false);
  let taken = $state(false);
  let lastCheck = 0;

  const trimmed = $derived(name.trim());
  const isExists = $derived(targetState === AssetRenameTargetState.Exists || taken);
  const isDisabled = $derived(
    isSubmitting || !isValidRenameName(name, original.extension) || trimmed === original.name || isExists,
  );

  const check = debounce(async (fileName: string) => {
    const call = ++lastCheck;
    const result = await checkRenameState(asset.id, fileName);
    if (call === lastCheck) {
      targetState = result;
    }
  }, 300);

  $effect(() => {
    taken = false;
    targetState = undefined;
    lastCheck++;

    if (renameOnDisk && isExternal && trimmed !== original.name && isValidRenameName(trimmed, original.extension)) {
      void check(trimmed);
    } else {
      check.cancel();
    }

    return () => check.cancel();
  });

  const onSubmit = async () => {
    isSubmitting = true;
    const outcome = await renameFile(asset, {
      name,
      extension: original.extension,
      renameOnDisk: renameOnDisk && isExternal,
      state: targetState,
    });
    isSubmitting = false;

    if (outcome === 'exists') {
      taken = true;
    } else if (outcome !== 'cancelled') {
      onClose(outcome === 'renamed');
    }
  };
</script>

<FormModal
  title={$t('rename_file')}
  icon={mdiRename}
  onClose={() => onClose(false)}
  {onSubmit}
  submitText={$t('rename')}
  disabled={isDisabled}
  size="small"
>
  <Field label={$t('filename')} invalid={isExists} disabled={isSubmitting}>
    <Input autofocus bind:value={name} trailingText={original.extension} data-testid="rename-file-input" />
  </Field>

  {#if isExists}
    <p class="mt-2 text-sm text-danger" role="alert" data-testid="rename-file-exists">
      {$t('rename_file_exists', { values: { name: trimmed + original.extension } })}
    </p>
  {/if}

  {#if isExternal}
    <div class="mt-4 flex items-center gap-2">
      <Checkbox id="rename-on-disk" bind:checked={renameOnDisk} disabled={isSubmitting} />
      <Label label={$t('rename_file_on_disk')} for="rename-on-disk" />
    </div>
  {/if}
</FormModal>
