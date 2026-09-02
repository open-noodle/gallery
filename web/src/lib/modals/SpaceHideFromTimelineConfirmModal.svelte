<script lang="ts">
  import { ConfirmModal } from '@immich/ui';
  import { mdiEyeOffOutline } from '@mdi/js';
  import { t } from 'svelte-i18n';

  interface Props {
    spaceName: string;
    count: number;
    onClose: (confirmed: boolean) => void;
  }

  let { spaceName, count, onClose }: Props = $props();
</script>

<ConfirmModal
  title={$t('spaces_hide_from_timeline_confirm_title', { values: { name: spaceName } })}
  prompt={$t('spaces_hide_from_timeline_confirm_prompt', { values: { count } })}
  icon={mdiEyeOffOutline}
  {onClose}
/>
