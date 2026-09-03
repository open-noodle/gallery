<script lang="ts">
  import { Icon } from '@immich/ui';
  import { mdiMagnify } from '@mdi/js';
  import { t } from 'svelte-i18n';

  /**
   * "Search this surface" affordance, sat beside the Years/Months/All pill (#1051).
   *
   * Scoped search already worked before this button existed — the nav bar's palette reads
   * `getSearchablePageState(page.url)` and narrows to whatever album or space you are standing in.
   * What it lacked was any sign, on the surface itself, that searching here searches HERE. This is
   * the YouTube channel-page pattern: tabs, then a magnifier that scopes to the channel.
   *
   * Deliberately dumb — it takes an `onclick` rather than reaching for `globalSearchManager`, so
   * FilterToolbar (rendered by every timeline surface, most of them not searchable) does not grow
   * an import edge onto the palette manager and its SDK graph.
   */
  interface Props {
    onclick: () => void;
  }

  let { onclick }: Props = $props();
</script>

<button
  type="button"
  class="flex size-9 shrink-0 items-center justify-center rounded-full bg-white/95 text-gray-600 ring-1 ring-black/10 transition hover:bg-gray-100 hover:text-gray-900 dark:bg-immich-dark-gray dark:text-gray-300 dark:ring-white/10 dark:hover:bg-gray-700 dark:hover:text-white"
  {onclick}
  data-testid="scoped-search-button"
  aria-label={$t('search_here')}
  title={$t('search_here')}
>
  <Icon icon={mdiMagnify} size="20" />
</button>
