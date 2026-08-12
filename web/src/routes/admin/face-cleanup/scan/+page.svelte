<script lang="ts">
  import AdminPageLayout from '$lib/components/layouts/AdminPageLayout.svelte';
  import ReadOnlyDemoNotice from '$lib/components/admin/ReadOnlyDemoNotice.svelte';
  import { authManager } from '$lib/managers/auth-manager.svelte';
  import { Route } from '$lib/route';
  import { createScanTriageModel, type ScanTriageModel } from './scan-triage.svelte';
  import ConfidentLane from './ConfidentLane.svelte';
  import { declineFaceRepair, getFaceRepairPersonFaces, getLatestScan, resolveFaces, triggerScan } from '@immich/sdk';
  import { Button, ConfirmModal, Icon, modalManager, toastManager } from '@immich/ui';
  import { mdiClose, mdiRadar, mdiRefresh, mdiTune } from '@mdi/js';
  import AdvancedScanModal, { type AdvancedScanParams } from './AdvancedScanModal.svelte';
  import ReviewFirstLane from './ReviewFirstLane.svelte';
  import { onDestroy, onMount } from 'svelte';
  import { t } from 'svelte-i18n';
  import { faceCleanupBreadcrumbs, guidedCrumb } from '../breadcrumbs';
  import { handleError } from '$lib/utils/handle-error';
  import type { PageData } from './$types';

  // Local types for the loosely-typed SDK response
  interface ScanTotals {
    eligibleFaces: number;
    flaggedFaces: number;
    toRepair: number;
    reviewOnlyFaces: number;
    reviewOnlyPersons: number;
    affectedPersons: number;
    reviewOnlyByReason: { overCap: number; badTarget: number; unAttributable: number };
  }

  interface ScanProgress {
    scanned: number;
    total: number;
  }

  interface ScanPerson {
    personId: string;
    ownerId: string;
    personName: string | null;
    faceCount: number;
    thumbnailFaceId: string | null;
    eligible: number;
    flagged: number;
    flaggedFraction: number;
    suspectedOwners: {
      ownerPersonId: string;
      ownerName: string | null;
      thumbnailFaceId: string | null;
      count: number;
      ownerFaceCount: number;
      ownerMissing: boolean;
    }[];
    recommendation: 'confident' | 'review-first';
    reviewReasons: string[];
  }

  interface FaceCleanupScan {
    id: string;
    status: 'pending' | 'running' | 'completed' | 'failed';
    progress: ScanProgress | null;
    totals: ScanTotals | null;
    persons: ScanPerson[];
    error: string | null;
    startedAt: string | null;
    finishedAt: string | null;
    createdAt: string;
  }

  type Props = { data: PageData };
  const { data }: Props = $props();

  const isReadOnlyDemo = $derived(authManager.isReadOnlyDemo);

  let scan = $state<FaceCleanupScan | null>(null);
  let loading = $state(true);
  let loadError = $state(false);
  let scanning = $state(false);
  let applying = $state(false);
  let applyError = $state<string | null>(null);
  let pollTimer = $state<ReturnType<typeof setTimeout> | null>(null);
  // S11.13/F27: stopPolling() only clears a PENDING setTimeout — a fetchLatestScan() call that already fired
  // and is awaiting its network response is untouched by that clearTimeout, and scheduleNextPoll's `.then`
  // unconditionally re-arms the next poll regardless. Checked at the top of that `.then` so an in-flight
  // fetch settling after unmount cannot restart polling.
  let destroyed = false;

  // The triage view-model is rebuilt through setScan; the admin's confident-lane exclusions carry over across
  // refetches/dismissals (see createScanTriageModel's `prev`) instead of resetting.
  let vm = $state<ScanTriageModel | null>(null);

  // The confident-lane spot-check chips are links to the per-cluster review page (Route.viewFaceCleanupPerson).
  // Clicking one and coming back is a forward navigation to this route, which remounts the page — `vm` starts
  // over as null, so without help the exclusions above would silently reset (final-review finding: "exclude
  // two, inspect a third, come back" would re-include the excluded two). Persist the excluded ids in
  // sessionStorage keyed by scan id so they survive that round-trip; keying by scan id means a new scan (new id)
  // always starts clean rather than inheriting a stale exclusion set.
  const EXCLUSIONS_STORAGE_PREFIX = 'face-cleanup-scan-exclusions:';

  const readStoredExclusions = (scanId: string): string[] => {
    try {
      const raw = sessionStorage.getItem(`${EXCLUSIONS_STORAGE_PREFIX}${scanId}`);
      if (!raw) {
        return [];
      }
      const parsed: unknown = JSON.parse(raw);
      return Array.isArray(parsed) && parsed.every((id) => typeof id === 'string') ? parsed : [];
    } catch {
      // Malformed/foreign value under our key, or JSON.parse throwing on garbage: treat as "no exclusions"
      // rather than let a storage quirk break the page.
      return [];
    }
  };

  const persistExclusions = (scanId: string, ids: string[]) => {
    try {
      sessionStorage.setItem(`${EXCLUSIONS_STORAGE_PREFIX}${scanId}`, JSON.stringify(ids));
    } catch {
      // Storage disabled/full (e.g. private browsing): losing the persisted exclusions is a minor UX
      // regression, not a functional break, so swallow rather than crash the page.
    }
  };

  const setScan = (next: FaceCleanupScan | null) => {
    scan = next;
    vm =
      next?.persons && next.persons.length > 0
        ? createScanTriageModel(next.persons as ScanPerson[], {
            // `vm` is only null on a fresh mount (first load, or after a click-through remount) — within a
            // mount, refetches/dismissals keep chaining off the live `vm` exactly as before. Only the
            // fresh-mount case seeds from sessionStorage.
            prev: vm ?? { excluded: new Set(readStoredExclusions(next.id)) },
          })
        : null;
  };

  // Write-through: whenever the exclusion set changes (toggle, or a seed/rebuild above), persist it under the
  // current scan's id. `vm.excluded` is a SvelteSet, so this effect re-runs on every toggle.
  $effect(() => {
    if (vm && scan?.id) {
      persistExclusions(scan.id, [...vm.excluded]);
    }
  });

  const isActive = (status: string | undefined) => status === 'pending' || status === 'running';

  const fetchLatestScan = async () => {
    try {
      const result = await getLatestScan();
      setScan(result as unknown as FaceCleanupScan | null);
    } catch {
      // Transient poll/network error: keep the current state. A genuine "no scan yet" arrives as a
      // successful null result (handled above), so wiping `scan` here would flash the empty state and
      // re-enable Re-scan mid-scan.
    }
  };

  const POLL_MIN_MS = 2000;
  const POLL_MAX_MS = 15_000;
  let pollDelay = POLL_MIN_MS;

  // Self-rescheduling poll with capped backoff (N3): a fixed 2s interval fired hundreds of near-identical status
  // requests across a long scan. Each successful poll grows the delay toward POLL_MAX_MS; it stops as soon as the
  // scan is no longer active. fetchLatestScan swallows its own transient errors, so polling keeps going on a blip.
  const scheduleNextPoll = () => {
    pollTimer = setTimeout(() => {
      void fetchLatestScan().then(() => {
        // S11.13/F27: the component may have been destroyed WHILE this fetch was in flight — stopPolling()'s
        // clearTimeout only cancels a still-pending setTimeout, not an already-fired one awaiting its promise.
        if (destroyed) {
          return;
        }
        if (scan && !isActive(scan.status)) {
          stopPolling();
          return;
        }
        pollDelay = Math.min(Math.round(pollDelay * 1.5), POLL_MAX_MS);
        scheduleNextPoll();
      });
    }, pollDelay);
  };

  const startPolling = () => {
    if (pollTimer) {
      return;
    }
    pollDelay = POLL_MIN_MS;
    scheduleNextPoll();
  };

  const stopPolling = () => {
    if (!pollTimer) {
      return;
    }

    clearTimeout(pollTimer);
    pollTimer = null;
  };

  // The INITIAL load is kept separate from fetchLatestScan's swallow-everything poll idiom above (D17): a
  // failed first fetch must render as a distinct error state with a Retry, not the reassuring "no scan yet"
  // empty state — but once that first fetch has succeeded, a later poll blip should keep showing the
  // last-known scan state, not flash into an error banner. Retry re-runs this same function.
  const loadInitial = async () => {
    loading = true;
    loadError = false;
    try {
      const result = await getLatestScan();
      setScan(result as unknown as FaceCleanupScan | null);
    } catch (error) {
      loadError = true;
      handleError(error, $t('admin.face_cleanup_load_error'));
    } finally {
      loading = false;
    }
    if (scan && isActive(scan.status)) {
      startPolling();
    }
  };

  onMount(loadInitial);

  onDestroy(() => {
    destroyed = true;
    stopPolling();
  });

  const runScan = async (params?: AdvancedScanParams) => {
    scanning = true;
    applyError = null;
    try {
      await triggerScan({ faceRepairScanTriggerRequestDto: params ? { params } : {} });
      await fetchLatestScan();
      startPolling();
    } catch (error: unknown) {
      const status = (error as { status?: number }).status;
      if (status === 409) {
        toastManager.danger($t('admin.face_cleanup_scan_conflict'));
      } else {
        toastManager.danger($t('admin.face_cleanup_scan_error'));
      }
    } finally {
      scanning = false;
    }
  };

  const handleRescan = () => runScan();

  const handleAdvanced = () => {
    void modalManager.show(AdvancedScanModal, {
      onRun: (params: AdvancedScanParams) => {
        void runScan(params);
      },
    });
  };

  // Bulk-approve migrated off the old single-call `apply` onto a per-person zero-override `resolve`
  // (Slice 6, web part B): a mixed cluster can flag its faces toward different owners, so each person's
  // flagged faces are grouped into `moveToPerson` buckets by their own `suspectedOwnerId` before resolving.
  const resolvePersonToOwners = async (personId: string) => {
    const result = await getFaceRepairPersonFaces({ personId });
    const flaggedFaces =
      (result as unknown as { flaggedFaces: { assetFaceId: string; suspectedOwnerId: string }[] }).flaggedFaces ?? [];
    if (flaggedFaces.length === 0) {
      // An empty resolve 400s (E16) — a person can end up with zero flagged faces between scan and apply
      // (e.g. already resolved elsewhere), so skip it rather than fail the whole batch.
      return;
    }
    // Plain Map: local bookkeeping scoped to this single call, discarded on return.
    // eslint-disable-next-line svelte/prefer-svelte-reactivity
    const moveGroups = new Map<string, string[]>();
    for (const face of flaggedFaces) {
      const group = moveGroups.get(face.suspectedOwnerId);
      if (group) {
        group.push(face.assetFaceId);
      } else {
        moveGroups.set(face.suspectedOwnerId, [face.assetFaceId]);
      }
    }
    const moveToPerson = [...moveGroups].map(([destinationPersonId, faceIds]) => ({
      destinationPersonId,
      faceIds,
    }));
    await resolveFaces({ faceRepairResolveRequestDto: { personId, moveToPerson } });
  };

  // A human-readable label for a bulk-approve failure listing — falls back to the raw id for an unnamed
  // cluster, same fallback shape handleDismiss's lookup already uses.
  const personLabel = (personId: string): string =>
    scan?.persons.find((p) => p.personId === personId)?.personName ?? personId;

  // Bulk-approve the confident lane's non-excluded clusters — the same per-person resolve as before, now
  // driven by the triage model's approvedIds (confident minus the admin's spot-check exclusions).
  //
  // F26: two fixes. (1) This used to fire with no confirmation at all — the single-row dismiss beside it at
  // least has a native `confirm()`, this had nothing — so a ConfirmModal now gates it, naming the cluster
  // count, matching the pattern [personId]/+page.svelte's "Move entire cluster" already established. (2) It
  // used to await `Promise.all`, which rejects on the FIRST failure — a genuine partial success (most of the
  // batch applied, one cluster failed) was reported as a blanket "apply_error", discarding which clusters
  // actually succeeded. `Promise.allSettled` lets every call finish and the banner reports exactly what
  // happened, naming the clusters that failed.
  const handleApprove = async () => {
    if (!vm || vm.approvedCount === 0 || applying) {
      return;
    }
    const ids = vm.approvedIds;
    const confirmed = await modalManager.show(ConfirmModal, {
      title: $t('admin.face_cleanup_confident_approve_confirm_title', { values: { count: ids.length } }),
      prompt: $t('admin.face_cleanup_confident_approve_confirm_body', { values: { count: ids.length } }),
      confirmText: $t('admin.face_cleanup_confident_approve_confirm_cta', { values: { count: ids.length } }),
    });
    if (!confirmed) {
      return;
    }
    applying = true;
    applyError = null;
    try {
      const results = await Promise.allSettled(ids.map((personId) => resolvePersonToOwners(personId)));
      const failed = results
        .map((result, index) => ({ result, personId: ids[index] }))
        .filter(
          (entry): entry is { result: PromiseRejectedResult; personId: string } => entry.result.status === 'rejected',
        );
      const appliedCount = results.length - failed.length;

      if (failed.length === 0) {
        toastManager.success($t('admin.face_cleanup_apply_success', { values: { count: appliedCount } }));
      } else if (
        appliedCount === 0 &&
        failed.every(({ result }) => (result.reason as { status?: number })?.status === 409)
      ) {
        // Every single call failed the SAME systemic way (a scan/recognition job is active) — keep the more
        // actionable conflict message rather than a bare "0 applied, N failed" listing.
        applyError = $t('admin.face_cleanup_apply_conflict');
      } else {
        applyError = $t('admin.face_cleanup_confident_approve_partial', {
          values: {
            applied: appliedCount,
            failed: failed.length,
            names: failed.map(({ personId }) => personLabel(personId)).join(', '),
          },
        });
      }
    } finally {
      // Refetch even on a partial/total failure — some clusters can genuinely have resolved server-side even
      // when others failed, so skipping this left the lanes showing stale pre-apply state (D17).
      await fetchLatestScan();
      applying = false;
    }
  };

  const handleDismiss = async (personId: string) => {
    const person = scan?.persons.find((p) => p.personId === personId);
    if (!person) {
      return;
    }
    const suspectedOwnerIds = person.suspectedOwners.map((o) => o.ownerPersonId);
    try {
      await declineFaceRepair({ faceRepairDeclineRequestDto: { persons: [{ personId, suspectedOwnerIds }] } });
      // The server drains the dismissed person from the latest scan snapshot (createDeclines's persons
      // branch), so trust that snapshot via a refetch rather than only mutating the client-held list.
      await fetchLatestScan();
      toastManager.success($t('admin.face_cleanup_dismiss'));
    } catch {
      toastManager.danger($t('admin.face_cleanup_dismiss_error'));
    }
  };

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) {
      return null;
    }
    return new Date(dateStr).toLocaleString();
  };
</script>

<AdminPageLayout breadcrumbs={faceCleanupBreadcrumbs($t, guidedCrumb($t))}>
  <div class="mx-auto max-w-screen-xl p-6">
    <ReadOnlyDemoNotice />
    <!-- Header -->
    <div class="mb-6 flex flex-wrap items-start justify-between gap-6">
      <div>
        <h1 class="text-2xl font-semibold tracking-tight">{$t('admin.face_cleanup')}</h1>
        {#if scan?.status === 'completed' && scan.totals}
          <p class="mt-1 text-sm text-gray-500 dark:text-gray-400">
            {$t('admin.face_cleanup_summary', {
              values: { flagged: scan.totals.flaggedFaces, people: scan.totals.affectedPersons },
            })}
          </p>
        {/if}
      </div>
      <div class="flex flex-none flex-col items-end gap-2">
        {#if scan?.finishedAt}
          <span class="text-xs text-gray-400">
            {$t('admin.face_cleanup_last_scan')} · {formatDate(scan.finishedAt)}
          </span>
        {/if}
        <div class="flex items-center gap-2">
          <Button color="secondary" variant="ghost" size="small" href={Route.faceCleanupResolutions()}>
            {$t('admin.face_cleanup_view_resolutions')}
          </Button>
          {#if !isReadOnlyDemo}
            <div class="mx-0.5 h-5 w-px bg-gray-200 dark:bg-gray-700" aria-hidden="true"></div>
            <!-- Before the first scan the tuning knobs are recessed to `ghost`: the defaults are what run one
                 wants, and an admin who has never seen a scan's output has no basis for changing maxDistance or
                 minFaces. Recessed rather than hidden, so it stays reachable for anyone who does know. -->
            <Button
              color="secondary"
              variant={scan ? 'outline' : 'ghost'}
              size="small"
              disabled={scanning || (!!scan && isActive(scan.status))}
              onclick={handleAdvanced}
              class="gap-2"
            >
              <Icon icon={mdiTune} size="16" />
              {$t('admin.face_cleanup_advanced')}
            </Button>
            <!-- `scan === null` is "this instance has never scanned" (loading and loadError are handled as
                 separate branches below), so the action must not call itself "Re-scan" or wear a refresh icon —
                 there is nothing to repeat. It reuses the chooser's own `face_cleanup_mode_run_first_scan`, so
                 the button an admin was just told to click is named the same on both pages. -->
            <Button
              color="primary"
              size="small"
              disabled={scanning || (!!scan && isActive(scan.status))}
              onclick={handleRescan}
              class="gap-2"
            >
              <Icon icon={scan ? mdiRefresh : mdiRadar} size="16" />
              {scan ? $t('admin.face_cleanup_rescan') : $t('admin.face_cleanup_mode_run_first_scan')}
            </Button>
          {/if}
        </div>
      </div>
    </div>

    <!-- Loading -->
    {#if loading}
      <div class="flex items-center justify-center py-20 text-gray-400">
        <span>{$t('loading')}</span>
      </div>

      <!-- Initial load failed (D17): distinct from "no scan yet" — a network/server error is not the same as
           a clean instance that has never scanned, and rendering it as the latter hides the failure. -->
    {:else if loadError}
      <div
        class="mb-4 flex items-center gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900/30 dark:bg-red-900/10 dark:text-red-400"
        data-testid="load-error-banner"
      >
        <span class="flex-1">{$t('admin.face_cleanup_load_error')}</span>
        <Button color="secondary" size="small" onclick={loadInitial} data-testid="load-error-retry">
          {$t('retry')}
        </Button>
      </div>

      <!-- No scan yet -->
    {:else if !scan}
      <div class="rounded-2xl border border-dashed border-gray-200 py-20 text-center dark:border-gray-700">
        <div class="text-lg font-medium text-gray-500">{$t('admin.face_cleanup_empty_no_scan')}</div>
        <p class="mx-auto mt-2 max-w-xl text-sm/relaxed text-gray-400">
          {$t('admin.face_cleanup_empty_no_scan_sub')}
        </p>
        <!-- The copy used to say "Click Re-scan", pointing at a small button in the opposite corner. The
             instruction and the action are now the same object, so first run has one obvious thing to do.
             Hidden from the read-only demo user: it calls triggerScan (POST), exactly like the header's
             Re-scan button already gated above. -->
        {#if !isReadOnlyDemo}
          <div class="mt-6 flex justify-center">
            <Button
              color="primary"
              size="medium"
              disabled={scanning}
              onclick={handleRescan}
              class="gap-2"
              data-testid="first-scan-cta"
            >
              <Icon icon={mdiRadar} size="18" />
              {$t('admin.face_cleanup_mode_run_first_scan')}
            </Button>
          </div>
        {/if}
      </div>

      <!-- Scan running / pending: show progress -->
    {:else if isActive(scan.status)}
      <div
        class="rounded-2xl border border-primary-100 bg-primary-50/50 p-8 text-center dark:border-primary-900/30 dark:bg-primary-900/10"
      >
        <div class="mb-3 text-base font-semibold text-primary">
          {scan.status === 'pending' ? $t('admin.face_cleanup_scan_pending') : $t('admin.face_cleanup_scan_running')}
        </div>
        {#if scan.progress}
          <div class="mb-3 text-sm text-gray-500">
            {scan.progress.scanned.toLocaleString()} / {scan.progress.total.toLocaleString()}
            {$t('admin.face_cleanup_faces')}
          </div>
          <div class="mx-auto h-2 max-w-xs overflow-hidden rounded-full bg-gray-200 dark:bg-gray-700">
            <div
              class="h-full rounded-full bg-primary transition-all"
              style={`width:${scan.progress.total > 0 ? Math.round((scan.progress.scanned / scan.progress.total) * 100) : 0}%`}
            ></div>
          </div>
        {:else}
          <div class="text-sm text-gray-400">{$t('admin.face_cleanup_scan_preparing')}</div>
        {/if}
      </div>

      <!-- Scan failed -->
    {:else if scan.status === 'failed'}
      <div class="rounded-2xl border border-red-200 bg-red-50 p-6 dark:border-red-900/30 dark:bg-red-900/10">
        <div class="font-semibold text-red-700 dark:text-red-400">{$t('admin.face_cleanup_scan_failed')}</div>
        {#if scan.error}
          <p class="mt-1 font-mono text-xs text-red-500">{scan.error}</p>
        {/if}
        <!-- Also triggerScan (POST) — gated for the same reason as the first-scan CTA above. -->
        {#if !isReadOnlyDemo}
          <div class="mt-3">
            <Button color="secondary" onclick={handleRescan} disabled={scanning} data-testid="retry-scan-btn">
              {$t('admin.face_cleanup_retry_scan')}
            </Button>
          </div>
        {/if}
      </div>

      <!-- Scan completed -->
    {:else if scan.status === 'completed'}
      {#if !vm || (vm.confident.length === 0 && vm.reviewFirst.length === 0)}
        <!-- Nothing flagged: a clean scan speaks for itself. -->
        <div class="rounded-2xl border border-dashed border-gray-200 py-20 text-center dark:border-gray-700">
          <div class="text-lg font-medium text-gray-500">{$t('admin.face_cleanup_empty_clean')}</div>
          <p class="mt-2 text-sm text-gray-400">{$t('admin.face_cleanup_empty_clean_sub')}</p>
        </div>
      {:else}
        <!-- Apply error banner: a failed bulk-approve (most importantly a 409 — a scan started mid-apply)
             surfaces here without discarding the lanes. -->
        {#if applyError}
          <div
            class="mb-4 flex items-center gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900/30 dark:bg-red-900/10 dark:text-red-400"
          >
            <span class="flex-1">{applyError}</span>
            <button type="button" onclick={() => (applyError = null)} class="flex-none text-red-400 hover:text-red-600">
              <Icon icon={mdiClose} size="16" />
            </button>
          </div>
        {/if}

        <!-- Two lanes: the safe confident bulk, and the clickable review-first list. -->
        <div class="flex flex-col gap-4">
          <ConfidentLane model={vm} {applying} onApprove={handleApprove} />
          <ReviewFirstLane people={vm.reviewFirst} users={data.users} onDismiss={handleDismiss} />
        </div>

        <!-- The two non-actionable numbers the stat cards used to carry, demoted to quiet footnotes. -->
        {#if scan.totals}
          {@const tot = scan.totals}
          <div class="mt-4 flex flex-wrap gap-x-6 gap-y-1 px-1">
            <span class="inline-flex items-center gap-2 text-xs text-gray-400">
              <span class="size-1.5 rounded-full bg-green-500"></span>
              {$t('admin.face_cleanup_footnote_repaired', { values: { count: tot.toRepair } })}
            </span>
            <span class="inline-flex items-center gap-2 text-xs text-gray-400">
              <span class="size-1.5 rounded-full bg-red-500"></span>
              {$t('admin.face_cleanup_footnote_unattributable', {
                values: { count: tot.reviewOnlyByReason?.unAttributable ?? 0 },
              })}
            </span>
          </div>
        {/if}
      {/if}
    {/if}
  </div>
</AdminPageLayout>
