<script lang="ts">
  import AdminPageLayout from '$lib/components/layouts/AdminPageLayout.svelte';
  import { Route } from '$lib/route';
  import { Button, Icon } from '@immich/ui';
  import { mdiAccountSearch, mdiArrowRight, mdiRadar, mdiSwapHorizontal } from '@mdi/js';
  import { t } from 'svelte-i18n';
  import { faceCleanupBreadcrumbs } from './breadcrumbs';
  import type { PageData } from './$types';

  // Local types for the loosely-typed SDK response (mirrors scan/+page.svelte).
  interface ScanTotals {
    flaggedFaces: number;
    affectedPersons: number;
  }

  interface ScanProgress {
    scanned: number;
    total: number;
  }

  interface FaceCleanupScan {
    status: 'pending' | 'running' | 'completed' | 'failed';
    progress: ScanProgress | null;
    totals: ScanTotals | null;
    error: string | null;
    finishedAt: string | null;
  }

  type Props = { data: PageData };
  const { data }: Props = $props();

  const scan = $derived(data.scan as unknown as FaceCleanupScan | null);

  // Two presentations (§6.2): first visit has never had a scan; returning has one, in whichever state.
  const firstVisit = $derived(!scan);
  // 409-guard UI half (§7): resolveFaces rejects while a scan runs, so the manual card must be genuinely
  // unusable — not just faded — for the whole time the scan is pending or running.
  const scanRunning = $derived(scan?.status === 'pending' || scan?.status === 'running');
  const scanFailed = $derived(scan?.status === 'failed');
  const flagged = $derived(scan?.totals?.flaggedFaces ?? 0);
  const affectedPersons = $derived(scan?.totals?.affectedPersons ?? 0);
  const userCount = $derived(data.users.length);

  // One label for the guided card's live state — drives both the status well and its CTA, so the five
  // §6.2 states are described in a single place rather than drifting between two parallel branch chains.
  const guidedState = $derived(
    firstVisit ? 'first' : scanRunning ? 'running' : scanFailed ? 'failed' : flagged > 0 ? 'flagged' : 'clean',
  );

  const scanProgressPct = $derived(
    scan?.progress && scan.progress.total > 0 ? Math.round((scan.progress.scanned / scan.progress.total) * 100) : 0,
  );

  const formatDate = (dateStr: string | null | undefined) => (dateStr ? new Date(dateStr).toLocaleString() : null);

  // Tinted status-chip palette (background + text + dot) keyed by semantic tone. Kept as literal class
  // strings so Tailwind's source scanner emits every variant even though the tone is chosen at runtime.
  const tone = {
    gray: { chip: 'bg-gray-100 text-gray-600 dark:bg-gray-700/60 dark:text-gray-300', dot: 'bg-gray-400' },
    primary: { chip: 'bg-primary-50 text-primary dark:bg-primary-500/15 dark:text-primary-300', dot: 'bg-primary' },
    amber: { chip: 'bg-amber-50 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300', dot: 'bg-amber-500' },
    red: { chip: 'bg-red-50 text-red-700 dark:bg-red-500/15 dark:text-red-300', dot: 'bg-red-500' },
    green: { chip: 'bg-green-50 text-green-700 dark:bg-green-500/15 dark:text-green-300', dot: 'bg-green-500' },
    teal: { chip: 'bg-teal-50 text-teal-700 dark:bg-teal-500/15 dark:text-teal-300', dot: 'bg-teal-500' },
  } as const;
</script>

{#snippet statusChip(toneKey: keyof typeof tone, label: string)}
  <span class={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${tone[toneKey].chip}`}>
    <span class={`size-1.5 rounded-full ${tone[toneKey].dot}`}></span>
    {label}
  </span>
{/snippet}

{#snippet introPoint(icon: string, slug: 'scan' | 'actions' | 'manual')}
  <div class="flex gap-3">
    <div
      class="flex size-8 flex-none items-center justify-center rounded-lg bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400"
    >
      <Icon {icon} size="16" />
    </div>
    <div class="min-w-0">
      <h3 class="text-sm font-semibold text-gray-900 dark:text-white">
        {$t(`admin.face_cleanup_intro_${slug}_title`)}
      </h3>
      <p class="mt-1 text-xs/relaxed text-gray-500 dark:text-gray-400">
        {$t(`admin.face_cleanup_intro_${slug}_body`)}
      </p>
    </div>
  </div>
{/snippet}

<AdminPageLayout breadcrumbs={faceCleanupBreadcrumbs($t)}>
  <div class="mx-auto max-w-screen-xl p-6 sm:p-8">
    <!-- Header. The last-scan chip stays on the right; the explainer below is unconditional (design §3.4) —
         it used to be gated on `firstVisit`, which hid it from every visit after the first scan. -->
    <div class="mb-6 flex flex-wrap items-end justify-between gap-4">
      <h1 class="text-2xl font-semibold tracking-tight text-gray-900 dark:text-white">{$t('admin.face_cleanup')}</h1>
      {#if !firstVisit && scan?.finishedAt}
        <span
          class="inline-flex flex-none items-center gap-1.5 rounded-full bg-gray-100 px-3 py-1 text-xs font-medium text-gray-500 dark:bg-gray-800 dark:text-gray-400"
        >
          <span class="size-1.5 rounded-full bg-gray-400"></span>
          {$t('admin.face_cleanup_last_scan')} · {formatDate(scan.finishedAt)}
        </span>
      {/if}
    </div>

    <div class="mb-8 max-w-4xl" data-testid="face-cleanup-intro">
      <p class="text-sm/relaxed text-gray-500 dark:text-gray-400">{$t('admin.face_cleanup_intro_lead')}</p>

      <div class="mt-5 grid gap-4 sm:grid-cols-3">
        {@render introPoint(mdiRadar, 'scan')}
        {@render introPoint(mdiSwapHorizontal, 'actions')}
        {@render introPoint(mdiAccountSearch, 'manual')}
      </div>
    </div>

    <!-- Two equal-weight doors, identical footprint. Neither is marked "recommended" (§6.2): we don't know
         which mode a given admin lives in — some triage scans, others spend all their time in manual review. -->
    <div class="grid gap-5 lg:grid-cols-2">
      <!-- Guided card: a status board that happens to be a fork — it carries the scan's live state so an
           admin can see whether guided work is waiting without clicking in. Always reachable. -->
      <div
        class="group relative flex flex-col overflow-hidden rounded-2xl border border-gray-200 bg-white p-6 shadow-sm transition duration-200 hover:-translate-y-0.5 hover:border-primary-200 hover:shadow-lg dark:border-gray-700 dark:bg-gray-800 dark:hover:border-primary-500/40"
        data-testid="chooser-card-guided"
      >
        <div
          class="pointer-events-none absolute -top-14 -right-14 size-40 rounded-full bg-primary-100/70 blur-3xl dark:bg-primary-500/10"
          aria-hidden="true"
        ></div>

        <div class="relative flex items-start gap-3.5">
          <div
            class="flex size-12 flex-none items-center justify-center rounded-xl bg-primary-50 text-primary ring-1 ring-primary-100 ring-inset dark:bg-primary-500/15 dark:text-primary-300 dark:ring-primary-400/25"
          >
            <Icon icon={mdiRadar} size="24" />
          </div>
          <div class="min-w-0">
            <h2 class="text-base font-semibold text-gray-900 dark:text-white">
              {$t('admin.face_cleanup_mode_guided')}
            </h2>
            <p class="mt-0.5 text-sm/snug text-gray-500 dark:text-gray-400">
              {$t('admin.face_cleanup_mode_guided_sub')}
            </p>
          </div>
        </div>

        <!-- Live status well: recolours across the five scan states. -->
        <div
          class="relative mt-5 rounded-xl bg-gray-50 p-4 ring-1 ring-gray-100 ring-inset dark:bg-gray-900/40 dark:ring-white/5"
        >
          {#if guidedState === 'first'}
            {@render statusChip('gray', $t('admin.face_cleanup_mode_needs_scan'))}
            <p class="mt-2 text-xs/relaxed text-gray-500 dark:text-gray-400">
              {$t('admin.face_cleanup_mode_needs_scan_sub')}
            </p>
          {:else if guidedState === 'running'}
            {@render statusChip(
              'primary',
              scan?.status === 'pending'
                ? $t('admin.face_cleanup_scan_pending')
                : $t('admin.face_cleanup_scan_running'),
            )}
            {#if scan?.progress}
              <div class="mt-3 flex items-baseline gap-1.5">
                <span class="text-3xl font-semibold tracking-tight text-gray-900 tabular-nums dark:text-white">
                  {scan.progress.scanned.toLocaleString()}
                </span>
                <span class="text-sm text-gray-400 tabular-nums">
                  / {scan.progress.total.toLocaleString()} · {$t('admin.face_cleanup_faces')}
                </span>
              </div>
              <div class="mt-3 h-1.5 overflow-hidden rounded-full bg-gray-200 dark:bg-gray-700">
                <div
                  class="h-full rounded-full bg-primary transition-all duration-500"
                  style={`width:${scanProgressPct}%`}
                ></div>
              </div>
            {:else}
              <p class="mt-2 text-xs text-gray-400">{$t('admin.face_cleanup_scan_preparing')}</p>
            {/if}
          {:else if guidedState === 'failed'}
            {@render statusChip('red', $t('admin.face_cleanup_scan_failed'))}
            {#if scan?.error}
              <p class="mt-2 truncate font-mono text-xs text-red-600 dark:text-red-400">{scan.error}</p>
            {/if}
          {:else if guidedState === 'flagged'}
            {@render statusChip('amber', $t('admin.face_cleanup_stat_flagged'))}
            <div class="mt-3 text-3xl font-semibold tracking-tight text-gray-900 tabular-nums dark:text-white">
              {flagged.toLocaleString()}
            </div>
            <div class="mt-1 text-xs text-gray-500 dark:text-gray-400">
              {$t('admin.face_cleanup_stat_flagged_sub', { values: { count: affectedPersons } })}
            </div>
          {:else}
            {@render statusChip('green', $t('admin.face_cleanup_mode_nothing_flagged'))}
          {/if}
        </div>

        <!-- CTA pinned to the card foot so both doors' actions align regardless of well height. -->
        <div class="relative mt-auto pt-6">
          {#if guidedState === 'first'}
            <Button
              color="primary"
              variant="filled"
              size="medium"
              fullWidth
              trailingIcon={mdiArrowRight}
              href={Route.faceCleanupScan()}
              data-testid="chooser-guided-cta"
            >
              {$t('admin.face_cleanup_mode_run_first_scan')}
            </Button>
          {:else if guidedState === 'running'}
            <Button
              color="secondary"
              variant="outline"
              size="medium"
              fullWidth
              trailingIcon={mdiArrowRight}
              href={Route.faceCleanupScan()}
              data-testid="chooser-guided-cta"
            >
              {$t('admin.face_cleanup_mode_view_progress')}
            </Button>
          {:else if guidedState === 'failed'}
            <Button
              color="secondary"
              variant="filled"
              size="medium"
              fullWidth
              trailingIcon={mdiArrowRight}
              href={Route.faceCleanupScan()}
              data-testid="chooser-guided-cta"
            >
              {$t('admin.face_cleanup_mode_view_details')}
            </Button>
          {:else if guidedState === 'flagged'}
            <Button
              color="primary"
              variant="filled"
              size="medium"
              fullWidth
              trailingIcon={mdiArrowRight}
              href={Route.faceCleanupScan()}
              data-testid="chooser-guided-cta"
            >
              {$t('admin.face_cleanup_mode_continue')}
            </Button>
          {:else}
            <Button
              color="secondary"
              variant="outline"
              size="medium"
              fullWidth
              trailingIcon={mdiArrowRight}
              href={Route.faceCleanupScan()}
              data-testid="chooser-guided-cta"
            >
              {$t('admin.face_cleanup_rescan')}
            </Button>
          {/if}
        </div>
      </div>

      <!-- Manual card: disabled while a scan runs (§7 — resolveFaces 409s), otherwise always reachable —
           including on a brand-new instance with no scan at all. Teal identity keeps it distinct from the
           primary-blue guided door without implying a recommendation. -->
      <div
        class={[
          'group relative flex flex-col overflow-hidden rounded-2xl border p-6 shadow-sm transition duration-200',
          scanRunning
            ? 'pointer-events-none border-gray-200 bg-gray-50/60 opacity-60 dark:border-gray-700/60 dark:bg-gray-800/40'
            : 'border-gray-200 bg-white hover:-translate-y-0.5 hover:border-teal-200 hover:shadow-lg dark:border-gray-700 dark:bg-gray-800 dark:hover:border-teal-500/40',
        ].join(' ')}
        aria-disabled={scanRunning ? 'true' : undefined}
        data-testid="chooser-card-manual"
      >
        <div
          class="pointer-events-none absolute -top-14 -right-14 size-40 rounded-full bg-teal-100/70 blur-3xl dark:bg-teal-500/10"
          aria-hidden="true"
        ></div>

        <div class="relative flex items-start gap-3.5">
          <div
            class="flex size-12 flex-none items-center justify-center rounded-xl bg-teal-50 text-teal-600 ring-1 ring-teal-100 ring-inset dark:bg-teal-500/15 dark:text-teal-300 dark:ring-teal-400/25"
          >
            <Icon icon={mdiAccountSearch} size="24" />
          </div>
          <div class="min-w-0">
            <h2 class="text-base font-semibold text-gray-900 dark:text-white">
              {$t('admin.face_cleanup_mode_manual')}
            </h2>
            <p class="mt-0.5 text-sm/snug text-gray-500 dark:text-gray-400">
              {$t('admin.face_cleanup_mode_manual_sub')}
            </p>
          </div>
        </div>

        <div
          class="relative mt-5 rounded-xl bg-gray-50 p-4 ring-1 ring-gray-100 ring-inset dark:bg-gray-900/40 dark:ring-white/5"
        >
          {#if firstVisit}
            {@render statusChip('teal', $t('admin.face_cleanup_mode_manual_no_scan_needed'))}
          {:else}
            {@render statusChip(
              'gray',
              $t('admin.face_cleanup_mode_manual_user_count', { values: { count: userCount } }),
            )}
          {/if}
          {#if scanRunning}
            <p class="mt-2 text-xs/relaxed text-amber-600 dark:text-amber-400">
              {$t('admin.face_cleanup_mode_manual_blocked_scanning')}
            </p>
          {/if}
        </div>

        <div class="relative mt-auto pt-6">
          {#if scanRunning}
            <!-- Genuinely not activatable: no href (so it's never a real link), native `disabled` (so it
                 can't be reached by keyboard either) — not just faded with opacity. -->
            <Button
              color="secondary"
              variant="outline"
              size="medium"
              fullWidth
              disabled
              data-testid="chooser-manual-cta"
            >
              {$t('admin.face_cleanup_mode_browse_people')}
            </Button>
          {:else}
            <Button
              color="primary"
              variant="filled"
              size="medium"
              fullWidth
              trailingIcon={mdiArrowRight}
              href={Route.faceCleanupPeople()}
              data-testid="chooser-manual-cta"
            >
              {$t('admin.face_cleanup_mode_browse_people')}
            </Button>
          {/if}
        </div>
      </div>
    </div>
  </div>
</AdminPageLayout>
