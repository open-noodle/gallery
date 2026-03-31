<script lang="ts">
  import { handleError } from '$lib/utils/handle-error';
  import { Action2, getConfig, scanClassification, updateConfig, type SystemConfigDto } from '@immich/sdk';
  import { Button, IconButton, modalManager, Switch, Text, toastManager } from '@immich/ui';
  import { mdiContentSave, mdiDelete, mdiPencil, mdiPlus, mdiUndoVariant } from '@mdi/js';
  import { onMount } from 'svelte';

  type Category = SystemConfigDto['classification']['categories'][number];

  let config: SystemConfigDto | null = $state(null);
  let categories: Category[] = $state([]);
  let editingIndex: number | null = $state(null);
  let isCreating = $state(false);
  let isSaving = $state(false);
  let isScanning = $state(false);

  let formName = $state('');
  let formPrompts = $state('');
  let formSimilarity = $state(0.28);
  let formAction: Action2 = $state(Action2.Tag);
  let formEnabled = $state(true);

  const actionLabels: Record<string, string> = {
    tag: 'Tag only',
    tag_and_archive: 'Tag and archive',
  };

  const getSimilarityLabel = (value: number): string => {
    if (value < 0.22) {
      return 'Loose';
    }
    if (value > 0.35) {
      return 'Strict';
    }
    return 'Normal';
  };

  onMount(async () => {
    await refreshConfig();
  });

  const refreshConfig = async () => {
    try {
      config = await getConfig();
      categories = config.classification.categories;
    } catch (error) {
      handleError(error, 'Unable to load classification config');
    }
  };

  const startCreate = () => {
    editingIndex = null;
    isCreating = true;
    formName = '';
    formPrompts = '';
    formSimilarity = 0.28;
    formAction = Action2.Tag;
    formEnabled = true;
  };

  const startEdit = (index: number) => {
    const category = categories[index];
    isCreating = false;
    editingIndex = index;
    formName = category.name;
    formPrompts = category.prompts.join('\n');
    formSimilarity = category.similarity;
    formAction = category.action;
    formEnabled = category.enabled;
  };

  const cancelEdit = () => {
    editingIndex = null;
    isCreating = false;
  };

  const saveConfig = async (updatedCategories: Category[]) => {
    if (!config) {
      return;
    }
    await updateConfig({
      systemConfigDto: { ...config, classification: { ...config.classification, categories: updatedCategories } },
    });
    await refreshConfig();
  };

  const handleSave = async () => {
    isSaving = true;
    try {
      const prompts = formPrompts
        .split('\n')
        .map((p) => p.trim())
        .filter((p) => p.length > 0);

      const category: Category = {
        name: formName,
        prompts,
        similarity: formSimilarity,
        action: formAction,
        enabled: formEnabled,
      };

      const updated = [...categories];
      let isStricter = false;
      if (isCreating) {
        updated.push(category);
        toastManager.primary(`Category "${formName}" created`);
      } else if (editingIndex !== null) {
        isStricter = formSimilarity > categories[editingIndex].similarity;
        updated[editingIndex] = category;
        toastManager.primary(`Category "${formName}" updated`);
      }

      await saveConfig(updated);

      if (isStricter) {
        const shouldRescan = await modalManager.showDialog({
          title: 'Rescan photos?',
          prompt:
            'This category is now stricter. Would you like to remove existing auto-tags that may no longer match, unarchive affected photos, and rescan all photos?',
          confirmText: 'Yes',
        });

        if (shouldRescan) {
          await scanClassification();
          toastManager.primary('Rescan started — existing auto-tags will be re-evaluated');
        }
      }

      cancelEdit();
    } catch (error) {
      handleError(error, 'Unable to save category');
    } finally {
      isSaving = false;
    }
  };

  const handleDelete = async (index: number) => {
    const category = categories[index];
    try {
      const updated = categories.filter((_, i) => i !== index);
      await saveConfig(updated);
      toastManager.primary(`Category "${category.name}" deleted`);
    } catch (error) {
      handleError(error, 'Unable to delete category');
    }
  };

  const handleToggleEnabled = async (index: number) => {
    try {
      const updated = categories.map((c, i) => (i === index ? { ...c, enabled: !c.enabled } : c));
      await saveConfig(updated);
    } catch (error) {
      handleError(error, 'Unable to toggle category');
    }
  };

  const handleScan = async () => {
    const confirmed = await modalManager.showDialog({
      prompt: 'This will reclassify all assets across all users. Continue?',
    });
    if (!confirmed) {
      return;
    }
    isScanning = true;
    try {
      await scanClassification();
      toastManager.primary('Library scan started');
    } catch (error) {
      handleError(error, 'Unable to start library scan');
    } finally {
      isScanning = false;
    }
  };
</script>

<section class="my-4">
  {#if isCreating || editingIndex !== null}
    <div class="rounded-2xl border border-gray-200 dark:border-gray-800 bg-slate-50 dark:bg-gray-900 p-5">
      <Text fontWeight="semi-bold" class="mb-4">{isCreating ? 'New Category' : 'Edit Category'}</Text>

      <div class="flex flex-col gap-4">
        <div>
          <label for="category-name" class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Name</label
          >
          <input
            id="category-name"
            type="text"
            bind:value={formName}
            placeholder="e.g. Screenshots, Receipts, Memes"
            class="w-full rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2 text-sm text-gray-900 dark:text-gray-100 focus:border-immich-primary focus:outline-none"
          />
        </div>

        <div>
          <label for="category-prompts" class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            Prompts (one per line)
          </label>
          <textarea
            id="category-prompts"
            bind:value={formPrompts}
            rows="4"
            placeholder="a screenshot of a phone&#10;a screenshot of a computer&#10;a screen capture"
            class="w-full rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2 text-sm text-gray-900 dark:text-gray-100 focus:border-immich-primary focus:outline-none resize-y"
          ></textarea>
        </div>

        <div>
          <label for="category-similarity" class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            Similarity: {formSimilarity.toFixed(2)} ({getSimilarityLabel(formSimilarity)})
          </label>
          <div class="flex items-center gap-3">
            <span class="text-xs text-gray-500 dark:text-gray-400">Loose</span>
            <input
              id="category-similarity"
              type="range"
              min="0.15"
              max="0.45"
              step="0.01"
              bind:value={formSimilarity}
              class="flex-1"
            />
            <span class="text-xs text-gray-500 dark:text-gray-400">Strict</span>
          </div>
        </div>

        <div>
          <label for="category-action" class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            Action
          </label>
          <select
            id="category-action"
            bind:value={formAction}
            class="w-full rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2 text-sm text-gray-900 dark:text-gray-100 focus:border-immich-primary focus:outline-none"
          >
            <option value={Action2.Tag}>{actionLabels.tag}</option>
            <option value={Action2.TagAndArchive}>{actionLabels.tag_and_archive}</option>
          </select>
        </div>

        {#if editingIndex !== null}
          <div class="flex items-center gap-2">
            <Switch bind:checked={formEnabled} />
            <Text size="small">{formEnabled ? 'Enabled' : 'Disabled'}</Text>
          </div>
        {/if}

        <div class="flex justify-end gap-2">
          <Button shape="round" size="small" color="secondary" onclick={cancelEdit} leadingIcon={mdiUndoVariant}>
            Cancel
          </Button>
          <Button
            shape="round"
            size="small"
            onclick={handleSave}
            disabled={isSaving || !formName.trim() || !formPrompts.trim()}
            leadingIcon={mdiContentSave}
          >
            {isSaving ? 'Saving...' : 'Save'}
          </Button>
        </div>
      </div>
    </div>
  {/if}

  {#if categories.length > 0}
    {#each categories as category, index (category.name)}
      <div
        class="rounded-2xl border border-gray-200 dark:border-gray-800 mt-4 bg-slate-50 dark:bg-gray-900 p-4"
        class:opacity-50={!category.enabled}
      >
        <div class="flex items-center justify-between">
          <div class="flex items-center gap-3 flex-1 min-w-0">
            <div class="flex-1 min-w-0">
              <div class="flex items-center gap-2">
                <Text fontWeight="medium">{category.name}</Text>
                <span
                  class="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium
                    {category.action === 'tag_and_archive'
                    ? 'bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200'
                    : 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200'}"
                >
                  {actionLabels[category.action] ?? category.action}
                </span>
              </div>
              <Text size="tiny" color="muted">
                {category.prompts.length} prompt{category.prompts.length === 1 ? '' : 's'} &middot; {getSimilarityLabel(
                  category.similarity,
                )}
                ({category.similarity.toFixed(2)})
              </Text>
            </div>
          </div>

          <div class="flex items-center gap-2">
            <Switch checked={category.enabled} onCheckedChange={() => handleToggleEnabled(index)} />
            <IconButton
              shape="round"
              color="secondary"
              variant="ghost"
              icon={mdiPencil}
              size="small"
              onclick={() => startEdit(index)}
              aria-label="Edit"
            />
            <IconButton
              shape="round"
              color="secondary"
              variant="ghost"
              icon={mdiDelete}
              size="small"
              onclick={() => handleDelete(index)}
              aria-label="Delete"
            />
          </div>
        </div>
      </div>
    {/each}
  {:else if !isCreating}
    <Text class="py-4" color="muted">No classification categories yet. Add one to get started.</Text>
  {/if}

  <div class="flex justify-end gap-2 mt-5">
    <Button shape="round" size="small" color="secondary" onclick={handleScan} disabled={isScanning}>
      {isScanning ? 'Scanning...' : 'Scan All Libraries'}
    </Button>
    {#if !isCreating && editingIndex === null}
      <Button shape="round" size="small" onclick={startCreate} leadingIcon={mdiPlus}>Add Category</Button>
    {/if}
  </div>
</section>
