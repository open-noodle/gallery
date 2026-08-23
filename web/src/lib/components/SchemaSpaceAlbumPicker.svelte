<script lang="ts">
  import { getSharedSpaceAlbums, type SharedSpaceLinkedAlbumDto } from '@immich/sdk';
  import { Label, Text } from '@immich/ui';
  import { t } from 'svelte-i18n';
  import Combobox, { asSelectedOption, type ComboBoxOption } from '$lib/components/shared-components/Combobox.svelte';

  type Props = {
    label: string;
    description?: string;
    /** The sibling `SpaceId` property's value. Scopes the album list; absent until one is chosen. */
    spaceId?: string;
    albumName: string;
  };

  let { label, description, spaceId, albumName = $bindable('') }: Props = $props();

  let albums = $state<SharedSpaceLinkedAlbumDto[]>([]);

  $effect(() => {
    const id = spaceId;

    if (!id) {
      albums = [];
      return;
    }

    const load = async () => {
      try {
        albums = await getSharedSpaceAlbums({ id });
      } catch {
        // The step resolves by name and creates what is missing, so an unavailable list is a lost
        // convenience, not a lost capability — fall back to free entry rather than block the editor.
        albums = [];
      }
    };

    void load();
  });

  // The step matches names trimmed and case-insensitively and takes the oldest on a tie, so two
  // rows differing only by case would be two ways to pick the same album.
  const options = $derived.by(() => {
    const result: ComboBoxOption[] = [];

    // A plain array rather than a Set: `svelte/prefer-svelte-reactivity` rejects a mutable built-in
    // Set inside a component, and a linked-album list is far too short for the lookup to matter.
    for (const album of albums) {
      const key = album.albumName.trim().toLowerCase();
      if (key === '' || result.some((option) => option.value.trim().toLowerCase() === key)) {
        continue;
      }

      result.push({ id: album.id, label: album.albumName, value: album.albumName });
    }

    return result;
  });

  // `asSelectedOption('')` renders the "unknown" placeholder, which is not what an empty field means.
  const selectedOption = $derived(albumName ? asSelectedOption(albumName) : undefined);
</script>

<div class="flex flex-col gap-2">
  <div class="flex flex-col gap-0.5">
    <Label for="space-album-picker" size="small" class="font-medium" {label} />
    {#if description}
      <Text color="muted" size="small">{description}</Text>
    {/if}
  </div>

  <Combobox
    {label}
    hideLabel
    {options}
    {selectedOption}
    allowCreate
    disabled={!spaceId}
    onSelect={(option) => (albumName = option?.value ?? '')}
    onTextInput={(value) => (albumName = value)}
  />

  {#if !spaceId}
    <!-- `HelperText` only renders inside a `Field`, which this component does not use. -->
    <Text color="muted" size="small">{$t('workflow_space_album_choose_space_first')}</Text>
  {/if}
</div>
