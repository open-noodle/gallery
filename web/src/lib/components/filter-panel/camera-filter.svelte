<script lang="ts">
  import { t } from 'svelte-i18n';
  import type { FilterContext } from './filter-panel';

  interface Props {
    makes: string[];
    selectedMake?: string;
    selectedModel?: string;
    context?: FilterContext;
    onModelFetch: (make: string, context?: FilterContext) => Promise<string[]>;
    onSelectionChange: (make?: string, model?: string) => void;
    emptyText?: string;
  }

  let { makes, selectedMake, selectedModel, context, onModelFetch, onSelectionChange, emptyText }: Props = $props();

  let expandedMake = $state<string | undefined>(undefined);
  let models = $state<string[]>([]);
  let loadingModels = $state(false);

  // Orphaned make: selected but not in current results
  let orphanedMake = $derived(selectedMake && !makes.includes(selectedMake) ? selectedMake : undefined);

  /**
   * A make+model filter can arrive already selected — from a contextual filter clicked in the asset
   * viewer, from a shared link, or from a reload. The model level is lazily fetched and was only ever
   * expanded by a CLICK, so the panel showed a lone (unfilled) "Canon" row while the chip read
   * "Canon Canon EOS R6": no model row existed to tick. Reveal the level the selection lives on, the
   * same way location-filter reveals the city under its selected country.
   */
  $effect(() => {
    if (selectedMake && selectedModel && expandedMake !== selectedMake) {
      expandedMake = selectedMake;
    }
  });

  $effect(() => {
    if (expandedMake) {
      const _context = context;
      loadingModels = true;
      void onModelFetch(expandedMake, _context).then((result) => {
        models = result;
        loadingModels = false;
      });
    } else {
      models = [];
    }
  });

  /**
   * The fetched models, with the selected one guaranteed present.
   *
   * The model list is narrowed (by make, and on /photos under a search query by the smart-search
   * facets), so a model that is legitimately being filtered by can be absent from it. Since the
   * effect above now fetches on MOUNT rather than only on a click, dropping the selection there
   * would silently widen a shared `?make=…&model=…` link the moment it loads. Every other level of
   * this panel keeps an unlisted selection visible instead — `orphanedMake` here, orphaned
   * people/tags, the pinned city in location-filter — so the model does too, dimmed to say "not in
   * these results" and still clickable to remove.
   */
  let visibleModels = $derived(
    selectedModel && selectedMake === expandedMake && !models.includes(selectedModel)
      ? [...models, selectedModel]
      : models,
  );
  let orphanedModel = $derived(
    selectedModel && selectedMake === expandedMake && !models.includes(selectedModel) ? selectedModel : undefined,
  );

  function handleMakeClick(make: string) {
    if (selectedMake === make && !selectedModel) {
      // Deselect make
      expandedMake = undefined;
      onSelectionChange(undefined, undefined);
    } else {
      // Select make
      expandedMake = make;
      onSelectionChange(make, undefined);
    }
  }

  function handleModelClick(model: string, make: string) {
    if (selectedModel === model) {
      // Deselect model, keep make
      onSelectionChange(make, undefined);
    } else {
      // Select model (auto-fills make)
      onSelectionChange(make, model);
    }
  }
</script>

<div data-testid="camera-filter">
  {#if makes.length === 0 && !orphanedMake}
    <p class="text-sm text-gray-400 dark:text-gray-500" data-testid="camera-empty">
      {emptyText ?? $t('filter_no_cameras_found')}
    </p>
  {:else}
    <!-- Orphaned make (selected but no longer in suggestions) -->
    {#if orphanedMake}
      <button
        type="button"
        class="-mx-2 flex w-[calc(100%+1rem)] items-center gap-2 rounded-lg px-2 py-1.5 text-sm font-medium opacity-50 hover:bg-subtle"
        onclick={() => handleMakeClick(orphanedMake!)}
        aria-pressed="true"
        data-testid="camera-make-{orphanedMake}"
      >
        <div
          class="flex size-4 shrink-0 items-center justify-center rounded-full border-2 border-immich-primary bg-immich-primary dark:border-immich-dark-primary dark:bg-immich-dark-primary"
        >
          <div class="size-1.5 rounded-full bg-white dark:bg-black"></div>
        </div>
        <span class="flex-1 truncate text-left">{orphanedMake}</span>
      </button>
    {/if}

    {#each makes as make (make)}
      {@const isMakeSelected = selectedMake === make}
      <!-- Make row -->
      <button
        type="button"
        class="-mx-2 flex w-[calc(100%+1rem)] items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-subtle {isMakeSelected
          ? 'font-medium'
          : 'text-gray-500 dark:text-gray-300'}"
        onclick={() => handleMakeClick(make)}
        data-testid="camera-make-{make}"
      >
        <!-- Radio indicator -->
        <div
          class="flex size-4 shrink-0 items-center justify-center rounded-full border-2 {isMakeSelected &&
          !selectedModel
            ? 'border-immich-primary bg-immich-primary dark:border-immich-dark-primary dark:bg-immich-dark-primary'
            : 'border-gray-300 dark:border-gray-600'}"
        >
          {#if isMakeSelected && !selectedModel}
            <div class="size-1.5 rounded-full bg-white dark:bg-black"></div>
          {/if}
        </div>

        <!-- Label -->
        <span class="flex-1 truncate text-left">{make}</span>
      </button>

      <!-- Models (indented when make is expanded) -->
      {#if expandedMake === make && !loadingModels}
        {#each visibleModels as model (model)}
          {@const isModelSelected = selectedModel === model && selectedMake === make}
          <button
            type="button"
            class="-mx-2 ml-5 flex w-[calc(100%-1.25rem+1rem)] items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-subtle {orphanedModel ===
            model
              ? 'opacity-50'
              : ''} {isModelSelected ? 'font-medium' : 'text-gray-500 dark:text-gray-300'}"
            onclick={() => handleModelClick(model, make)}
            data-testid="camera-model-{model}"
          >
            <!-- Radio indicator -->
            <div
              class="flex size-4 shrink-0 items-center justify-center rounded-full border-2 {isModelSelected
                ? 'border-immich-primary bg-immich-primary dark:border-immich-dark-primary dark:bg-immich-dark-primary'
                : 'border-gray-300 dark:border-gray-600'}"
            >
              {#if isModelSelected}
                <div class="size-1.5 rounded-full bg-white dark:bg-black"></div>
              {/if}
            </div>

            <!-- Label -->
            <span class="flex-1 truncate text-left">{model}</span>
          </button>
        {/each}
      {/if}
    {/each}
  {/if}
</div>
