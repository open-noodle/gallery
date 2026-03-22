<script lang="ts">
  import type { TagOption } from './filter-panel';

  interface Props {
    tags: TagOption[];
    selectedIds: string[];
    onSelectionChange: (ids: string[]) => void;
  }

  let { tags, selectedIds, onSelectionChange }: Props = $props();

  function toggleTag(id: string) {
    const isSelected = selectedIds.includes(id);
    if (isSelected) {
      onSelectionChange(selectedIds.filter((tid) => tid !== id));
    } else {
      onSelectionChange([...selectedIds, id]);
    }
  }
</script>

<div data-testid="tags-filter">
  {#if tags.length === 0}
    <p class="text-[11px] text-[var(--fg-muted)]" data-testid="tags-empty">No tags available</p>
  {:else}
    {#each tags as tag (tag.id)}
      {@const isActive = selectedIds.includes(tag.id)}
      <button
        type="button"
        class="flex w-full items-center gap-1.5 py-1 text-[11px] {isActive
          ? 'font-medium text-[var(--fg)]'
          : 'text-[var(--fg-muted)]'}"
        onclick={() => toggleTag(tag.id)}
        data-testid="tags-item-{tag.id}"
      >
        <!-- Checkbox -->
        <div
          class="flex h-[13px] w-[13px] flex-shrink-0 items-center justify-center rounded-[3px] border-[1.5px] {isActive
            ? 'border-[var(--primary)] bg-[var(--primary)]'
            : 'border-[var(--border)]'}"
        >
          {#if isActive}
            <svg viewBox="0 0 24 24" class="h-[9px] w-[9px] text-white">
              <path fill="currentColor" d="M21,7L9,19L3.5,13.5L4.91,12.09L9,16.17L19.59,5.59L21,7Z" />
            </svg>
          {/if}
        </div>

        <!-- Label -->
        <span class="flex-1 overflow-hidden text-ellipsis whitespace-nowrap text-left">{tag.name}</span>
      </button>
    {/each}
  {/if}
</div>
