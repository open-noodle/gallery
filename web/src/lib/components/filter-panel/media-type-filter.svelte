<script lang="ts">
  interface Props {
    selected: 'all' | 'image' | 'video';
    availableMediaTypes?: string[];
    onTypeChange: (type: 'all' | 'image' | 'video') => void;
  }

  let { selected, availableMediaTypes, onTypeChange }: Props = $props();

  const allOptions: Array<{ value: 'all' | 'image' | 'video'; label: string; assetType?: string }> = [
    { value: 'all', label: 'All' },
    { value: 'image', label: 'Photos', assetType: 'IMAGE' },
    { value: 'video', label: 'Videos', assetType: 'VIDEO' },
  ];

  let options = $derived(
    availableMediaTypes
      ? allOptions.filter(
          (o) => o.value === 'all' || o.value === selected || availableMediaTypes.includes(o.assetType!),
        )
      : allOptions,
  );
</script>

<div class="flex gap-1.5" data-testid="media-type-filter">
  {#each options as option (option.value)}
    {@const isActive = selected === option.value}
    {@const isOrphaned =
      availableMediaTypes !== undefined &&
      option.assetType !== undefined &&
      !availableMediaTypes.includes(option.assetType)}
    <button
      type="button"
      class="rounded-lg border px-2.5 py-1 text-xs {isOrphaned ? 'opacity-50' : ''}
        {isActive
        ? 'border-immich-primary bg-immich-primary/10 text-immich-primary dark:border-immich-dark-primary dark:bg-immich-dark-primary/20 dark:text-immich-dark-primary'
        : 'border-gray-200 text-gray-500 dark:border-gray-700 dark:text-gray-400'}"
      onclick={() => onTypeChange(option.value)}
      data-testid="media-type-{option.value}"
    >
      {option.label}
    </button>
  {/each}
</div>
