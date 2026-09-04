<script lang="ts">
  import { Checkbox, ConfirmModal, Label } from '@immich/ui';
  import { mdiEyeOffOutline } from '@mdi/js';
  import { t } from 'svelte-i18n';

  interface Props {
    albumName: string;
    spaceName: string;
    onClose: (result: { confirmed: boolean; alsoHideFromMyTimeline: boolean }) => void;
  }

  let { albumName, spaceName, onClose: onCloseParent }: Props = $props();

  // §2 mitigation: checked by default, so the common "declutter for everyone AND for me" case is
  // one click, while still leaving room for an editor who wants the two switches to diverge.
  let alsoHideFromMyTimeline = $state(true);

  const onClose = (confirmed: boolean) => {
    onCloseParent({ confirmed, alsoHideFromMyTimeline });
  };
</script>

<ConfirmModal
  title={$t('space_albums_hide_from_space_photos_confirm_title', {
    values: { album: albumName, space: spaceName },
  })}
  icon={mdiEyeOffOutline}
  {onClose}
>
  {#snippet prompt()}
    <p>{$t('space_albums_hide_from_space_photos_confirm_prompt')}</p>
    <div class="flex items-center justify-center gap-2 pt-4">
      <Checkbox id="also-hide-from-my-timeline-input" bind:checked={alsoHideFromMyTimeline} color="secondary" />
      <Label label={$t('space_albums_also_hide_from_my_timeline')} for="also-hide-from-my-timeline-input" />
    </div>
  {/snippet}
</ConfirmModal>
