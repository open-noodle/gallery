<script lang="ts">
  import { beforeNavigate, goto } from '$app/navigation';
  import { page } from '$app/state';
  import { shortcuts } from '$lib/actions/shortcut';
  import OnEvents from '$lib/components/OnEvents.svelte';
  import { cleanupShortcuts } from '$lib/components/cleanup/cleanup-shortcuts';
  import RewindOneAtATime from '$lib/components/cleanup/RewindOneAtATime.svelte';
  import RewindYearSection from '$lib/components/cleanup/RewindYearSection.svelte';
  import { assetViewerManager } from '$lib/managers/asset-viewer-manager.svelte';
  import { RewindSession, type RewindMark } from '$lib/managers/rewind-session.svelte';
  import ShortcutsModal from '$lib/modals/ShortcutsModal.svelte';
  import { Route } from '$lib/route';
  import { getByteUnitString } from '$lib/utils/byte-units';
  import {
    browserTimeZone,
    dominantCity,
    monthDayLabel,
    monthDayShortLabel,
    nextUnreviewedDay,
    shiftMonthDay,
  } from '$lib/utils/cleanup';
  import { handleError } from '$lib/utils/handle-error';
  import { navigate } from '$lib/utils/navigation';
  import {
    commitCleanup,
    getCleanupCalendar,
    getCleanupRewindAssets,
    restoreAssets,
    type CleanupAssetDto,
    type CleanupRewindYearDto,
  } from '@immich/sdk';
  import { Breadcrumbs, Button, Heading, IconButton, modalManager, toastManager } from '@immich/ui';
  import { mdiCheck, mdiKeyboard, mdiSlashForward } from '@mdi/js';
  import { onMount, tick } from 'svelte';
  import { locale, t } from 'svelte-i18n';

  type Props = {
    monthDay: number;
    years: CleanupRewindYearDto[];
    firstYear?: { year: number; assets: CleanupAssetDto[] };
    title: string;
  };

  let { monthDay, years: initialYears, firstYear, title }: Props = $props();

  type Mode = 'grid' | 'one';
  type LoadedYear = { year: number; assets: CleanupAssetDto[] };

  const MODE_KEY = 'cleanup.rewind.mode';
  const UP_NEXT = 8;
  const TILE_SELECTOR = '[data-testid^="cleanup-rewind-tile-"]';

  const readMode = (): Mode => {
    try {
      return localStorage.getItem(MODE_KEY) === 'one' ? 'one' : 'grid';
    } catch {
      return 'grid';
    }
  };

  // The page keys this component on the date, so props are only read once.
  // svelte-ignore state_referenced_locally
  let years = $state(initialYears.map((year) => ({ ...year })));
  // svelte-ignore state_referenced_locally
  let loaded = $state<LoadedYear[]>(firstYear ? [firstYear] : []);
  let loadingYear = $state(false);
  let sentinelVisible = $state(false);
  // Set when a year fails to load, so the loader does not retry in a loop. Scrolling the sentinel
  // back into view, or switching mode, tries again.
  let loadBlocked = $state(false);
  let hideReviewed = $state(true);
  let mode = $state<Mode>(readMode());
  let bypassGuard = false;

  // svelte-ignore state_referenced_locally
  const session = new RewindSession(monthDay, (dto) => commitCleanup({ cleanupCommitDto: dto }));

  const lang = $derived($locale ?? 'en');
  const currentYear = new Date().getFullYear();
  const total = $derived(years.reduce((sum, year) => sum + year.count, 0));
  const assetById = $derived(new Map(loaded.flatMap(({ assets }) => assets).map((asset) => [asset.id, asset])));
  const sections = $derived(
    loaded.map(({ year, assets }) => ({
      year,
      count: years.find((y) => y.year === year)?.count ?? assets.length,
      city: dominantCity(assets),
      // "Hide reviewed" hides photos kept on an earlier visit, unless they carry a mark from this one.
      visible: hideReviewed ? assets.filter((asset) => !asset.kept || session.marks.has(asset.id)) : assets,
    })),
  );
  const flat = $derived(sections.flatMap(({ visible }) => visible));
  const unloadedCount = $derived(
    years.filter(({ year }) => loaded.every((l) => l.year !== year)).reduce((sum, year) => sum + year.count, 0),
  );
  const reviewed = $derived(
    [...assetById.values()].filter((asset) => asset.kept || session.marks.has(asset.id)).length,
  );
  const trashBytes = $derived(
    [...session.marks]
      .filter(([, mark]) => mark === 'trash')
      .reduce((sum, [id]) => sum + (assetById.get(id)?.fileSize ?? 0), 0),
  );
  const focusedIndex = $derived(flat.findIndex((asset) => asset.id === session.focusedId));
  const current = $derived(focusedIndex === -1 ? flat[0] : flat[focusedIndex]);
  const busy = $derived(session.progress !== null);
  const previousDay = $derived(shiftMonthDay(monthDay, -1));
  const nextDay = $derived(shiftMonthDay(monthDay, 1));

  // More years are needed once the grid sentinel scrolls into view, or once one-at-a-time mode
  // gets close to the end of what is loaded.
  const needsMore = $derived(
    mode === 'grid' ? sentinelVisible : flat.length - Math.max(focusedIndex, 0) <= UP_NEXT + 1,
  );

  const loadNextYear = async () => {
    const next = years.find(({ year }) => loaded.every((l) => l.year !== year));
    if (!next || loadingYear) {
      return;
    }
    loadingYear = true;
    try {
      const { assets } = await getCleanupRewindAssets({ monthDay, year: next.year });
      loaded.push({ year: next.year, assets });
    } catch (error) {
      handleError(error, $t('errors.failed_to_load_assets'));
      loadBlocked = true;
    } finally {
      loadingYear = false;
    }
  };

  $effect(() => {
    if (needsMore && !loadingYear && !loadBlocked && unloadedCount > 0) {
      void loadNextYear();
    }
  });

  $effect(() => {
    if (session.focusedId === null && flat.length > 0) {
      session.focusedId = flat[0].id;
    }
  });

  const observeSentinel = (node: HTMLElement) => {
    const observer = new IntersectionObserver(
      ([entry]) => {
        sentinelVisible = entry.isIntersecting;
        if (entry.isIntersecting) {
          loadBlocked = false;
        }
      },
      { rootMargin: '400px' },
    );
    observer.observe(node);
    return { destroy: () => observer.disconnect() };
  };

  const setMode = (next: Mode) => {
    mode = next;
    loadBlocked = false;
    try {
      localStorage.setItem(MODE_KEY, next);
    } catch {
      // Remembering the mode is a convenience only.
    }
  };

  const tileFor = (id: string) =>
    document.querySelector<HTMLElement>(`[data-testid="cleanup-rewind-tile-${CSS.escape(id)}"]`);

  const focusAsset = async (id: string | undefined) => {
    if (!id) {
      return;
    }
    session.focusedId = id;
    if (mode === 'grid') {
      await tick();
      const tile = tileFor(id);
      tile?.focus({ preventScroll: true });
      tile?.scrollIntoView({ block: 'nearest' });
    }
  };

  const step = (delta: number) => {
    if (flat.length === 0) {
      return;
    }
    const from = focusedIndex === -1 ? 0 : focusedIndex;
    void focusAsset(flat[Math.min(Math.max(from + delta, 0), flat.length - 1)]?.id);
  };

  // Up and down pick the tile in the next row whose centre is closest, so they follow the grid
  // across year sections whatever the column count.
  const stepRow = (direction: 1 | -1) => {
    if (mode === 'one') {
      step(direction);
      return;
    }
    const tiles = [...document.querySelectorAll<HTMLElement>(TILE_SELECTOR)];
    const currentTile = session.focusedId ? tileFor(session.focusedId) : undefined;
    if (!currentTile) {
      step(0);
      return;
    }
    const origin = currentTile.getBoundingClientRect();
    const centre = origin.left + origin.width / 2;
    const rows = tiles
      .map((tile) => ({ tile, rect: tile.getBoundingClientRect() }))
      .filter(({ rect }) => (direction === 1 ? rect.top >= origin.bottom - 1 : rect.bottom <= origin.top + 1));
    if (rows.length === 0) {
      return;
    }
    const rowTop =
      direction === 1 ? Math.min(...rows.map(({ rect }) => rect.top)) : Math.max(...rows.map(({ rect }) => rect.top));
    const distance = ({ rect }: (typeof rows)[number]) => Math.abs(rect.left + rect.width / 2 - centre);
    let target: (typeof rows)[number] | undefined;
    for (const candidate of rows) {
      if (Math.abs(candidate.rect.top - rowTop) < 2 && (!target || distance(candidate) < distance(target))) {
        target = candidate;
      }
    }
    void focusAsset(target?.tile.dataset.assetId);
  };

  const markCurrent = (kind: RewindMark) => {
    if (!current) {
      return;
    }
    session.mark(current.id, kind);
    step(1);
  };

  const onKeepRemaining = (year: number) => {
    const section = sections.find((s) => s.year === year);
    if (!section) {
      return;
    }
    session.markMany(
      section.visible.filter((asset) => !asset.kept && !session.marks.has(asset.id)).map((asset) => asset.id),
      'keep',
    );
  };

  const openAsset = async (id: string | undefined) => {
    if (!id) {
      return;
    }
    session.focusedId = id;
    await navigate({ targetRoute: 'current', assetId: id });
  };

  // A double-click first registers as one click, which cycled the mark; take that back before opening.
  const onTileOpen = (id: string) => {
    session.undo();
    void openAsset(id);
  };

  const removeAssets = (ids: string[]) => {
    const removed = new Set(ids);
    for (const section of loaded) {
      const before = section.assets.length;
      section.assets = section.assets.filter((asset) => !removed.has(asset.id));
      const year = years.find((y) => y.year === section.year);
      if (year) {
        year.count -= before - section.assets.length;
      }
    }
    if (session.focusedId && removed.has(session.focusedId)) {
      session.focusedId = flat.find((asset) => !removed.has(asset.id))?.id ?? null;
    }
  };

  const reinsertAssets = (assets: CleanupAssetDto[]) => {
    for (const asset of assets) {
      const year = Number(asset.localDateTime.slice(0, 4));
      const section = loaded.find((l) => l.year === year);
      if (!section || section.assets.some((a) => a.id === asset.id)) {
        continue;
      }
      // Same order as the server: capture time, then id.
      section.assets = [...section.assets, asset].sort(
        (a, b) => a.localDateTime.localeCompare(b.localDateTime) || a.id.localeCompare(b.id),
      );
      const entry = years.find((y) => y.year === year);
      if (entry) {
        entry.count++;
      }
    }
  };

  const showTrashedToast = (trashed: string[], onRestored?: () => void) => {
    if (trashed.length === 0) {
      return;
    }
    toastManager.primary(
      {
        description: $t('assets_trashed_count', { values: { count: trashed.length } }),
        button: {
          label: $t('undo'),
          color: 'secondary',
          onclick: async () => {
            try {
              await restoreAssets({ bulkIdsDto: { ids: trashed } });
              onRestored?.();
            } catch (error) {
              handleError(error, $t('errors.unable_to_restore_assets'));
            }
          },
        },
      },
      { timeout: 5000 },
    );
  };

  const showSkippedToast = (skipped: number) => {
    if (skipped > 0) {
      toastManager.warning($t('cleanup_skipped_count', { values: { count: skipped } }));
    }
  };

  const onMoveToTrash = async () => {
    if (busy || session.counts.trash === 0) {
      return;
    }
    try {
      const { trashed, skipped } = await session.commitTrash();
      const removed = trashed.map((id) => assetById.get(id)).filter((asset) => asset !== undefined);
      removeAssets(trashed);
      showTrashedToast(trashed, () => reinsertAssets(removed));
      showSkippedToast(skipped);
    } catch (error) {
      handleError(error, $t('errors.unable_to_delete_assets'));
    }
  };

  const onFinishDay = async () => {
    if (busy) {
      return;
    }
    try {
      const { trashed, skipped } = await session.finishDay();
      toastManager.success($t('cleanup_day_complete'));
      showTrashedToast(trashed);
      showSkippedToast(skipped);
    } catch (error) {
      handleError(error, $t('cleanup_finish_day_failed'));
      return;
    }

    let next: number | undefined;
    try {
      const calendar = await getCleanupCalendar({ tz: browserTimeZone() });
      next = nextUnreviewedDay(calendar.days, monthDay);
    } catch {
      // Falling back to the hub is fine; the day itself is already saved.
    }
    await goto(next === undefined ? Route.cleanupUtility() : Route.cleanupRewind({ monthDay: next }));
  };

  const onAssetsDelete = (ids: string[]) => {
    for (const id of ids) {
      session.marks.delete(id);
    }
    removeAssets(ids);
  };

  // Opening and closing the viewer stays on this date, so only leaving the date is guarded.
  beforeNavigate((navigation) => {
    if (bypassGuard || !session.hasUncommitted || navigation.willUnload) {
      return;
    }
    const to = navigation.to;
    if (to?.route.id === page.route.id && to?.params?.monthDay === String(monthDay)) {
      return;
    }
    navigation.cancel();
    if (!to) {
      return;
    }
    void (async () => {
      const confirmed = await modalManager.showDialog({
        title: $t('cleanup_unsaved_marks_title'),
        prompt: $t('cleanup_unsaved_marks_body'),
        confirmText: $t('leave'),
        confirmColor: 'danger',
      });
      if (confirmed) {
        bypassGuard = true;
        await goto(to.url);
      }
    })();
  });

  const onBeforeUnload = (event: BeforeUnloadEvent) => {
    if (session.hasUncommitted) {
      event.preventDefault();
    }
  };

  const legend = [
    { keys: ['K'], label: 'cleanup_shortcut_keep' },
    { keys: ['F'], label: 'favorite' },
    { keys: ['Delete'], label: 'trash' },
    { keys: ['←', '→'], label: 'cleanup_shortcut_move' },
    { keys: ['Space'], label: 'cleanup_shortcut_open' },
    { keys: ['Z'], label: 'undo' },
    { keys: ['Shift+Enter'], label: 'cleanup_shortcut_finish' },
  ] as const;

  const showShortcuts = () =>
    modalManager.show(ShortcutsModal, {
      shortcuts: {
        general: [],
        actions: legend.map(({ keys, label }) => ({ key: [...keys], action: $t(label) })),
      },
    });

  onMount(() => {
    if (mode === 'grid' && session.focusedId) {
      tileFor(session.focusedId)?.focus({ preventScroll: true });
    }
  });
</script>

<svelte:window onbeforeunload={onBeforeUnload} />
<svelte:document
  use:shortcuts={cleanupShortcuts(
    {
      keep: () => markCurrent('keep'),
      favorite: () => markCurrent('fav'),
      trash: () => markCurrent('trash'),
      left: () => step(-1),
      right: () => step(1),
      up: () => stepRow(-1),
      down: () => stepRow(1),
      open: () => void openAsset(current?.id),
      undo: () => session.undo(),
      finish: () => void onFinishDay(),
    },
    () => assetViewerManager.isViewing,
  )}
/>

<OnEvents {onAssetsDelete} />

<div class="mx-auto w-full max-w-7xl px-2 pt-2 md:px-4" data-testid="cleanup-rewind">
  <header class="mb-2 flex flex-wrap items-center gap-3">
    <div class="min-w-0">
      <Breadcrumbs
        items={[
          { title: $t('utilities'), href: Route.utilities() },
          { title: $t('cleanup'), href: Route.cleanupUtility() },
          { title },
        ]}
        separator={mdiSlashForward}
      />
      <Heading size="medium" tag="h2" class="mt-1">
        {$t('cleanup_rewind_title', { values: { date: monthDayLabel(monthDay, lang), count: years.length } })}
      </Heading>
    </div>

    <div class="ms-auto flex flex-wrap items-center gap-2">
      <div class="inline-flex rounded-full border bg-light p-0.5" role="group">
        {#each [{ value: 'grid', label: 'cleanup_mode_grid' }, { value: 'one', label: 'cleanup_mode_one' }] as const as option (option.value)}
          <button
            type="button"
            class="rounded-full px-3 py-1 text-xs font-semibold transition-colors {mode === option.value
              ? 'bg-primary/10 text-primary'
              : 'text-muted hover:text-dark'}"
            aria-pressed={mode === option.value}
            data-testid="cleanup-mode-{option.value}"
            onclick={() => setMode(option.value)}
          >
            {$t(option.label)}
          </button>
        {/each}
      </div>
      <Button
        href={Route.cleanupRewind({ monthDay: previousDay })}
        size="small"
        variant="outline"
        color="secondary"
        shape="round"
        title={$t('previous')}
        data-testid="cleanup-rewind-previous"
      >
        ‹ {monthDayShortLabel(previousDay, lang)}
      </Button>
      <Button
        href={Route.cleanupRewind({ monthDay: nextDay })}
        size="small"
        variant="outline"
        color="secondary"
        shape="round"
        title={$t('next')}
        data-testid="cleanup-rewind-next"
      >
        {monthDayShortLabel(nextDay, lang)} ›
      </Button>
    </div>
  </header>

  <div class="mb-1.5 flex flex-wrap items-center gap-3">
    <div class="min-w-50 flex-1">
      <div class="flex flex-wrap justify-between gap-x-3 text-xs tabular-nums">
        <span class="font-medium" data-testid="cleanup-rewind-progress">
          {$t('cleanup_reviewed_progress', { values: { done: reviewed, total } })}
        </span>
        <span class="text-muted" data-testid="cleanup-rewind-summary">
          {$t('cleanup_marks_summary', {
            values: {
              keep: session.counts.keep,
              fav: session.counts.fav,
              trash: session.counts.trash,
              size: getByteUnitString(trashBytes, lang),
              left: Math.max(total - reviewed, 0),
            },
          })}
        </span>
      </div>
      <div
        class="mt-1 h-2 overflow-hidden rounded-full bg-gray-200 dark:bg-gray-700"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={reviewed}
      >
        <div
          class="h-full rounded-full bg-linear-to-r from-success to-success-400 transition-[width]"
          style:width="{total > 0 ? (reviewed / total) * 100 : 0}%"
        ></div>
      </div>
    </div>
    <label
      class="inline-flex cursor-pointer items-center gap-2 rounded-full border bg-light px-3 py-1 text-xs font-medium"
    >
      <input type="checkbox" class="accent-primary" bind:checked={hideReviewed} data-testid="cleanup-hide-reviewed" />
      {$t('cleanup_hide_reviewed')}
    </label>
  </div>

  {#if mode === 'grid'}
    {#if total === 0}
      <p class="py-16 text-center text-muted">{$t('no_assets_to_show')}</p>
    {/if}
    {#each sections as section (section.year)}
      <RewindYearSection
        year={section.year}
        yearsAgo={currentYear - section.year}
        count={section.count}
        city={section.city}
        assets={section.visible}
        marks={session.marks}
        focusedId={session.focusedId}
        onCycle={(id) => {
          session.focusedId = id;
          session.cycle(id);
        }}
        onOpen={onTileOpen}
        {onKeepRemaining}
      />
    {/each}
    {#if unloadedCount > 0}
      <div use:observeSentinel class="grid place-items-center py-6" data-testid="cleanup-rewind-sentinel">
        <span class="h-3 w-40 animate-pulse rounded-full bg-gray-200 dark:bg-gray-700"></span>
      </div>
    {/if}
  {:else}
    <RewindOneAtATime
      asset={current}
      mark={current ? session.marks.get(current.id) : undefined}
      index={Math.max(focusedIndex, 0) + 1}
      total={flat.length + unloadedCount}
      upNext={flat.slice(Math.max(focusedIndex, 0) + 1, Math.max(focusedIndex, 0) + 1 + UP_NEXT)}
      marks={session.marks}
      onTrash={() => markCurrent('trash')}
      onSkip={() => step(1)}
      onFavorite={() => markCurrent('fav')}
      onKeep={() => markCurrent('keep')}
      onSelect={(id) => void focusAsset(id)}
      onOpen={(id) => void openAsset(id)}
    />
  {/if}

  <div
    class="sticky bottom-0 z-10 my-5 flex flex-wrap items-center gap-3.5 rounded-2xl border bg-light px-3.5 py-2.5 text-xs shadow-[0_-4px_20px_rgba(20,24,40,0.08)]"
    data-testid="cleanup-rewind-actionbar"
  >
    <div class="flex flex-wrap items-center gap-3 text-muted">
      {#each legend as item (item.label)}
        <span class="inline-flex items-center gap-1">
          {#each item.keys as key (key)}
            <kbd class="rounded-[5px] border border-b-2 bg-light px-1.5 font-mono text-[11px] text-dark">{key}</kbd>
          {/each}
          {$t(item.label)}
        </span>
      {/each}
      <IconButton
        shape="round"
        variant="ghost"
        color="secondary"
        size="small"
        icon={mdiKeyboard}
        aria-label={$t('show_keyboard_shortcuts')}
        title={$t('show_keyboard_shortcuts')}
        onclick={showShortcuts}
      />
    </div>
    <div class="ms-auto flex flex-wrap items-center gap-2">
      <span class="text-muted tabular-nums">
        {$t('cleanup_marked_for_trash', { values: { count: session.counts.trash } })}
      </span>
      <Button
        size="small"
        color="danger"
        disabled={busy || session.counts.trash === 0}
        loading={busy}
        onclick={() => void onMoveToTrash()}
        data-testid="cleanup-move-to-trash"
      >
        {$t('cleanup_move_to_trash', { values: { count: session.counts.trash } })}
      </Button>
      <Button
        size="small"
        trailingIcon={mdiCheck}
        disabled={busy || total === 0}
        loading={busy}
        onclick={() => void onFinishDay()}
        data-testid="cleanup-finish-day"
      >
        {$t('cleanup_finish_day')}
      </Button>
    </div>
  </div>
</div>
