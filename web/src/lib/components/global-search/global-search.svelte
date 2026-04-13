<script lang="ts">
  import { Modal, ModalBody } from '@immich/ui';
  import { Command } from 'bits-ui';
  import { t } from 'svelte-i18n';
  import type { GlobalSearchManager } from '$lib/managers/global-search-manager.svelte';
  import GlobalSearchSection from './global-search-section.svelte';
  import PhotoRow from './rows/photo-row.svelte';
  import PersonRow from './rows/person-row.svelte';
  import PlaceRow from './rows/place-row.svelte';
  import TagRow from './rows/tag-row.svelte';
  import RecentRow from './rows/recent-row.svelte';
  import GlobalSearchFooter from './global-search-footer.svelte';
  import GlobalSearchPreview from './global-search-preview.svelte';
  import { mediaQueryManager } from '$lib/stores/media-query-manager.svelte';
  import { getEntries, type RecentEntry } from '$lib/stores/cmdk-recent';

  interface Props {
    manager: GlobalSearchManager;
  }
  let { manager }: Props = $props();

  // Initialize from the manager's query. Captures the current value at mount; subsequent changes
  // come through the $effect below.
  let inputValue = $state('');
  $effect(() => {
    inputValue = manager.query;
  });
  let selectedValue = $state<string>('');

  $effect(() => {
    manager.setQuery(inputValue);
  });

  $effect(() => {
    if (selectedValue) {
      manager.setActiveItem(selectedValue);
    }
  });

  $effect(() => {
    if (manager.activeItemId && manager.activeItemId !== selectedValue) {
      selectedValue = manager.activeItemId;
    }
  });

  const recentEntries = $derived<RecentEntry[]>(inputValue.trim() === '' ? getEntries() : []);
  const showPreview = $derived(mediaQueryManager.minLg);

  function onKeyDown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      if (inputValue !== '') {
        inputValue = '';
        e.preventDefault();
        return;
      }
      manager.close();
      e.preventDefault();
      return;
    }
    if (e.ctrlKey && e.key === 'k') {
      manager.close();
      e.preventDefault();
      return;
    }
    if (e.key === 'Home' || e.key === 'End') {
      // bits-ui tags each Command.Item with a data-command-item attribute (see
      // bits-ui command.svelte.js:1204 — `createBitsAttrs({ component: 'command' ... })`
      // yields `data-command-${part}`). Using the wrong attribute name silently breaks nav.
      const items = document.querySelectorAll<HTMLElement>('[data-command-item]');
      if (items.length === 0) {
        return;
      }
      const target = e.key === 'Home' ? items[0] : items[items.length - 1];
      const value = target.getAttribute('data-value');
      if (value) {
        manager.setActiveItem(value);
        e.preventDefault();
      }
    }
  }
</script>

<Modal
  size="large"
  closeOnEsc={false}
  closeOnBackdropClick={true}
  onClose={() => manager.close()}
  class="motion-reduce:transition-none motion-reduce:transform-none !p-0"
>
  {#snippet children()}
    <ModalBody class="!p-0">
      {#snippet children()}
        <span class="sr-only" id="global-search-label">{$t('global_search')}</span>
        <Command.Root
          shouldFilter={false}
          vimBindings={false}
          bind:value={selectedValue}
          aria-labelledby="global-search-label"
          class="flex flex-col"
        >
          <Command.Input
            bind:value={inputValue}
            placeholder={$t('cmdk_placeholder')}
            maxlength={256}
            onkeydown={onKeyDown}
            class="w-full border-b border-gray-200 bg-transparent px-4 py-3 text-sm focus:outline-none dark:border-gray-700"
          />

          <div class="flex min-h-[420px] max-h-[60vh] flex-1">
            <div class="flex flex-1 flex-col {showPreview ? 'border-e border-gray-200 dark:border-gray-700' : ''}">
              {#if manager.mode === 'smart' && !manager.mlHealthy && inputValue.trim() !== ''}
                <div class="mx-3 mt-3 rounded-md bg-subtle/60 px-3 py-2 text-xs">
                  {$t('cmdk_smart_unavailable')}
                  <button
                    type="button"
                    onclick={() => manager.setMode('metadata')}
                    class="ml-2 text-primary transition-colors duration-[80ms] ease-out"
                  >
                    {$t('cmdk_try_filename')}
                  </button>
                </div>
              {/if}
              <Command.List class="flex-1 overflow-y-auto py-2">
                {#if inputValue.trim() === ''}
                  {#if recentEntries.length > 0}
                    <Command.Group>
                      <Command.GroupHeading
                        class="px-3 pb-1 text-[11px] font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400"
                      >
                        {$t('cmdk_recent_heading')}
                      </Command.GroupHeading>
                      <Command.GroupItems>
                        {#each recentEntries as entry (entry.id)}
                          <Command.Item value={entry.id} onSelect={() => manager.activateRecent(entry)}>
                            <RecentRow {entry} />
                          </Command.Item>
                        {/each}
                      </Command.GroupItems>
                    </Command.Group>
                  {:else}
                    <div class="p-6 text-center text-[13px] font-normal text-gray-500 dark:text-gray-400">
                      {$t('cmdk_helper')}
                    </div>
                  {/if}
                {:else}
                  <GlobalSearchSection
                    heading={$t('cmdk_photos_heading')}
                    status={manager.sections.photos}
                    idPrefix="photo"
                    onActivate={(item) => manager.activate('photo', item)}
                  >
                    {#snippet renderRow(item)}
                      <PhotoRow item={item as never} />
                    {/snippet}
                  </GlobalSearchSection>
                  <GlobalSearchSection
                    heading={$t('cmdk_people_heading')}
                    status={manager.sections.people}
                    idPrefix="person"
                    onActivate={(item) => manager.activate('person', item)}
                  >
                    {#snippet renderRow(item)}
                      <PersonRow item={item as never} />
                    {/snippet}
                  </GlobalSearchSection>
                  <GlobalSearchSection
                    heading={$t('cmdk_places_heading')}
                    status={manager.sections.places}
                    idPrefix="place"
                    onActivate={(item) => manager.activate('place', item)}
                  >
                    {#snippet renderRow(item)}
                      <PlaceRow item={item as never} />
                    {/snippet}
                  </GlobalSearchSection>
                  <GlobalSearchSection
                    heading={$t('cmdk_tags_heading')}
                    status={manager.sections.tags}
                    idPrefix="tag"
                    onActivate={(item) => manager.activate('tag', item)}
                  >
                    {#snippet renderRow(item)}
                      <TagRow item={item as never} />
                    {/snippet}
                  </GlobalSearchSection>
                {/if}
              </Command.List>
            </div>
            {#if showPreview}
              <div data-cmdk-preview class="w-[280px] shrink-0 overflow-y-auto">
                <GlobalSearchPreview activeItem={manager.getActiveItem()} />
              </div>
            {/if}
          </div>

          <div aria-live="polite" aria-atomic="true" class="sr-only">{manager.announcementText}</div>
          <GlobalSearchFooter {manager} />
        </Command.Root>
      {/snippet}
    </ModalBody>
  {/snippet}
</Modal>
