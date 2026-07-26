<script lang="ts">
  import ColorPicker from '$lib/components/spaces/color-picker.svelte';
  import { updateSpaceDetails } from '$lib/services/space.service';
  import { UserAvatarColor, type SharedSpaceResponseDto } from '@immich/sdk';
  import { Field, FormModal, Input, Textarea } from '@immich/ui';
  import { mdiAccountGroup } from '@mdi/js';
  import { t } from 'svelte-i18n';

  type Props = {
    space: SharedSpaceResponseDto;
    onClose: (updated?: boolean) => void;
  };

  let { space, onClose }: Props = $props();

  const originalDescription = space.description ?? '';

  let name = $state(space.name);
  let description = $state(originalDescription);
  let color = $state<UserAvatarColor>(space.color ?? UserAvatarColor.Primary);
  let isSubmitting = $state(false);

  // Renaming is the dominant path, so the autofocused name arrives pre-selected and typing
  // replaces it. Only on the FIRST focus — otherwise clicking to place the caret mid-word
  // would keep re-selecting the whole value.
  let hasSelectedName = false;
  const selectNameOnce = (event: FocusEvent & { currentTarget: HTMLInputElement }) => {
    if (hasSelectedName) {
      return;
    }
    hasSelectedName = true;
    event.currentTarget.select();
  };

  const onSubmit = async () => {
    try {
      isSubmitting = true;

      // Only send `description` when it actually changed. A space created without one stores
      // `null` server-side; always sending '' would clobber it on a pure rename. When the user
      // DOES change it (including clearing it to ''), send that verbatim — '' clears it
      // server-side, whereas omitting the key (or `undefined`) would leave the old value.
      const success = await updateSpaceDetails(space.id, {
        name: name.trim(),
        ...(description !== originalDescription && { description }),
        color,
      });
      if (success) {
        onClose(true);
      }
    } finally {
      isSubmitting = false;
    }
  };
</script>

<FormModal
  icon={mdiAccountGroup}
  title={$t('spaces_edit')}
  size="small"
  disabled={name.trim().length === 0 || isSubmitting}
  {onClose}
  {onSubmit}
>
  <div class="m-4 flex flex-col gap-4">
    <Field label={$t('name')} required>
      <Input
        bind:value={name}
        maxlength={100}
        autofocus
        onfocus={selectNameOnce}
        disabled={isSubmitting}
        data-testid="space-edit-name"
      />
    </Field>
    <Field label={$t('description')}>
      <Textarea bind:value={description} maxlength={500} disabled={isSubmitting} data-testid="space-edit-description" />
    </Field>
    <Field label={$t('color')}>
      <ColorPicker value={color} onchange={(c) => (color = c)} />
    </Field>
  </div>
</FormModal>
