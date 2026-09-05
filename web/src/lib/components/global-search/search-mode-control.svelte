<script lang="ts">
  import type { SearchMode } from '$lib/managers/global-search-manager.svelte';
  import { Icon } from '@immich/ui';
  import { mdiChevronDown, mdiCreation, mdiFormatTitle, mdiOcr, mdiTextBoxOutline } from '@mdi/js';
  import { t, type Translations } from 'svelte-i18n';

  interface Props {
    variant: 'chip' | 'rail';
    mode: SearchMode;
    onSelect: (mode: SearchMode) => void;
    /**
     * True while a prefix scope (@person, #tag, …) is active. `setMode` is a no-op then,
     * so the control dims — but the inputs stay operable on purpose, so a keyboard user
     * can still queue a mode up for when the prefix is cleared. Deliberately no
     * `aria-disabled`; this mirrors the segmented control it replaces.
     */
    scoped?: boolean;
    /** True when the ML service is down, which makes smart search return nothing. */
    smartUnavailable?: boolean;
  }

  let { variant, mode, onSelect, scoped = false, smartUnavailable = false }: Props = $props();

  const options: Array<{ value: SearchMode; labelKey: Translations; icon: string }> = [
    { value: 'smart', labelKey: 'cmdk_mode_smart' as Translations, icon: mdiCreation },
    { value: 'metadata', labelKey: 'cmdk_mode_filename' as Translations, icon: mdiFormatTitle },
    { value: 'description', labelKey: 'cmdk_mode_description' as Translations, icon: mdiTextBoxOutline },
    { value: 'ocr', labelKey: 'cmdk_mode_ocr' as Translations, icon: mdiOcr },
  ];

  let open = $state(false);

  const activeOption = $derived(options.find((option) => option.value === mode) ?? options[0]);

  const unavailableTitle = (value: SearchMode) =>
    smartUnavailable && value === 'smart' ? $t('cmdk_smart_unavailable') : undefined;

  function select(value: SearchMode) {
    open = false;
    onSelect(value);
  }

  function closeOnOutsideClick(event: MouseEvent) {
    if (open && !(event.target as HTMLElement | null)?.closest('[data-testid="search-mode-chip"]')) {
      open = false;
    }
  }

  let menuElement = $state<HTMLElement | null>(null);

  const MENU_KEYS = new Set(['Escape', 'Enter', 'ArrowDown', 'ArrowUp', 'Home', 'End']);

  // The chip renders inside `Command.Root`, whose onKeyDown runs the top search on Enter,
  // moves the result selection on the arrows, and jumps it on Home/End — and the field's
  // `clickOutside` action closes the whole palette on Escape. Every key this menu owns has
  // to stop there, or picking a mode with the keyboard would also fire a search and
  // navigate away.
  function onMenuKeydown(event: KeyboardEvent) {
    if (!open || !MENU_KEYS.has(event.key)) {
      return;
    }
    event.stopPropagation();

    if (event.key === 'Escape') {
      open = false;
      event.preventDefault();
      return;
    }
    // Enter falls through to the button's own activation.
    if (event.key === 'Enter') {
      return;
    }

    const items = [...(menuElement?.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]') ?? [])];
    if (items.length === 0) {
      return;
    }
    // -1 while focus is still on the trigger, which is why the two arrows enter the list
    // from opposite ends rather than sharing one wrap-around expression.
    const current = items.indexOf(document.activeElement as HTMLButtonElement);
    let next: number;
    switch (event.key) {
      case 'Home': {
        next = 0;
        break;
      }
      case 'End': {
        next = items.length - 1;
        break;
      }
      case 'ArrowDown': {
        next = current === -1 ? 0 : (current + 1) % items.length;
        break;
      }
      default: {
        next = current === -1 ? items.length - 1 : (current - 1 + items.length) % items.length;
      }
    }
    items[next]?.focus();
    event.preventDefault();
  }

  // Sliding pill indicator, carried over from the footer segmented control this
  // replaces: track the selected label's box so the highlight actually travels
  // between positions. A colour-only transition reads as static.
  const labelRefs: HTMLLabelElement[] = $state([]);
  let pillLeft = $state(0);
  let pillWidth = $state(0);
  let pillReady = $state(false);

  $effect(() => {
    const element = labelRefs[options.findIndex((option) => option.value === mode)];
    if (element) {
      pillLeft = element.offsetLeft;
      pillWidth = element.offsetWidth;
      pillReady = true;
    }
  });
</script>

<svelte:window onclick={closeOnOutsideClick} />

{#if variant === 'chip'}
  <div class="relative shrink-0" data-testid="search-mode-chip">
    <button
      type="button"
      aria-label="{$t('cmdk_search_mode')}: {$t(activeOption.labelKey)}"
      aria-haspopup="menu"
      aria-expanded={open}
      data-testid="search-mode-chip-trigger"
      data-scoped={scoped}
      onclick={() => (open = !open)}
      onkeydown={onMenuKeydown}
      class="flex items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-2 py-1 text-[11px] font-semibold tracking-wide text-gray-600 transition-colors duration-150 hover:border-primary/50 hover:text-primary dark:border-immich-dark-gray dark:bg-immich-dark-bg dark:text-gray-300 dark:hover:text-primary {scoped
        ? 'opacity-50'
        : ''}"
    >
      <Icon icon={activeOption.icon} size="1em" aria-hidden />
      <span>{$t(activeOption.labelKey)}</span>
      <Icon icon={mdiChevronDown} size="0.9em" aria-hidden />
    </button>

    {#if open}
      <div
        role="menu"
        aria-label={$t('cmdk_search_mode')}
        tabindex="-1"
        bind:this={menuElement}
        onkeydown={onMenuKeydown}
        class="absolute inset-e-0 top-full z-50 mt-1.5 min-w-[180px] overflow-hidden rounded-xl border border-gray-200 bg-white py-1 shadow-[0_18px_48px_rgba(15,23,42,0.18)] dark:border-gray-700 dark:bg-immich-dark-bg"
      >
        {#each options as option (option.value)}
          <button
            type="button"
            role="menuitemradio"
            aria-checked={mode === option.value}
            data-testid="search-mode-option-{option.value}"
            title={unavailableTitle(option.value)}
            onclick={() => select(option.value)}
            class="flex w-full items-center gap-2.5 px-3 py-2 text-start text-sm transition-colors duration-80 hover:bg-subtle {mode ===
            option.value
              ? 'font-semibold text-primary'
              : 'text-gray-700 dark:text-gray-200'} {unavailableTitle(option.value) ? 'opacity-50' : ''}"
          >
            <Icon icon={option.icon} size="1.05em" aria-hidden />
            <span>{$t(option.labelKey)}</span>
          </button>
        {/each}
      </div>
    {/if}
  </div>
{/if}

{#if variant === 'rail'}
  <div
    role="radiogroup"
    aria-label={$t('cmdk_search_mode')}
    data-testid="search-mode-rail"
    data-scoped={scoped}
    class="relative mx-4 my-2 flex w-fit max-w-full items-center gap-0 overflow-x-auto rounded-lg bg-subtle/50 p-0.5 font-mono text-[11px] font-medium uppercase {scoped
      ? 'opacity-50'
      : ''}"
  >
    {#if pillReady}
      <div
        aria-hidden="true"
        class="absolute inset-y-0.5 rounded-md bg-primary/10 transition-all duration-180 ease-out"
        style:left="{pillLeft}px"
        style:width="{pillWidth}px"
      ></div>
    {/if}
    {#each options as option, index (option.value)}
      <label
        class="relative shrink-0"
        data-testid="search-mode-option-{option.value}"
        title={unavailableTitle(option.value)}
        bind:this={labelRefs[index]}
      >
        <input
          type="radio"
          name="search-mode-rail"
          value={option.value}
          checked={mode === option.value}
          onchange={() => onSelect(option.value)}
          class="sr-only"
        />
        <span
          class="block cursor-pointer rounded-md px-3 py-1.5 transition-colors duration-180 ease-out {mode ===
          option.value
            ? 'text-primary'
            : 'text-gray-500 dark:text-gray-400'} {unavailableTitle(option.value) ? 'opacity-60' : ''}"
        >
          {$t(option.labelKey)}
        </span>
      </label>
    {/each}
  </div>
{/if}
