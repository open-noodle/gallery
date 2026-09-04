<script lang="ts">
  import { ConfirmModal } from '@immich/ui';
  import { mdiEyeOffOutline } from '@mdi/js';
  import { t } from 'svelte-i18n';

  interface Props {
    albumName: string;
    count: number;
    /**
     * #1041: photos in THIS album that stay on the caller's timeline because they also reach the
     * space another way — a direct add, or a linked external library (§3, "another visible path
     * wins"). Without this the dialog says "This removes 0 photos" about an album full of photos
     * and reads as broken; that is the exact shape the #1041 reporter hit with an external library.
     * Distinct from the space dialog's retained sentence, where the rescuing path is a DIFFERENT
     * space. Appended only when > 0 — with no overlap there is nothing to explain.
     */
    retainedCount?: number;
    onClose: (confirmed: boolean) => void;
  }

  let { albumName, count, retainedCount = 0, onClose }: Props = $props();

  const prompt = $derived(
    retainedCount > 0
      ? `${$t('space_albums_hide_from_my_timeline_confirm_prompt', { values: { count } })} ${$t(
          'space_albums_hide_from_my_timeline_confirm_retained',
          { values: { count: retainedCount } },
        )}`
      : $t('space_albums_hide_from_my_timeline_confirm_prompt', { values: { count } }),
  );
</script>

<ConfirmModal
  title={$t('space_albums_hide_from_my_timeline_confirm_title', { values: { name: albumName } })}
  {prompt}
  icon={mdiEyeOffOutline}
  {onClose}
/>
