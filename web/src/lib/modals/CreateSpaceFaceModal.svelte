<script lang="ts">
  import { handleError } from '$lib/utils/handle-error';
  import { createSpaceAssetFace, createSpacePerson } from '@immich/sdk';
  import { Field, FormModal, Input } from '@immich/ui';
  import { t } from 'svelte-i18n';

  /**
   * Space-flavoured sibling of `CreateFaceModal.svelte` (Slice 8, Task 2). §6.5's
   * `SpaceAssetFaceCreateDto.spacePersonId` is required -- a box cannot be drawn "unassigned" the
   * way the owner path allows -- so creating a brand-new space person for a freshly drawn box is
   * two calls: create the person (§6.2), then draw the box already attached to it (§6.5). No
   * feature-photo preview here (unlike the owner modal): a space person's representative face is
   * chosen separately, and skipping it keeps this modal to the one thing §6.2/§6.5 need -- a name.
   */
  type Props = {
    spaceId: string;
    assetId: string;
    imageWidth: number;
    imageHeight: number;
    x: number;
    y: number;
    width: number;
    height: number;
    onClose: (created?: boolean) => void;
  };

  let { spaceId, assetId, imageWidth, imageHeight, x, y, width, height, onClose }: Props = $props();
  let personName = $state('');
  let isSubmitting = $state(false);

  const getTrimmedName = () => personName.trim();

  const onSubmit = async () => {
    const name = getTrimmedName();
    if (!name) {
      return;
    }

    try {
      isSubmitting = true;

      const person = await createSpacePerson({ id: spaceId, sharedSpacePersonCreateDto: { name } });

      await createSpaceAssetFace({
        id: spaceId,
        assetId,
        spaceAssetFaceCreateDto: { spacePersonId: person.id, imageWidth, imageHeight, x, y, width, height },
      });

      onClose(true);
    } catch (error) {
      handleError(error, 'Error creating and tagging person');
    } finally {
      isSubmitting = false;
    }
  };
</script>

<FormModal
  size="small"
  title={$t('create_person')}
  submitText={$t('tag_face')}
  disabled={!getTrimmedName() || isSubmitting}
  {onClose}
  {onSubmit}
>
  <Field label={$t('name')}>
    <Input bind:value={personName} placeholder={$t('name')} disabled={isSubmitting} />
  </Field>
</FormModal>
