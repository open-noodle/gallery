<script lang="ts">
  import SpacePickerModal from '$lib/modals/SpacePickerModal.svelte';
  import { getAllSpaces, type SharedSpaceResponseDto } from '@immich/sdk';
  import { Button, Label, modalManager, Text } from '@immich/ui';
  import { t } from 'svelte-i18n';

  type Props = {
    label: string;
    description?: string;
    spaceIds: string[];
    array?: boolean;
  };

  let { array, label, description, spaceIds = $bindable([]) }: Props = $props();

  let spaces = $state<SharedSpaceResponseDto[]>([]);

  $effect(() => {
    const load = async () => {
      try {
        spaces = await getAllSpaces();
      } catch {
        // A workflow outlives the spaces it points at. Failing to resolve names must never take the
        // step editor down — unresolved ids fall back to a removable placeholder.
        spaces = [];
      }
    };

    void load();
  });

  const nameFor = (id: string) => spaces.find((space) => space.id === id)?.name;

  const onChoose = async () => {
    const space = await modalManager.show(SpacePickerModal);
    if (!space) {
      return;
    }

    // Merge the picked space into local state so its name renders immediately. Without this the
    // chip would fall back to the "unavailable" placeholder until the next getAllSpaces() resolve.
    if (spaces.every((known) => known.id !== space.id)) {
      spaces = [...spaces, space];
    }

    spaceIds = array ? [...spaceIds, space.id] : [space.id];
  };

  const onRemove = (index: number) => {
    spaceIds = spaceIds.filter((_, i) => i !== index);
  };
</script>

<div class="flex flex-col gap-2">
  <div class="flex flex-col gap-0.5">
    <Label for="space-picker" size="small" class="font-medium" {label} />
    {#if description}
      <Text color="muted" size="small">{description}</Text>
    {/if}
  </div>

  <div class="flex flex-col gap-2">
    {#each spaceIds as spaceId, i (i)}
      <div class="flex items-center justify-between gap-2 rounded-lg border p-2" data-testid="space-chip">
        <Text size="small">{nameFor(spaceId) ?? $t('workflow_space_unavailable')}</Text>
        <Button size="small" shape="round" color="secondary" onclick={() => onRemove(i)}>{$t('remove')}</Button>
      </div>
    {/each}

    <!-- Always shown, even in single mode with a value already picked: clicking Choose again
         replaces it (onChoose replaces rather than appends when array is false). -->
    <Button size="small" shape="round" color="secondary" onclick={() => onChoose()}>{$t('choose')}</Button>
  </div>
</div>
