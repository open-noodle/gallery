<script lang="ts" module>
  export type PickerCandidate = {
    id: string;
    name: string;
    isHidden?: boolean;
    thumbnailUrl: string;
    /** Falls back to `name` -- callers with an owner/space-specific hidden-name format (see
     * `getPersonNameWithHiddenValue`) can supply a pre-formatted title instead. */
    title?: string;
  };
</script>

<script lang="ts">
  import ImageThumbnail from '$lib/components/assets/thumbnail/ImageThumbnail.svelte';
  import LoadingSpinner from '$lib/components/shared-components/LoadingSpinner.svelte';

  /**
   * The people-search list shared by the owner's `AssignFaceSidePanel` and the space-flavoured
   * `SpacePersonSidePanel` / `SpaceFaceEditor` (Slice 8, Task 2) -- purely presentational, so it
   * takes an already-resolved candidate list rather than fetching one itself.
   *
   * Thumbnails load lazily on purpose. A real library puts hundreds of people in here, and eager
   * loading fires that many requests the moment the picker opens -- over HTTP/1.1 they fill the
   * six-connection pool, so the write the next click issues queues behind them and the click
   * reads as having done nothing.
   */
  type Props = {
    candidates: PickerCandidate[];
    isLoading?: boolean;
    emptyLabel: string;
    onSelect: (candidate: PickerCandidate) => void;
  };

  let { candidates, isLoading = false, emptyLabel, onSelect }: Props = $props();
</script>

{#if isLoading}
  <div class="flex w-full justify-center">
    <LoadingSpinner />
  </div>
{:else if candidates.length === 0}
  <p class="text-center text-sm text-gray-500">{emptyLabel}</p>
{:else}
  <div class="mt-4 flex immich-scrollbar flex-wrap gap-2 overflow-y-auto">
    {#each candidates as candidate (candidate.id)}
      <div class="w-fit">
        <button type="button" class="w-22.5" onclick={() => onSelect(candidate)}>
          <div class="relative">
            <ImageThumbnail
              curve
              shadow
              url={candidate.thumbnailUrl}
              altText={candidate.title ?? candidate.name}
              title={candidate.title ?? candidate.name}
              widthStyle="90px"
              heightStyle="90px"
              hidden={candidate.isHidden}
              preload={false}
            />
          </div>

          <p class="mt-1 truncate font-medium" title={candidate.title ?? candidate.name}>
            {candidate.name}
          </p>
        </button>
      </div>
    {/each}
  </div>
{/if}
