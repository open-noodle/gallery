<script lang="ts">
  import { goto } from '$app/navigation';
  import AdminPageLayout from '$lib/components/layouts/AdminPageLayout.svelte';
  import InfiniteScrollSentinel from '$lib/components/shared-components/infinite-scroll-sentinel.svelte';
  import { Route } from '$lib/route';
  import { handleError } from '$lib/utils/handle-error';
  import { getAdminFaceThumbnailUrl } from '$lib/utils/people-utils';
  import {
    getFaceRepairClusterFaces,
    getFaceRepairPersonMetadata,
    getPeopleThumbnailPath,
    resolveFaces,
    type FaceRepairPersonMetadataResponseDto,
    type FaceRepairResolveRequestDto,
  } from '@immich/sdk';
  import { Button, ConfirmModal, Icon, modalManager, toastManager } from '@immich/ui';
  import { mdiArrowLeft, mdiArrowRight, mdiClose, mdiInformationOutline } from '@mdi/js';
  import { onMount } from 'svelte';
  import { t } from 'svelte-i18n';
  import FaceActionsHelpModal from '$lib/components/face-cleanup/FaceActionsHelpModal.svelte';
  import FacePhotoModal from '$lib/components/face-cleanup/FacePhotoModal.svelte';
  import FaceReviewDock from '$lib/components/face-cleanup/FaceReviewDock.svelte';
  import FaceTileOverlay from '$lib/components/face-cleanup/FaceTileOverlay.svelte';
  import type { FaceActionId } from '$lib/components/face-cleanup/face-actions';
  import type { FacePhotoFace } from '$lib/components/face-cleanup/face-photo';
  import { faceCleanupBreadcrumbs, manualCrumb } from '../../breadcrumbs';
  import PersonPicker from '../../[personId]/PersonPicker.svelte';
  import type { PageData } from './$types';
  import {
    createManualReviewModel,
    MANUAL_STATE_COLOR,
    MANUAL_STATE_ICON,
    type ManualFaceState,
  } from './manual-review.svelte';

  // Manual review page (Slice 8 grid/paging + Slice 9 footer dock, design §6.4). This is a NEW page with its
  // OWN view-model — reusing the guided page's tile presentation, PersonPicker, and destructive-confirm flow,
  // not its review model (§6.5: the guided model does not typecheck against a scan-free cluster and would wipe
  // staged decisions on every paginated append).
  //
  // THE VISUAL INVERSION IS THE POINT OF THIS PAGE. In guided every tile always carries a badge and a ribbon,
  // because every face always holds one of six terminal states. Manual defaults every face to `keep`, which
  // writes nothing — so a `keep` tile is a clean crop (no badge, no ribbon) and colour appears ONLY once the
  // admin has acted (state !== 'keep'). `keep` needs no colour token; it is signalled by absence.
  //
  // Five bulk actions land here: Move to… (PersonPicker), Lock, Unknown, Not a face (destructive confirm),
  // and Unmark (the keep-default's undo — design §6.4 "A keep default needs an undo"). `stay`/`owner` are
  // never offered: both require a suspected owner, which manual mode has no scan to supply (§3.2, §6.4).
  //
  // Slice 10 adds two more things: "Move entire cluster…", which — unlike guided, where the same action rides
  // the scan's suspected owner — has no owner to ride here, so it opens PersonPicker for an explicit destination
  // and is wired straight to `resolveFaces` with ONLY `entireCluster` populated, never through the per-face
  // model (selection can only ever cover loaded faces; entireCluster is enumerated server-side precisely so a
  // whole-cluster move never has to). And the shared FaceActionsHelpModal
  // (specs/2026-07-31-face-cleanup-ux-unification-design.md §3.3), passed `mode: 'manual'` and manual's own action
  // subset (keep/other/lock/unknown/detach/unmark — no owner/stay, which both require a suspected owner manual
  // has no scan to supply).

  type Props = { data: PageData };
  const { data }: Props = $props();

  // Read once, directly off the load data — never off navigation state — so a hard refresh or a deep link
  // resolves the same way a normal client-side navigation does (design §6.4, plan item 4).
  const personId = data.personId;

  const PAGE_SIZE = 48;

  // Created exactly ONCE, here, and never reassigned. This is what makes appendFaces safe: a `$derived` that
  // rebuilds the model from a growing faces array would wipe every staged mark and the current selection on
  // every paginated load — the guided page's latent defect (design §6.5) this separate model exists to avoid.
  const vm = createManualReviewModel(personId);

  let metadata = $state<FaceRepairPersonMetadataResponseDto | null>(null);
  let loading = $state(true);
  let loadError = $state(false);
  let loadingMore = $state(false);
  let page = $state(0);
  let applying = $state(false);
  let applyError = $state<string | null>(null);
  // "Move entire cluster…" (slice 10): the destination chosen through PersonPicker, staged only long enough to
  // drive the confirm modal's copy — it is never read by the per-face model, and is cleared again as soon as
  // the confirm resolves one way or the other.
  let entireClusterDestination = $state<{ personId: string; name: string } | null>(null);

  // Server-sourced, so it is never a static UI-copy fallback derived from `metadata.name` alone — an empty or
  // whitespace-only name must not render as a blank heading (plan item 3).
  const personName = $derived(metadata?.name?.trim() ? metadata.name : $t('admin.face_cleanup_unnamed'));

  // Whether another page exists to load — purely a function of loaded vs. total, never a server-returned
  // hasMore flag, so it stays honest even if a page happens to return fewer faces than requested.
  const hasMore = $derived(vm.loadedCount < vm.total);

  // Sum of the four staged buckets — what Apply is actually about to submit. Deliberately NOT vm.total (every
  // loaded face): unlike guided, most faces here are expected to stay `keep` and never enter a bucket at all.
  const stagedCount = $derived(vm.tally.move + vm.tally.lock + vm.tally.unknown + vm.tally.detach);

  // Manual reuses guided's exact tally copy for the three states that mean the same thing there (design §6.4,
  // "one glyph means one thing across both pages"): `lock`/`unknown`/`detach` are worded identically. `move`
  // has no guided equivalent tied to a suspected owner, so it reuses guided's owner-agnostic "→ other" chip —
  // the same wording guided uses for a manually-picked destination.
  // Only the key SUFFIX is mapped, so the call site can build the key with a template literal exactly as the
  // guided dock does (`$t(\`admin.face_cleanup_review_tally_${...}\`)`). `$t` accepts a template-literal type
  // but not a `string`, and an object holding whole keys always widens to `string` at the lookup — even with
  // `satisfies` — which is what CI's check-svelte rejected. `move` maps to guided's existing `other` key
  // rather than adding a near-duplicate.
  const TALLY_KEY_SUFFIX = {
    move: 'other',
    lock: 'lock',
    unknown: 'unknown',
    detach: 'detach',
  } as const satisfies Record<Exclude<ManualFaceState, 'keep'>, string>;

  // Admin cleanup renders clusters the admin does not own, and a face may have no person↔face join at all —
  // the person-scoped thumbnail routes 404/403 for those. Face-keyed, admin-gated, no join required. Same
  // helper the guided review page uses (design §6.4 "Reused").
  const personThumbUrl = (id: string, thumbnailFaceId: string | null) =>
    thumbnailFaceId ? getAdminFaceThumbnailUrl(thumbnailFaceId) : `/api${getPeopleThumbnailPath(id)}`;
  const faceThumbnailUrl = (faceId: string) => getAdminFaceThumbnailUrl(faceId);

  // Reuses guided's exact ribbon copy for the three states that need no extra context (design §6.4: "one
  // glyph means one thing across both pages"). `move` has no destination NAME at the model layer (only the
  // destination personId — see manual-review.svelte.ts, `destinations` deliberately stores no name), so the
  // ribbon falls back to the raw id it does have.
  const ribbonLabel = (assetFaceId: string, state: ManualFaceState): string => {
    switch (state) {
      case 'move': {
        return $t('admin.face_cleanup_review_tile_dest', { values: { name: vm.destinationOf(assetFaceId) ?? '' } });
      }
      case 'lock': {
        return $t('admin.face_cleanup_review_tile_lock_ribbon');
      }
      case 'unknown': {
        return $t('admin.face_cleanup_review_tile_unknown_ribbon');
      }
      case 'detach': {
        return $t('admin.face_cleanup_review_tile_detach_ribbon');
      }
      case 'keep': {
        return '';
      }
    }
  };

  // Fetches the person's metadata plus the first page of faces, REPLACING everything this page holds.
  //
  // `allowMissing` is for the post-apply refresh alone: an emptied cluster that was never named is DELETED
  // server-side ("Empty-unnamed cleanup" in face-repair.service.ts), so a 404 there is the expected shape of
  // "this cluster is gone" and the caller navigates away instead. Every other caller (mount, Retry) still
  // treats a 404 as an ordinary load failure.
  const loadPersonData = async ({ allowMissing = false } = {}): Promise<'ok' | 'missing' | 'error'> => {
    loading = true;
    loadError = false;
    try {
      const [metadataResult, facesResult] = await Promise.all([
        getFaceRepairPersonMetadata({ personId }),
        getFaceRepairClusterFaces({
          personId,
          faceRepairClusterFacesRequestDto: { excludeFaceIds: [], page: 0, size: PAGE_SIZE },
        }),
      ]);
      metadata = metadataResult;
      // clear() before appendFaces, because appending is idempotent by assetFaceId: merging page 0 back into a
      // populated model would skip every id it already holds and leave the faces a resolve just moved away
      // rendered in the grid. A refresh replaces what the page holds; only the scroll sentinel appends.
      vm.clear();
      vm.appendFaces(facesResult.faces, facesResult.total);
      page = 0;
      return 'ok';
    } catch (error) {
      if (allowMissing && (error as { status?: number }).status === 404) {
        return 'missing';
      }
      // D17 on the guided page: a failed load is not the same as "this person genuinely has no faces" (a
      // graceful empty state) — render a distinct error state with Retry instead.
      loadError = true;
      handleError(error, $t('admin.face_cleanup_review_load_error'));
      return 'error';
    } finally {
      loading = false;
    }
  };

  onMount(() => void loadPersonData());

  const handleLoadMore = async () => {
    if (loadingMore || !hasMore) {
      return;
    }
    loadingMore = true;
    try {
      const nextPage = page + 1;
      const result = await getFaceRepairClusterFaces({
        personId,
        faceRepairClusterFacesRequestDto: { excludeFaceIds: [], page: nextPage, size: PAGE_SIZE },
      });
      // appendFaces, never a reassignment — see the model comment above. This is the regression guard for the
      // guided page's $derived defect and the most important behaviour in this slice.
      vm.appendFaces(result.faces, result.total);
      page = nextPage;
    } catch (error) {
      handleError(error, $t('admin.face_cleanup_review_load_error'));
    } finally {
      loadingMore = false;
    }
  };

  const handleTileClick = (assetFaceId: string, event: MouseEvent) => {
    vm.toggle(assetFaceId, event.shiftKey);
  };

  // #1061: opens the source photo behind a face crop. Same helper as the guided page — see its comment for
  // why `faces` is the array the magnifier was clicked from rather than some cluster-wide list.
  const openPhoto = (faces: FacePhotoFace[], index: number) => {
    void modalManager.show(FacePhotoModal, { faces, index });
  };

  // ---- Bulk actions (slice 9) ----

  // Manual's five routes, in bar order. `other` is the registry id behind the button manual calls "Move to
  // person…"; its testid stays `manual-review-bulk-move` because e2e targets it.
  const MANUAL_DOCK_ACTIONS = [
    { id: 'other', testId: 'manual-review-bulk-move' },
    { id: 'lock', testId: 'manual-review-bulk-lock' },
    { id: 'unknown', testId: 'manual-review-bulk-unknown' },
    { id: 'detach', testId: 'manual-review-bulk-detach' },
    { id: 'unmark', testId: 'manual-review-bulk-unmark' },
  ] as const satisfies readonly { id: FaceActionId; testId: string }[];

  const handleDockAction = (id: FaceActionId) => {
    switch (id) {
      case 'other': {
        void handleBulkMove();
        return;
      }
      case 'unmark': {
        handleBulkUnmark();
        return;
      }
      default: {
        vm.applyToSelection(id as 'lock' | 'unknown' | 'detach');
      }
    }
  };

  // The only bulk action that opens a modal — the other four apply straight through. `ownerId` comes from the
  // slice 3 metadata endpoint (never a scan, which manual has none of); `suggestedPersonId` is omitted, since
  // manual has no suspected owner to pre-highlight (design §6.4/§3.2).
  const handleBulkMove = async () => {
    if (!metadata || vm.selectedCount === 0) {
      return;
    }
    const destination = await modalManager.show(PersonPicker, {
      ownerId: metadata.ownerId,
      faceCount: vm.selectedCount,
    });
    if (destination) {
      vm.applyToSelection('move', { personId: destination.personId, lock: destination.lock });
    }
  };

  // The keep-default's undo (design §6.4, "A keep default needs an undo") — guided has no equivalent because
  // every face there is already stamped, so there is never anything to return to a neutral state.
  const handleBulkUnmark = () => {
    vm.unmarkSelection();
  };

  // ---- Move entire cluster… (slice 10, design §6.4 "Selection cannot claim the whole cluster") ----
  //
  // Deliberately NOT a bulk action: it is available regardless of `vm.selectedCount`, because it is not a
  // selection action at all — the server's `entireCluster` enumerates every eligible face SERVER-SIDE, with no
  // client paging, which is exactly why it is the right tool for the faces this page never even loaded.
  //
  // Unlike guided's identically-named action, which rides the scan's suspected owner straight into a confirm,
  // manual has no scan and therefore no suggested destination — this REQUIRES an explicit pick through
  // PersonPicker first.
  const handleMoveEntireCluster = async () => {
    if (!metadata) {
      return;
    }
    const destination = await modalManager.show(PersonPicker, {
      ownerId: metadata.ownerId,
      faceCount: vm.total,
    });
    if (!destination) {
      // Cancelling posts nothing — no confirm, no resolve, nothing staged.
      return;
    }
    entireClusterDestination = destination;
    await confirmMoveEntireCluster();
  };

  // The whole point of a whole-cluster move — and also its risk — is that it moves faces the admin has never
  // loaded, let alone reviewed on this page. The confirm exists to say so out loud before it happens. Uses
  // `modalManager.show(ConfirmModal, …)` (@immich/ui) rather than a hand-rolled overlay: it comes with
  // `role="dialog"`, `aria-modal`, a focus trap, Escape-to-cancel and backdrop dismissal for free — none of
  // which the previous inline `fixed inset-0` div had.
  const confirmMoveEntireCluster = async () => {
    const destination = entireClusterDestination;
    if (!destination) {
      return;
    }
    const confirmed = await modalManager.show(ConfirmModal, {
      title: $t('admin.face_cleanup_review_move_entire_confirm_title'),
      prompt: $t('admin.face_cleanup_manual_review_move_entire_confirm_body', {
        values: { count: vm.total, name: destination.name },
      }),
      confirmText: $t('admin.face_cleanup_review_move_entire_confirm_cta', {
        values: { count: vm.total },
      }),
    });
    entireClusterDestination = null;
    if (!confirmed) {
      return;
    }
    // entireCluster is mutually exclusive with every per-face bucket server-side (a combined request 400s), so
    // this request carries ONLY personId + entireCluster — never routed through vm.buildResolveRequest().
    await commitResolve({ personId, entireCluster: { destinationPersonId: destination.personId } });
  };

  // One handler for BOTH launchers — the grid header's (i) and the new in-bar one — so the two can never
  // disagree about which subset the modal shows. Read-only, same convention as guided's handleOpenHelp: never
  // touches the model, so opening/closing it leaves every staged mark and the current selection exactly as
  // they were.
  const handleOpenHelp = () => {
    void modalManager.show(FaceActionsHelpModal, {
      mode: 'manual',
      actions: ['keep', 'other', 'lock', 'unknown', 'detach', 'unmark'],
      introKey: 'admin.face_cleanup_manual_review_help_intro',
      footerKey: 'admin.face_cleanup_manual_review_help_footer',
      defaultActionId: 'keep',
    });
  };

  // Every resolve funnels through here, mirroring guided's commitResolve so a failure — most importantly the
  // 409 a scan-in-progress produces (design §7) — can never be swallowed. Unlike guided, success does not
  // ALWAYS navigate away: this page has no terminal "every face accounted for" state (most faces are expected
  // to stay `keep` forever), so a partial apply refreshes the cluster in place and resets the model, since
  // every mark it held has now either been submitted or is stale. It leaves only once the cluster is empty —
  // see the refresh below. Widened to the SDK's own request type (rather than the narrower
  // ManualResolveRequest) so the same function also carries the entire-cluster request, which has no per-face
  // buckets at all.
  const commitResolve = async (request: FaceRepairResolveRequestDto) => {
    if (applying) {
      return;
    }
    applying = true;
    applyError = null;
    try {
      const result = await resolveFaces({ faceRepairResolveRequestDto: request });
      toastManager.primary(
        $t('admin.face_cleanup_manual_review_apply_summary', {
          values: {
            moved: result.moved,
            locked: result.locked,
            unknown: result.unknown,
            detached: result.detached,
            skipped: result.skipped,
          },
        }),
      );
      vm.reset();
      // A resolve can empty the cluster outright — a whole-cluster move always does, and so does moving,
      // parking or detaching the last faces out of it — and an emptied cluster has nothing left to review
      // here. Both shapes of "emptied" end the same way, back on the manual review list with the success toast
      // above still standing:
      //   - never named: the server DELETED it ("Empty-unnamed cleanup" in face-repair.service.ts), so this
      //     refresh 404s. Chasing it unconditionally is what used to stack a "person not found" error toast
      //     straight on top of the success one.
      //   - named: the person survives and simply comes back with zero faces.
      const outcome = await loadPersonData({ allowMissing: true });
      // `void`, not `await`, exactly as the guided page navigates: a rejected navigation must not fall into the
      // catch below and relabel a resolve that already committed as a failed apply.
      if (outcome === 'missing' || (outcome === 'ok' && vm.total === 0)) {
        void goto(Route.faceCleanupPeople());
      }
    } catch (error: unknown) {
      // 409: a scan started mid-review. Staged work must survive this — losing it to a conflict is exactly
      // what the chooser's disabled-manual card exists to prevent (design §7), and discarding the review on
      // top of a recoverable conflict would compound it. Nothing below this branch touches `vm`.
      const status = (error as { status?: number }).status;
      applyError =
        status === 409 ? $t('admin.face_cleanup_review_apply_conflict') : $t('admin.face_cleanup_review_apply_error');
    } finally {
      applying = false;
    }
  };

  // Apply is disabled whenever buildResolveRequest() returns null (design §6.4) — an all-`keep` review builds
  // to nothing, and the server 400s an empty resolve. The null check here is a defensive second guard, not the
  // primary one: the disabled attribute on the button is what actually stops the click.
  const handleApply = () => {
    const request = vm.buildResolveRequest();
    if (!request) {
      return;
    }
    if (vm.tally.detach > 0) {
      void confirmDestructiveApply();
      return;
    }
    return commitResolve(request);
  };

  // `modalManager.show(ConfirmModal, …)` — see confirmMoveEntireCluster above for why.
  const confirmDestructiveApply = async () => {
    const confirmed = await modalManager.show(ConfirmModal, {
      title: $t('admin.face_cleanup_review_detach_confirm_title', { values: { count: vm.tally.detach } }),
      // No `count` value here: the message doesn't reference it (the title above already states the count) —
      // see the guided page's confirmDestructiveApply for the same fix and reasoning (F31 item 4).
      prompt: $t('admin.face_cleanup_review_detach_confirm_body'),
      confirmText: $t('admin.face_cleanup_review_detach_confirm_cta', { values: { count: vm.tally.detach } }),
      confirmColor: 'danger',
    });
    if (!confirmed) {
      return;
    }
    const request = vm.buildResolveRequest();
    if (!request) {
      return;
    }
    await commitResolve(request);
  };
</script>

<AdminPageLayout breadcrumbs={faceCleanupBreadcrumbs($t, manualCrumb($t), { title: personName })}>
  <div class="mx-auto max-w-screen-xl p-6">
    <!-- Back link -->
    <a
      href={Route.faceCleanupPeople()}
      class="mb-5 inline-flex items-center gap-1.5 text-sm font-semibold text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
      data-testid="manual-review-back"
    >
      <Icon icon={mdiArrowLeft} size="16" />
      {$t('admin.face_cleanup_mode_manual')}
    </a>

    <!-- Title row -->
    <div class="mb-6 flex items-center gap-4" data-testid="manual-review-header">
      {#if !loading && metadata}
        <img
          src={personThumbUrl(personId, metadata.thumbnailFaceId)}
          alt=""
          class="size-14 flex-none rounded-2xl bg-gray-100 object-cover dark:bg-gray-700"
        />
      {:else}
        <div class="size-14 flex-none rounded-2xl bg-gray-100 dark:bg-gray-700"></div>
      {/if}
      <div>
        <h1 class="text-2xl font-semibold tracking-tight" data-testid="manual-review-heading">
          {personName}
        </h1>
        {#if metadata}
          <div class="mt-1 flex items-center gap-2 text-sm text-gray-500">
            <span class="tabular-nums" data-testid="manual-review-showing">
              {vm.loadedCount.toLocaleString()} / {vm.total.toLocaleString()}
            </span>
            <span>·</span>
            <span>{metadata.faceCount.toLocaleString()} {$t('admin.face_cleanup_faces')}</span>
            <span>·</span>
            <span class="whitespace-nowrap">
              {$t('admin.face_cleanup_col_owner')}
              <span class="font-mono text-xs" data-testid="manual-review-owner">{metadata.ownerId}</span>
            </span>
          </div>
        {/if}
      </div>
    </div>

    {#if loading}
      <!-- Loading -->
      <div class="flex items-center justify-center py-20 text-gray-400">
        <span>{$t('loading')}</span>
      </div>
    {:else if loadError}
      <!-- Initial load failed (D17): distinct from "zero faces", a genuine, graceful empty state below. -->
      <div
        class="mb-4 flex items-center gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900/30 dark:bg-red-900/10 dark:text-red-400"
        data-testid="manual-review-load-error"
      >
        <span class="flex-1">{$t('admin.face_cleanup_review_load_error')}</span>
        <Button
          color="secondary"
          size="small"
          onclick={() => void loadPersonData()}
          data-testid="manual-review-load-error-retry"
        >
          {$t('retry')}
        </Button>
      </div>
    {:else if vm.total === 0}
      <!-- Zero-face person: distinct from the load-error state above (D17). -->
      <div
        class="rounded-2xl border border-dashed border-gray-200 py-20 text-center dark:border-gray-700"
        data-testid="manual-review-empty"
      >
        <div class="text-lg font-medium text-gray-500">{$t('admin.face_cleanup_manual_review_empty')}</div>
        <p class="mt-2 text-sm text-gray-400">{$t('admin.face_cleanup_manual_review_empty_sub')}</p>
      </div>
    {:else}
      <!-- Apply error banner: a failed apply (most importantly a 409 — a scan started mid-review) surfaces
           here WITHOUT touching the model, so staged work always survives it (design §7). -->
      {#if applyError}
        <div
          class="mb-4 flex items-center gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900/30 dark:bg-red-900/10 dark:text-red-400"
          data-testid="manual-review-apply-error"
        >
          <span class="flex-1">{applyError}</span>
          <button type="button" onclick={() => (applyError = null)} class="flex-none text-red-400 hover:text-red-600">
            <Icon icon={mdiClose} size="16" />
          </button>
        </div>
      {/if}

      <!-- Face grid -->
      <div
        class="mb-6 overflow-hidden rounded-2xl border border-gray-200 dark:border-gray-700"
        data-testid="manual-review-grid"
      >
        <div class="flex flex-wrap items-center gap-3 border-b border-gray-200 px-4 py-3 dark:border-gray-700">
          <div>
            <h3 class="text-sm font-semibold">
              {$t('admin.face_cleanup_review_grid_title', { values: { name: personName } })}
            </h3>
            <p class="text-xs text-gray-400">{$t('admin.face_cleanup_review_grid_hint')}</p>
          </div>
          <div class="flex-1"></div>
          <!-- Selection can only ever mean the faces actually loaded — a cluster can hold thousands, and an
               unqualified "select all" would either lie about what it selected or force loading everything
               (design §6.4, "Selection cannot claim the whole cluster"). The loaded count is appended as
               plain text, never solely through i18n interpolation, so the honesty requirement is visible in
               the DOM regardless of locale. -->
          <button
            type="button"
            onclick={() => vm.selectAllLoaded()}
            class="text-sm font-semibold text-primary hover:underline"
            data-testid="manual-review-select-all-loaded"
          >
            {$t('admin.face_cleanup_manual_review_select_all_loaded')} ({vm.loadedCount})
          </button>
          <button
            type="button"
            onclick={() => vm.clearSelection()}
            class="text-sm font-semibold text-gray-400 hover:underline"
            data-testid="manual-review-clear-selection"
          >
            {$t('admin.face_cleanup_review_bulk_clear')}
          </button>
          <span class="h-4 w-px bg-gray-200 dark:bg-gray-700"></span>
          <!-- Move entire cluster… (slice 10): NOT a selection action — available regardless of
               vm.selectedCount, since it is the tool for the faces selection can never reach. -->
          <Button
            color="secondary"
            size="small"
            disabled={applying}
            onclick={handleMoveEntireCluster}
            data-testid="manual-review-move-entire-btn"
          >
            {$t('admin.face_cleanup_review_move_entire')}
          </Button>
          <!-- Plain button, not <IconButton>: @immich/ui wraps any titled button in a Tooltip, which needs a
               TooltipProvider from the app root — absent when this page is rendered in isolation (same
               convention as guided's banner-help/bulk-help). -->
          <button
            type="button"
            onclick={handleOpenHelp}
            aria-label={$t('admin.face_cleanup_review_help_open')}
            title={$t('admin.face_cleanup_review_help_open')}
            class="flex-none rounded-full p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-800 dark:hover:text-gray-300"
            data-testid="manual-review-help-open"
          >
            <Icon icon={mdiInformationOutline} size="16" />
          </button>
        </div>

        <div
          class="grid grid-cols-4 gap-2.5 bg-gray-50 p-4 sm:grid-cols-6 lg:grid-cols-8 dark:bg-gray-800/50"
          data-testid="manual-review-face-grid"
        >
          {#each vm.faces as face, tileIndex (face.assetFaceId)}
            {@const selected = vm.isSelected(face.assetFaceId)}
            {@const state = vm.stateOf(face.assetFaceId)}
            <div class="relative aspect-square">
              <button
                type="button"
                class={[
                  'absolute inset-0 overflow-hidden rounded-xl border-2 transition-all',
                  selected ? 'border-primary' : 'border-transparent',
                ].join(' ')}
                style={selected ? 'box-shadow: 0 0 0 3px rgba(79,70,229,0.32);' : ''}
                onclick={(event) => handleTileClick(face.assetFaceId, event)}
                data-testid="face-tile"
                data-faceid={face.assetFaceId}
                data-state={state}
                data-selected={selected}
              >
                <img
                  src={faceThumbnailUrl(face.assetFaceId)}
                  alt=""
                  class="size-full object-cover"
                  style={state === 'detach' ? 'filter: grayscale(1) opacity(0.55);' : ''}
                  loading="lazy"
                />
                {#if selected}
                  <div class="absolute inset-0 bg-primary/15"></div>
                {/if}
                <!-- The visual inversion (§6.4): `keep` (the default) renders NEITHER the badge nor the ribbon
                     below — it is signalled by absence, not a 7th colour swatch. Every other state reuses
                     guided's exact STATE_COLOR/STATE_ICON tokens via MANUAL_STATE_COLOR/MANUAL_STATE_ICON, so
                     one glyph means one thing across both pages. -->
                {#if state !== 'keep'}
                  {@const nonKeepState = state as Exclude<ManualFaceState, 'keep'>}
                  <div
                    class="absolute top-1.5 left-1.5 flex size-5 items-center justify-center rounded-md border-2 border-white shadow-sm"
                    style="background: {MANUAL_STATE_COLOR[nonKeepState]}"
                    data-state-icon={state}
                  >
                    <Icon icon={MANUAL_STATE_ICON[nonKeepState]} size="11" color="white" />
                  </div>
                  <!-- Right-aligned and capped short of full width so it never overpaints the date pill
                       (FaceTileOverlay, a sibling of this button) sitting in the bottom-left corner. -->
                  <div
                    class="absolute right-0 bottom-0 max-w-[70%] truncate rounded-tl-sm p-1 text-center text-[9.5px] font-bold text-white"
                    style="background: {MANUAL_STATE_COLOR[nonKeepState]}"
                  >
                    {ribbonLabel(face.assetFaceId, state)}
                  </div>
                {/if}
              </button>
              <FaceTileOverlay localDateTime={face.localDateTime} onOpen={() => openPhoto(vm.faces, tileIndex)} />
            </div>
          {/each}
        </div>

        <!-- Scroll-driven pagination: the sentinel loads the next page of faces as it enters the viewport,
             appending through vm.appendFaces so staged marks and the current selection survive exactly as they
             did under the old button (the §6.5 regression guard). -->
        <InfiniteScrollSentinel
          {hasMore}
          loading={loadingMore}
          onLoadMore={handleLoadMore}
          itemCount={vm.loadedCount}
          class="flex h-12 w-full items-center justify-center border-t border-gray-200 dark:border-gray-700"
        />
      </div>
    {/if}
  </div>

  <!-- Dock: swaps between the staged-work tally and the bulk action bar, mirroring the guided page's footer
       dock shell (design §6.4 "Reused"). Rendered through AdminPageLayout's `footer` slot rather than inside
       the scroll area, for the same reason guided moved it there: `sticky bottom-0` only pins while the page
       overflows, and a short review (few loaded faces) doesn't. As a footer it is pinned at every content
       length.

       Visible whenever at least one face has loaded — NOT gated on hasStagedWork/selection — because bulk
       actions are how marks get staged in the first place; a dock that only appeared once something was
       already staged could never be reached. -->
  {#snippet footer()}
    {#if !loading && vm.loadedCount > 0}
      <FaceReviewDock
        mode="manual"
        selectedCount={vm.selectedCount}
        actions={[...MANUAL_DOCK_ACTIONS]}
        onAction={handleDockAction}
        onHelp={handleOpenHelp}
        onClear={() => vm.clearSelection()}
      >
        {#snippet summary()}
          <div class="flex flex-1 flex-wrap items-center gap-3.5" data-testid="manual-review-tally">
            {#each ['move', 'lock', 'unknown', 'detach'] as const as state (state)}
              {@const count = vm.tally[state]}
              <span
                class={[
                  'inline-flex items-center gap-1.5 rounded-full border border-gray-200 bg-white px-3 py-1 text-xs font-bold dark:border-gray-700 dark:bg-gray-800',
                  count === 0 ? 'opacity-40' : '',
                ].join(' ')}
                data-testid={`manual-review-tally-${state}`}
              >
                <Icon icon={MANUAL_STATE_ICON[state]} size="13" color={MANUAL_STATE_COLOR[state]} />
                <span>{count}</span>
                <span class="font-normal text-gray-500 dark:text-gray-400"
                  >{$t(`admin.face_cleanup_review_tally_${TALLY_KEY_SUFFIX[state]}`)}</span
                >
              </span>
            {/each}
          </div>
        {/snippet}

        {#snippet apply()}
          <!-- Apply is disabled while everything is `keep`: buildResolveRequest() returns null, and an
               all-keep POST would be an empty resolve the server 400s. -->
          <Button
            color="primary"
            disabled={applying || !vm.hasStagedWork}
            onclick={handleApply}
            data-testid="manual-review-apply-btn"
          >
            <Icon icon={mdiArrowRight} size="16" />
            {$t('admin.face_cleanup_review_apply_label', { values: { count: stagedCount } })}
          </Button>
        {/snippet}
      </FaceReviewDock>
    {/if}
  {/snippet}
</AdminPageLayout>
