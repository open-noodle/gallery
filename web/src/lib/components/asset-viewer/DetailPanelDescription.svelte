<script lang="ts">
  import { shortcut } from '$lib/actions/shortcut';
  import { applyContextualFilter } from '$lib/utils/filter-target';
  import { handleError } from '$lib/utils/handle-error';
  import { updateAsset, type AssetResponseDto } from '@immich/sdk';
  import { IconButton, Textarea, toastManager } from '@immich/ui';
  import { mdiFilterOutline } from '@mdi/js';
  import { t } from 'svelte-i18n';
  import { fromAction } from 'svelte/attachments';

  interface Props {
    asset: AssetResponseDto;
    isOwner: boolean;
    /** R4/E2 — false on a shared link, where there is no timeline to filter. */
    canFilter?: boolean;
  }

  let { asset, isOwner, canFilter = false }: Props = $props();

  let description = $derived(asset.exifInfo?.description ?? '');

  /**
   * R6 — for the owner the description IS a focusable <Textarea> (clicking it places the caret), so
   * the filter cannot live on the value. It gets its own icon.
   *
   * R9 — and only when there is something to filter by: an empty or whitespace-only description
   * trims to nothing (filter-url.ts's setTrimmed), so the click would close the asset viewer and
   * apply no filter at all. No truncation here on purpose either — the codec already clamps to 200
   * CODE POINTS on both encode and decode.
   *
   * The click reads the CURRENT value: a pointer-down on the icon fires the textarea's focusout
   * first, so an edit the user just typed is saved by the very same interaction that filters by it.
   */
  let filterableDescription = $derived(description.trim());

  const handleFocusOut = async () => {
    const currentDescription = asset.exifInfo?.description ?? '';
    if (description === currentDescription) {
      return;
    }
    try {
      await updateAsset({ id: asset.id, updateAssetDto: { description } });
      toastManager.primary($t('asset_description_updated'));
    } catch (error) {
      handleError(error, $t('cannot_update_the_description'));
    }
  };
</script>

{#snippet filterButton()}
  {#if canFilter && filterableDescription}
    <IconButton
      icon={mdiFilterOutline}
      aria-label="{$t('filter_by_description')}: {filterableDescription}"
      size="small"
      shape="round"
      color="secondary"
      variant="ghost"
      onclick={() => applyContextualFilter({ description: filterableDescription })}
    />
  {/if}
{/snippet}

{#if isOwner}
  <section class="mt-10 flex items-end gap-1 px-4">
    <div class="min-w-0 flex-1">
      <Textarea
        bind:value={description}
        class="max-h-40 resize-none border-b border-gray-500 bg-transparent pl-0 ring-0 outline-none focus:border-b-2 focus:border-immich-primary focus:ring-0 dark:bg-transparent dark:focus:border-immich-dark-primary"
        rows={1}
        grow
        shape="rectangle"
        onfocusout={handleFocusOut}
        placeholder={$t('add_a_description')}
        data-testid="autogrow-textarea"
        {@attach fromAction(shortcut, () => ({
          shortcut: { key: 'Enter', ctrl: true },
          onShortcut: (e) => e.currentTarget.blur(),
        }))}
      />
    </div>
    {@render filterButton()}
  </section>
{:else if description}
  <section class="mt-6 flex items-start gap-1 px-4">
    <p class="w-full text-base wrap-break-word whitespace-pre-line text-black dark:text-white">{description}</p>
    {@render filterButton()}
  </section>
{/if}
