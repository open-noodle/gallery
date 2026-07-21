<script lang="ts">
  import { trimManager, TrimManager } from '$lib/managers/edit/trim-manager.svelte';
  import { t } from 'svelte-i18n';

  const formatTime = TrimManager.formatTime;

  function parseTime(value: string): number | undefined {
    const match = value.match(/^(\d+):(\d{2})(?:\.(\d))?$/);
    if (!match) {
      return undefined;
    }
    const [, minutes, seconds, tenths] = match;
    return Number(minutes) * 60 + Number(seconds) + (tenths ? Number(tenths) / 10 : 0);
  }

  let inValue = $state('');
  let outValue = $state('');

  // Keep inputs in sync with manager state when not focused
  let inFocused = $state(false);
  let outFocused = $state(false);

  let displayIn = $derived(inFocused ? inValue : formatTime(trimManager.startTime));
  let displayOut = $derived(outFocused ? outValue : formatTime(trimManager.endTime));

  function onInFocus() {
    inValue = formatTime(trimManager.startTime);
    inFocused = true;
  }

  function onOutFocus() {
    outValue = formatTime(trimManager.endTime);
    outFocused = true;
  }

  function onInBlur() {
    inFocused = false;
    const parsed = parseTime(inValue);
    if (parsed !== undefined) {
      trimManager.setStart(parsed);
      trimManager.seekTo(trimManager.startTime);
    }
  }

  function onOutBlur() {
    outFocused = false;
    const parsed = parseTime(outValue);
    if (parsed !== undefined) {
      trimManager.setEnd(parsed);
      trimManager.seekTo(trimManager.endTime);
    }
  }

  function setIn() {
    trimManager.setStart(trimManager.currentTime);
  }

  function setOut() {
    trimManager.setEnd(trimManager.currentTime);
  }
</script>

<div class="mt-3 flex flex-col gap-5 px-4">
  <!-- Trimmed Duration -->
  <div class="flex flex-col gap-1">
    <span class="text-[0.65rem] font-semibold tracking-wider text-gray-500 uppercase dark:text-gray-400">
      {$t('editor_trim_trimmed_duration')}
    </span>
    <span class="text-2xl font-bold tracking-tight text-immich-fg tabular-nums dark:text-immich-dark-fg">
      {formatTime(trimManager.trimmedDuration)}
    </span>
  </div>

  <!-- In / Out Time Inputs -->
  <div class="flex flex-col gap-2">
    <div class="flex gap-2">
      <div class="flex flex-1 flex-col gap-1">
        <label for="trim-in" class="text-[0.6rem] font-medium tracking-wide text-gray-500 uppercase dark:text-gray-400">
          {$t('editor_trim_in')}
        </label>
        <input
          id="trim-in"
          type="text"
          class="rounded-sm border border-gray-700 bg-gray-800 px-2 py-1.5 text-sm text-immich-fg tabular-nums transition-colors outline-none focus:border-immich-primary/50 dark:bg-gray-800 dark:text-immich-dark-fg"
          value={displayIn}
          onfocus={onInFocus}
          onblur={onInBlur}
          oninput={(e) => (inValue = e.currentTarget.value)}
        />
      </div>
      <div class="flex flex-1 flex-col gap-1">
        <label
          for="trim-out"
          class="text-[0.6rem] font-medium tracking-wide text-gray-500 uppercase dark:text-gray-400"
        >
          {$t('editor_trim_out')}
        </label>
        <input
          id="trim-out"
          type="text"
          class="rounded-sm border border-gray-700 bg-gray-800 px-2 py-1.5 text-sm text-immich-fg tabular-nums transition-colors outline-none focus:border-immich-primary/50 dark:bg-gray-800 dark:text-immich-dark-fg"
          value={displayOut}
          onfocus={onOutFocus}
          onblur={onOutBlur}
          oninput={(e) => (outValue = e.currentTarget.value)}
        />
      </div>
    </div>

    <!-- Set In / Set Out buttons -->
    <div class="flex gap-1.5">
      <button
        type="button"
        class="flex flex-1 cursor-pointer items-center justify-center gap-1 rounded-sm border border-gray-700 bg-gray-800 px-2 py-1.5 text-xs font-medium text-gray-400 transition-all hover:border-gray-600 hover:bg-gray-700 hover:text-gray-300"
        onclick={setIn}
      >
        {$t('editor_trim_set_in')}
        <kbd class="rounded-sm bg-gray-700 px-1 text-[0.6rem] text-gray-500">I</kbd>
      </button>
      <button
        type="button"
        class="flex flex-1 cursor-pointer items-center justify-center gap-1 rounded-sm border border-gray-700 bg-gray-800 px-2 py-1.5 text-xs font-medium text-gray-400 transition-all hover:border-gray-600 hover:bg-gray-700 hover:text-gray-300"
        onclick={setOut}
      >
        {$t('editor_trim_set_out')}
        <kbd class="rounded-sm bg-gray-700 px-1 text-[0.6rem] text-gray-500">O</kbd>
      </button>
    </div>
  </div>

  <div class="h-px bg-gray-700"></div>

  <!-- Original Duration -->
  <div class="flex flex-col gap-1">
    <span class="text-[0.65rem] font-semibold tracking-wider text-gray-500 uppercase dark:text-gray-400">
      {$t('crop_aspect_ratio_original')}
    </span>
    <span class="text-sm text-gray-500 tabular-nums">
      {formatTime(trimManager.duration)}
    </span>
  </div>

  <!-- Reset button -->
  {#if trimManager.hasChanges}
    <button
      type="button"
      class="cursor-pointer self-start text-xs text-gray-500 transition-colors hover:text-gray-300"
      onclick={() => trimManager.resetAllChanges()}
    >
      {$t('editor_trim_reset_to_full_duration')}
    </button>
  {/if}
</div>
