<script lang="ts">
  import { ConfirmModal } from '@immich/ui';
  import { mdiEyeOffOutline } from '@mdi/js';
  import { t } from 'svelte-i18n';

  interface Props {
    spaceName: string;
    count: number;
    /**
     * #1041: photos in this space that stay on the caller's timeline because another space they
     * still show also holds them (§3, "another visible path wins"). Without this the dialog can say
     * "removes 3 photos" about a 58,977-photo space and read as broken. Appended only when > 0 —
     * with no overlap there is nothing to explain.
     */
    retainedCount?: number;
    onClose: (confirmed: boolean) => void;
  }

  let { spaceName, count, retainedCount = 0, onClose }: Props = $props();

  const prompt = $derived(
    retainedCount > 0
      ? `${$t('spaces_hide_from_timeline_confirm_prompt', { values: { count } })} ${$t(
          'spaces_hide_from_timeline_confirm_retained',
          { values: { count: retainedCount } },
        )}`
      : $t('spaces_hide_from_timeline_confirm_prompt', { values: { count } }),
  );
</script>

<ConfirmModal
  title={$t('spaces_hide_from_timeline_confirm_title', { values: { name: spaceName } })}
  {prompt}
  icon={mdiEyeOffOutline}
  {onClose}
/>
