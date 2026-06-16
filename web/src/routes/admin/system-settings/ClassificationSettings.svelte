<script lang="ts">
  import { featureFlagsManager } from '$lib/managers/feature-flags-manager.svelte';
  import { handleError } from '$lib/utils/handle-error';
  import {
    Action,
    ClassificationFaceExclusion,
    getConfig,
    scanClassification,
    updateConfig,
    type SystemConfigDto,
  } from '@immich/sdk';
  import { Button, IconButton, modalManager, Switch, Text, toastManager } from '@immich/ui';
  import { mdiContentSave, mdiDelete, mdiPencil, mdiPlus, mdiUndoVariant } from '@mdi/js';
  import { onMount } from 'svelte';
  import { t } from 'svelte-i18n';
  import { get } from 'svelte/store';

  type Category = SystemConfigDto['classification']['categories'][number];
  type FaceExclusion = NonNullable<Category['faceExclusion']>;

  const disabled = $derived(featureFlagsManager.value.configFile);

  let config: SystemConfigDto | null = $state(null);
  let categories: Category[] = $state([]);
  let editingIndex: number | null = $state(null);
  let isCreating = $state(false);
  let isSaving = $state(false);
  let isScanning = $state(false);

  let formName = $state('');
  let formPrompts = $state('');
  let formSimilarity = $state(0.28);
  let formAction: Action = $state(Action.Tag);
  let formFaceExclusion: FaceExclusion = $state(ClassificationFaceExclusion.Off);
  let formEnabled = $state(true);

  const actionLabels: Record<string, string> = $derived({
    tag: $t('admin.classification_action_tag'),
    tag_and_archive: $t('admin.classification_action_tag_and_archive'),
  });

  const faceExclusionLabels: Record<FaceExclusion, string> = $derived({
    [ClassificationFaceExclusion.Off]: $t('admin.classification_face_exclusion_off'),
    [ClassificationFaceExclusion.AnyAssignedFace]: $t('admin.classification_face_exclusion_any_face'),
    [ClassificationFaceExclusion.NamedPeople]: $t('admin.classification_face_exclusion_named_people'),
    [ClassificationFaceExclusion.NamedVisiblePeople]: $t('admin.classification_face_exclusion_named_visible'),
  });

  const getFaceExclusion = (category: Partial<Category>): FaceExclusion =>
    category.faceExclusion ?? ClassificationFaceExclusion.Off;

  const getSimilarityLabel = (value: number): string => {
    if (value < 0.22) {
      return get(t)('admin.classification_similarity_loose');
    }
    if (value > 0.35) {
      return get(t)('admin.classification_similarity_strict');
    }
    return get(t)('admin.classification_similarity_normal');
  };

  onMount(async () => {
    await refreshConfig();
  });

  const refreshConfig = async () => {
    try {
      config = await getConfig();
      categories = config.classification.categories;
    } catch (error) {
      handleError(error, get(t)('admin.classification_load_failed'));
    }
  };

  const startCreate = () => {
    editingIndex = null;
    isCreating = true;
    formName = '';
    formPrompts = '';
    formSimilarity = 0.28;
    formAction = Action.Tag;
    formFaceExclusion = ClassificationFaceExclusion.Off;
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
    formFaceExclusion = getFaceExclusion(category);
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
        faceExclusion: formFaceExclusion,
        enabled: formEnabled,
      };

      const updated = [...categories];
      let isStricter = false;
      if (isCreating) {
        updated.push(category);
        toastManager.primary(get(t)('admin.classification_category_created', { values: { name: formName } }));
      } else if (editingIndex !== null) {
        isStricter = formSimilarity > categories[editingIndex].similarity;
        updated[editingIndex] = category;
        toastManager.primary(get(t)('admin.classification_category_updated', { values: { name: formName } }));
      }

      await saveConfig(updated);

      if (isStricter) {
        const shouldRescan = await modalManager.showDialog({
          title: get(t)('admin.classification_rescan_title'),
          prompt: get(t)('admin.classification_rescan_prompt'),
          confirmText: get(t)('yes'),
        });

        if (shouldRescan) {
          await scanClassification();
          toastManager.primary(get(t)('admin.classification_rescan_started'));
        }
      }

      cancelEdit();
    } catch (error) {
      handleError(error, get(t)('admin.classification_save_failed'));
    } finally {
      isSaving = false;
    }
  };

  const handleDelete = async (index: number) => {
    const category = categories[index];
    try {
      const updated = categories.filter((_, i) => i !== index);
      await saveConfig(updated);
      toastManager.primary(get(t)('admin.classification_category_deleted', { values: { name: category.name } }));
    } catch (error) {
      handleError(error, get(t)('admin.classification_delete_failed'));
    }
  };

  const handleToggleEnabled = async (index: number) => {
    try {
      const updated = categories.map((c, i) => (i === index ? { ...c, enabled: !c.enabled } : c));
      await saveConfig(updated);
    } catch (error) {
      handleError(error, get(t)('admin.classification_toggle_failed'));
    }
  };

  const handleScan = async () => {
    const confirmed = await modalManager.showDialog({
      prompt: get(t)('admin.classification_scan_confirm'),
    });
    if (!confirmed) {
      return;
    }
    isScanning = true;
    try {
      await scanClassification();
      toastManager.primary(get(t)('admin.classification_scan_started'));
    } catch (error) {
      handleError(error, get(t)('admin.classification_scan_failed'));
    } finally {
      isScanning = false;
    }
  };
</script>

<section class="my-4">
  {#if isCreating || editingIndex !== null}
    <div class="rounded-2xl border border-gray-200 dark:border-gray-800 bg-slate-50 dark:bg-gray-900 p-5">
      <Text fontWeight="semi-bold" class="mb-4"
        >{isCreating ? $t('admin.classification_new_category') : $t('admin.classification_edit_category')}</Text
      >

      <div class="flex flex-col gap-4">
        <div>
          <label for="category-name" class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
            >{$t('name')}</label
          >
          <input
            id="category-name"
            type="text"
            bind:value={formName}
            {disabled}
            placeholder={$t('admin.classification_name_placeholder')}
            class="w-full rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2 text-sm text-gray-900 dark:text-gray-100 focus:border-immich-primary focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed"
          />
        </div>

        <div>
          <label for="category-prompts" class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            {$t('admin.classification_prompts_label')}
          </label>
          <textarea
            id="category-prompts"
            bind:value={formPrompts}
            {disabled}
            rows="4"
            placeholder={$t('admin.classification_prompts_placeholder')}
            class="w-full rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2 text-sm text-gray-900 dark:text-gray-100 focus:border-immich-primary focus:outline-none resize-y disabled:opacity-50 disabled:cursor-not-allowed"
          ></textarea>
        </div>

        <div>
          <label for="category-similarity" class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            {$t('admin.classification_similarity_label', {
              values: { value: formSimilarity.toFixed(2), label: getSimilarityLabel(formSimilarity) },
            })}
          </label>
          <div class="flex items-center gap-3">
            <span class="text-xs text-gray-500 dark:text-gray-400">{$t('admin.classification_similarity_loose')}</span>
            <input
              id="category-similarity"
              type="range"
              min="0.01"
              max="1"
              step="0.01"
              bind:value={formSimilarity}
              {disabled}
              class="flex-1 disabled:opacity-50 disabled:cursor-not-allowed"
            />
            <span class="text-xs text-gray-500 dark:text-gray-400">{$t('admin.classification_similarity_strict')}</span>
          </div>
          <Text size="tiny" color="muted" class="mt-1">
            {$t('admin.classification_similarity_help')}
          </Text>
        </div>

        <div>
          <label for="category-action" class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            {$t('action')}
          </label>
          <select
            id="category-action"
            bind:value={formAction}
            {disabled}
            class="w-full rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2 text-sm text-gray-900 dark:text-gray-100 focus:border-immich-primary focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <option value={Action.Tag}>{actionLabels.tag}</option>
            <option value={Action.TagAndArchive}>{actionLabels.tag_and_archive}</option>
          </select>
        </div>

        <div>
          <label for="category-face-exclusion" class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            {$t('admin.classification_face_exclusion')}
          </label>
          <select
            id="category-face-exclusion"
            bind:value={formFaceExclusion}
            {disabled}
            class="w-full rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2 text-sm text-gray-900 dark:text-gray-100 focus:border-immich-primary focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <option value={ClassificationFaceExclusion.Off}>
              {faceExclusionLabels[ClassificationFaceExclusion.Off]}
            </option>
            <option value={ClassificationFaceExclusion.AnyAssignedFace}>
              {faceExclusionLabels[ClassificationFaceExclusion.AnyAssignedFace]}
            </option>
            <option value={ClassificationFaceExclusion.NamedPeople}>
              {faceExclusionLabels[ClassificationFaceExclusion.NamedPeople]}
            </option>
            <option value={ClassificationFaceExclusion.NamedVisiblePeople}>
              {faceExclusionLabels[ClassificationFaceExclusion.NamedVisiblePeople]}
            </option>
          </select>
        </div>

        {#if editingIndex !== null}
          <div class="flex items-center gap-2">
            <Switch bind:checked={formEnabled} {disabled} />
            <Text size="small">{formEnabled ? $t('enabled') : $t('disabled')}</Text>
          </div>
        {/if}

        <div class="flex justify-end gap-2">
          <Button shape="round" size="small" color="secondary" onclick={cancelEdit} leadingIcon={mdiUndoVariant}>
            {$t('cancel')}
          </Button>
          <Button
            shape="round"
            size="small"
            onclick={handleSave}
            disabled={disabled || isSaving || !formName.trim() || !formPrompts.trim()}
            leadingIcon={mdiContentSave}
          >
            {isSaving ? $t('admin.classification_saving') : $t('save')}
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
        <div class="flex items-center justify-between gap-3">
          <div class="flex items-center gap-3 flex-1 min-w-0">
            <div class="flex-1 min-w-0">
              <div class="min-w-0">
                <Text fontWeight="medium" class="block truncate break-words">{category.name}</Text>
              </div>
              <div class="mt-1 flex flex-wrap gap-2">
                <span
                  class="inline-flex max-w-full items-center rounded-full px-2 py-0.5 text-xs font-medium break-words whitespace-normal
                    {category.action === 'tag_and_archive'
                    ? 'bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200'
                    : 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200'}"
                >
                  {actionLabels[category.action] ?? category.action}
                </span>
                {#if getFaceExclusion(category) !== ClassificationFaceExclusion.Off}
                  <span
                    class="inline-flex max-w-full items-center rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800 break-words whitespace-normal dark:bg-emerald-900 dark:text-emerald-200"
                  >
                    {faceExclusionLabels[getFaceExclusion(category)]}
                  </span>
                {/if}
              </div>
              <Text size="tiny" color="muted">
                {$t('admin.classification_prompt_count', { values: { count: category.prompts.length } })} &middot; {getSimilarityLabel(
                  category.similarity,
                )}
                ({category.similarity.toFixed(2)})
              </Text>
            </div>
          </div>

          <div class="flex shrink-0 items-center gap-2">
            <Switch checked={category.enabled} onCheckedChange={() => handleToggleEnabled(index)} {disabled} />
            <IconButton
              shape="round"
              color="secondary"
              variant="ghost"
              icon={mdiPencil}
              size="small"
              onclick={() => startEdit(index)}
              aria-label={$t('edit')}
              {disabled}
            />
            <IconButton
              shape="round"
              color="secondary"
              variant="ghost"
              icon={mdiDelete}
              size="small"
              onclick={() => handleDelete(index)}
              aria-label={$t('delete')}
              {disabled}
            />
          </div>
        </div>
      </div>
    {/each}
  {:else if !isCreating}
    <Text class="py-4" color="muted">{$t('admin.classification_empty')}</Text>
  {/if}

  <div class="flex justify-end gap-2 mt-5">
    <Button shape="round" size="small" color="secondary" onclick={handleScan} disabled={disabled || isScanning}>
      {isScanning ? $t('admin.classification_scanning') : $t('admin.classification_scan_button')}
    </Button>
    {#if !isCreating && editingIndex === null}
      <Button shape="round" size="small" onclick={startCreate} leadingIcon={mdiPlus} {disabled}
        >{$t('admin.classification_add_category')}</Button
      >
    {/if}
  </div>
</section>
