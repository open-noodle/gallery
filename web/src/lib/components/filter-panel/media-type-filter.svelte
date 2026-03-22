<script lang="ts">
  interface Props {
    selected: 'all' | 'image' | 'video';
    onTypeChange: (type: 'all' | 'image' | 'video') => void;
  }

  let { selected, onTypeChange }: Props = $props();

  const options: Array<{ value: 'all' | 'image' | 'video'; label: string }> = [
    { value: 'all', label: 'All' },
    { value: 'image', label: 'Photos' },
    { value: 'video', label: 'Videos' },
  ];
</script>

<div class="flex gap-1" data-testid="media-type-filter">
  {#each options as option (option.value)}
    {@const isActive = selected === option.value}
    <button
      type="button"
      class="rounded-[4px] border px-2 py-0.5 text-[10px] {isActive
        ? 'border-[var(--primary)] bg-[var(--primary-soft)] text-[var(--primary)]'
        : 'border-[var(--border)] text-[var(--fg-muted)]'}"
      onclick={() => onTypeChange(option.value)}
      data-testid="media-type-{option.value}"
    >
      {option.label}
    </button>
  {/each}
</div>
