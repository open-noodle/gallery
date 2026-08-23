<script lang="ts">
  import AlbumCover from '$lib/components/album-page/AlbumCover.svelte';
  import DateInput from '$lib/elements/DateInput.svelte';
  import { handleUpdateAlbum } from '$lib/services/album.service';
  import { type AlbumResponseDto, type UpdateAlbumDto } from '@immich/sdk';
  import { Field, FormModal, Input, Label, Textarea } from '@immich/ui';
  import { mdiRenameOutline } from '@mdi/js';
  import { DateTime } from 'luxon';
  import { t } from 'svelte-i18n';

  type Props = {
    album: AlbumResponseDto;
    onClose: () => void;
  };

  let { album, onClose }: Props = $props();

  const LOCAL_FORMAT = "yyyy-MM-dd'T'HH:mm:ss.SSS";

  let albumName = $state(album.albumName);
  let description = $state(album.description);
  // `datetime-local` carries no zone, so this is the album's instant rendered in the
  // browser's zone. Luxon applies the historical offset for the date being edited.
  let createdAt = $state(DateTime.fromISO(album.createdAt).toFormat(LOCAL_FORMAT));

  const onSubmit = async () => {
    const dto: UpdateAlbumDto = { albumName, description: description || null };

    const edited = DateTime.fromISO(createdAt);
    const original = DateTime.fromISO(album.createdAt);
    const iso = edited.toISO();
    // Compare instants, never strings: the input is local and album.createdAt is UTC,
    // so string equality would rewrite createdAt on every unrelated edit.
    if (edited.isValid && iso && edited.toMillis() !== original.toMillis()) {
      dto.createdAt = iso;
    }

    const success = await handleUpdateAlbum(album, dto);
    if (success) {
      onClose();
    }
  };
</script>

<FormModal icon={mdiRenameOutline} title={$t('edit_album')} size="medium" {onClose} {onSubmit}>
  <div class="m-4 flex items-center gap-8">
    <AlbumCover {album} class="hidden size-50 shadow-lg sm:flex" />

    <div class="flex grow flex-col gap-4">
      <Field label={$t('name')}>
        <Input bind:value={albumName} />
      </Field>

      <!-- Not a `Field`: `Field` renders no label itself, it only publishes one on context for
           `@immich/ui` inputs to pick up. `DateInput` is a plain element and never reads that
           context, so wrapping it in `Field` renders the input with no label at all. Label it
           explicitly instead — the same pattern AssetSelectionChangeDateModal.svelte:82-83 uses.
           `size`/`color` mirror the Field defaults so this matches the fields around it. -->
      <div class="flex w-full flex-col gap-1">
        <Label for="album-edit-created-at" label={$t('date_created')} size="small" color="secondary" />
        <DateInput
          id="album-edit-created-at"
          type="datetime-local"
          class="immich-form-input w-full"
          data-testid="album-edit-created-at"
          bind:value={createdAt}
        />
      </div>

      <Field label={$t('description')}>
        <Textarea bind:value={description} />
      </Field>
    </div>
  </div>
</FormModal>
