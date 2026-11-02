<script lang="ts">
  import { cropFacesFromAsset } from '$lib/gallery/stores/preferences.store';
  import { getRepresentativeThumbnailUrl } from '$lib/utils/person-avatar';
  import type { AssetResponseDto } from '@immich/sdk';
  import { IconButton } from '@immich/ui';
  import { mdiAccountBoxOutline, mdiCropFree } from '@mdi/js';
  import { t } from 'svelte-i18n';

  /** Switches the People row's avatars between profile faces and faces cropped from this photo. */
  type Props = {
    people: NonNullable<AssetResponseDto['people']>;
    isOwner: boolean;
    spaceId?: string;
  };

  const { people, isOwner, spaceId }: Props = $props();

  // Only offer the switch where it can actually do something. A viewer reaching this asset through
  // an album or partner share has no profile face to switch to, so for them the crop is the only
  // option and the button would be dead.
  const canChooseAvatarSource = $derived(
    people.some((person) => getRepresentativeThumbnailUrl(person, { isOwner, spaceId }) !== undefined),
  );
</script>

{#if canChooseAvatarSource}
  <IconButton
    aria-label={$cropFacesFromAsset ? $t('show_profile_faces') : $t('show_faces_from_photo')}
    icon={$cropFacesFromAsset ? mdiAccountBoxOutline : mdiCropFree}
    size="medium"
    shape="round"
    color="secondary"
    variant="ghost"
    onclick={() => cropFacesFromAsset.set(!$cropFacesFromAsset)}
  />
{/if}
