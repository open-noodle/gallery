<script lang="ts">
  import { ConfirmModal } from '@immich/ui';
  import { mdiEyeOffOutline } from '@mdi/js';
  import { t } from 'svelte-i18n';

  interface Props {
    albumName: string;
    count: number;
    onClose: (confirmed: boolean) => void;
  }

  let { albumName, count, onClose }: Props = $props();
</script>

<ConfirmModal
  title={$t('space_albums_hide_from_my_timeline_confirm_title', { values: { name: albumName } })}
  prompt={$t('space_albums_hide_from_my_timeline_confirm_prompt', { values: { count } })}
  icon={mdiEyeOffOutline}
  {onClose}
/>
